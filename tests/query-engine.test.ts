import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "bun:test";

import { parseBaseYaml } from "../src/core/schema.js";
import { compileQuery, executeCompiledQuery } from "../src/core/query-engine.js";
import { serializeResult } from "../src/core/serialize.js";
import { indexVault } from "../src/core/vault-index.js";
import { nodeAdapter } from "../src/runtime-adapters/node.js";
import { fixturesRoot } from "./helpers.js";

describe("query engine", () => {
  const vaultDir = resolve(fixturesRoot, "vaults/basic");

  function makeDocument(path: string, frontmatter: Record<string, unknown>) {
    return {
      note: { frontmatter },
      file: {
        name: path.split("/").pop() ?? path,
        basename: (path.split("/").pop() ?? path).replace(/\.md$/, ""),
        path,
        folder: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "",
        ext: ".md",
        size: 1,
        ctime: new Date(0),
        mtime: new Date(0),
        properties: frontmatter,
        tags: [] as string[],
        links: [] as string[],
        embeds: [] as string[],
        backlinks: [] as string[],
      },
    };
  }

  function runWithDocuments(
    specText: string,
    documents: ReturnType<typeof makeDocument>[],
    view = "default",
    options: { strict?: boolean } = {},
  ) {
    const spec = parseBaseYaml(specText);
    const compiled = compileQuery(spec, { strict: options.strict ?? true });
    return executeCompiledQuery({ compiled, documents, view });
  }

  test("applies global filter and formulas", async () => {
    const spec = parseBaseYaml(readFileSync(resolve(fixturesRoot, "queries/basic.base"), "utf8"));
    const compiled = compileQuery(spec);
    const indexed = await indexVault({
      rootDir: vaultDir,
      include: ["**/*.md"],
      exclude: [],
      adapter: nodeAdapter,
    });

    const result = executeCompiledQuery({
      compiled,
      documents: indexed.documents,
      view: "default",
    });

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].projected["formula.doubled"]).toBe(20);
    expect(result.rows[1].projected["formula.doubled"]).toBe(14);
    expect(result.summaries?.["formula.doubled"]).toBe(34);
  });

  test("supports recursive and/or/not view filters", async () => {
    const spec = parseBaseYaml(readFileSync(resolve(fixturesRoot, "queries/grouped.base"), "utf8"));
    const compiled = compileQuery(spec);
    const indexed = await indexVault({
      rootDir: vaultDir,
      include: ["**/*.md"],
      exclude: [],
      adapter: nodeAdapter,
    });

    const result = executeCompiledQuery({
      compiled,
      documents: indexed.documents,
      view: "grouped",
    });

    expect(result.rows).toHaveLength(3);
    expect(result.groups).toBeDefined();
    expect(result.groups?.length).toBe(2);
  });

  test("group rows contain only projected values (no file/note/raw internals)", async () => {
    const spec = parseBaseYaml(readFileSync(resolve(fixturesRoot, "queries/grouped.base"), "utf8"));
    const compiled = compileQuery(spec);
    const indexed = await indexVault({
      rootDir: vaultDir,
      include: ["**/*.md"],
      exclude: [],
      adapter: nodeAdapter,
    });

    const result = executeCompiledQuery({
      compiled,
      documents: indexed.documents,
      view: "grouped",
    });

    expect(result.groups).toBeDefined();
    for (const group of result.groups ?? []) {
      for (const row of group.rows) {
        expect(row).not.toHaveProperty("file");
        expect(row).not.toHaveProperty("note");
        expect(row).not.toHaveProperty("this");
        expect(row).not.toHaveProperty("formula");
        expect(row).not.toHaveProperty("raw");
        expect(Object.keys(row)).toEqual(result.columns);
      }
    }
  });

  test("and/or formula produces operand values, not booleans (grouped.base band)", async () => {
    const spec = parseBaseYaml(readFileSync(resolve(fixturesRoot, "queries/grouped.base"), "utf8"));
    const compiled = compileQuery(spec);
    const indexed = await indexVault({
      rootDir: vaultDir,
      include: ["**/*.md"],
      exclude: [],
      adapter: nodeAdapter,
    });

    const result = executeCompiledQuery({
      compiled,
      documents: indexed.documents,
      view: "grouped",
    });

    const bandByTitle = Object.fromEntries(
      result.rows.map((row) => [row.projected.title, row.projected["formula.band"]]),
    );

    expect(bandByTitle["Alpha"]).toBe("high");
    expect(bandByTitle["Gamma"]).toBe("high");
    expect(bandByTitle["Beta"]).toBe("low");
  });

  test("uses view order as projection columns", async () => {
    const spec = parseBaseYaml(`
views:
  - type: table
    name: ordered-columns
    order:
      - title
      - status
`.trim());

    const compiled = compileQuery(spec);
    const indexed = await indexVault({
      rootDir: vaultDir,
      include: ["**/*.md"],
      exclude: [],
      adapter: nodeAdapter,
    });

    const result = executeCompiledQuery({
      compiled,
      documents: indexed.documents,
      view: "ordered-columns",
    });

    expect(result.columns).toEqual(["title", "status"]);
    expect(result.rows).toHaveLength(3);
    expect(Object.keys(result.rows[0].projected)).toEqual(["title", "status"]);
  });

  test("infers note property columns when no order or select is declared", async () => {
    const spec = parseBaseYaml(`
views:
  - type: table
    name: inferred
`.trim());

    const compiled = compileQuery(spec);
    const indexed = await indexVault({
      rootDir: vaultDir,
      include: ["**/*.md"],
      exclude: [],
      adapter: nodeAdapter,
    });

    const result = executeCompiledQuery({
      compiled,
      documents: indexed.documents,
      view: "inferred",
    });

    expect(result.columns).toEqual(["file.name", "title", "score", "status", "created"]);
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0].projected.title).toBeDefined();
  });

  test("detects formula cycles", () => {
    expect(() =>
      compileQuery(
        parseBaseYaml(`
formulas:
  a: formula.b + 1
  b: formula.a + 1
views:
  - type: table
    name: default
`.trim()),
      ),
    ).toThrow();
  });

  test("sort, group and limit behavior is deterministic", async () => {
    const spec = parseBaseYaml(`
views:
  - type: table
    name: ordered
    order:
      - title
      - score
      - status
    sort:
      - score:desc
      - title:asc
    groupBy: status
    limit: 2
`.trim());

    const compiled = compileQuery(spec);
    const indexed = await indexVault({
      rootDir: vaultDir,
      include: ["**/*.md"],
      exclude: [],
      adapter: nodeAdapter,
    });

    const result = executeCompiledQuery({
      compiled,
      documents: indexed.documents,
      view: "ordered",
    });

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].projected.title).toBe("Gamma");
    expect(result.rows[1].projected.title).toBe("Alpha");
    expect(result.groups?.length).toBe(1);
  });

  test("supports file.folder in filters and projections", async () => {
    const spec = parseBaseYaml(`
filters: file.folder == "nested"
views:
  - type: table
    name: folders
    properties:
      - file.name
      - file.folder
`.trim());

    const compiled = compileQuery(spec);
    const indexed = await indexVault({
      rootDir: vaultDir,
      include: ["**/*.md"],
      exclude: [],
      adapter: nodeAdapter,
    });

    const result = executeCompiledQuery({
      compiled,
      documents: indexed.documents,
      view: "folders",
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].projected["file.name"]).toBe("gamma.md");
    expect(result.rows[0].projected["file.folder"]).toBe("nested");
    expect(result.diagnostics.errors).toHaveLength(0);
  });

  test("strict mode rejects identifiers that exist nowhere in the vault", async () => {
    const spec = parseBaseYaml(`
filters: scoree >= 7
views:
  - type: table
    name: default
`.trim());

    const compiled = compileQuery(spec);
    const indexed = await indexVault({
      rootDir: vaultDir,
      include: ["**/*.md"],
      exclude: [],
      adapter: nodeAdapter,
    });

    expect(() =>
      executeCompiledQuery({
        compiled,
        documents: indexed.documents,
        view: "default",
      }),
    ).toThrow(/scoree/);
  });

  test("strict mode rejects undeclared formula references", async () => {
    const spec = parseBaseYaml(`
views:
  - type: table
    name: default
    filters: formula.missing > 3
`.trim());

    const compiled = compileQuery(spec);
    const indexed = await indexVault({
      rootDir: vaultDir,
      include: ["**/*.md"],
      exclude: [],
      adapter: nodeAdapter,
    });

    expect(() =>
      executeCompiledQuery({
        compiled,
        documents: indexed.documents,
        view: "default",
      }),
    ).toThrow(/formula "missing" is not declared/);
  });

  test("strict mode rejects unknown projection columns", async () => {
    const spec = parseBaseYaml(`
views:
  - type: table
    name: default
    properties:
      - title
      - does_not_exist_anywhere
`.trim());

    const compiled = compileQuery(spec);
    const indexed = await indexVault({
      rootDir: vaultDir,
      include: ["**/*.md"],
      exclude: [],
      adapter: nodeAdapter,
    });

    expect(() =>
      executeCompiledQuery({
        compiled,
        documents: indexed.documents,
        view: "default",
      }),
    ).toThrow(/does_not_exist_anywhere/);
  });

  test("strict mode tolerates keys missing from some notes (heterogeneous vaults)", async () => {
    const spec = parseBaseYaml(`
filters: if(due, true, false)
views:
  - type: table
    name: default
`.trim());

    const compiled = compileQuery(spec);

    const result = executeCompiledQuery({
      compiled,
      documents: [
        makeDocument("a.md", { title: "A" }),
        makeDocument("b.md", { title: "B", due: "2025-01-01" }),
      ],
      view: "default",
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].projected.title).toBe("B");
    expect(result.diagnostics.errors).toHaveLength(0);
  });

  test("non-strict mode stays fully permissive", async () => {
    const spec = parseBaseYaml(`
filters: scoree >= 7
views:
  - type: table
    name: default
`.trim());

    const compiled = compileQuery(spec, { strict: false });
    const indexed = await indexVault({
      rootDir: vaultDir,
      include: ["**/*.md"],
      exclude: [],
      adapter: nodeAdapter,
    });

    const result = executeCompiledQuery({
      compiled,
      documents: indexed.documents,
      view: "default",
    });

    expect(result.rows).toHaveLength(0);
  });

  test("custom summary formula uses values.mean() per official docs", async () => {
    const spec = parseBaseYaml(`
summaries:
  customAverage: 'values.mean().round(3)'
views:
  - type: table
    name: default
    order:
      - title
      - score
    summaries:
      score: customAverage
`.trim());

    const compiled = compileQuery(spec);
    const indexed = await indexVault({
      rootDir: vaultDir,
      include: ["**/*.md"],
      exclude: [],
      adapter: nodeAdapter,
    });

    const result = executeCompiledQuery({
      compiled,
      documents: indexed.documents,
      view: "default",
    });

    expect(result.summaries?.score).toBe(6.667);
  });

  test("this is a file-like object, stable across rows", async () => {
    const spec = parseBaseYaml(`
filters: this.file.ext == ".base"
views:
  - type: table
    name: default
    properties:
      - file.name
`.trim());

    const compiled = compileQuery(spec);
    const indexed = await indexVault({
      rootDir: vaultDir,
      include: ["**/*.md"],
      exclude: [],
      adapter: nodeAdapter,
    });

    const result = executeCompiledQuery({
      compiled,
      documents: indexed.documents,
      view: "default",
      thisFile: {
        name: "base.base",
        basename: "base",
        path: "queries/base.base",
        folder: "queries",
        ext: ".base",
        size: 0,
        ctime: new Date(0),
        mtime: new Date(0),
        properties: {},
        tags: [],
        links: [],
        embeds: [],
        backlinks: [],
      },
    });

    expect(result.rows).toHaveLength(3);
    expect(result.rows[0].this.path).toBe("queries/base.base");
    expect(result.rows[1].this.path).toBe("queries/base.base");
  });

  test("file.hasLink(this.file) works when a note links to the base file", async () => {
    const spec = parseBaseYaml(`
filters: file.hasLink(this.file)
views:
  - type: table
    name: default
    properties:
      - file.name
`.trim());

    const compiled = compileQuery(spec);
    const indexed = await indexVault({
      rootDir: vaultDir,
      include: ["**/*.md"],
      exclude: [],
      adapter: nodeAdapter,
    });

    const result = executeCompiledQuery({
      compiled,
      documents: indexed.documents,
      view: "default",
      thisFile: {
        name: "beta.md",
        basename: "beta",
        path: "beta.md",
        folder: "",
        ext: ".md",
        size: 0,
        ctime: new Date(0),
        mtime: new Date(0),
        properties: {},
        tags: [],
        links: [],
        embeds: [],
        backlinks: [],
      },
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].projected["file.name"]).toBe("alpha.md");
  });

  test("frontmatter date properties are Dates: comparable and formatable", async () => {
    const spec = parseBaseYaml(`
filters: created < date("2024-02-01")
views:
  - type: table
    name: dates
    properties:
      - title
      - created
`.trim());

    const compiled = compileQuery(spec);
    const indexed = await indexVault({
      rootDir: vaultDir,
      include: ["**/*.md"],
      exclude: [],
      adapter: nodeAdapter,
    });

    const result = executeCompiledQuery({
      compiled,
      documents: indexed.documents,
      view: "dates",
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].projected.title).toBe("Alpha");
    expect(result.rows[0].note.created).toBeInstanceOf(Date);
  });

  test("strict mode allows lambda-scoped value/index/acc in list methods", async () => {
    const spec = parseBaseYaml(`
filters: tags.filter(value == "urgent").length > 0
views:
  - type: table
    name: default
`.trim());

    const compiled = compileQuery(spec);

    expect(() =>
      executeCompiledQuery({
        compiled,
        documents: [
          makeDocument("a.md", { title: "A", tags: ["urgent"] }),
          makeDocument("b.md", { title: "B", tags: ["chill"] }),
        ],
        view: "default",
      }),
    ).not.toThrow();
  });

  test("sort places empty values last and mirrors direction", () => {
    const documents = [
      makeDocument("a.md", { title: "A", score: 5 }),
      makeDocument("b.md", { title: "B" }),
      makeDocument("c.md", { title: "C", score: 3 }),
    ];

    const asc = runWithDocuments(
      `
views:
  - type: table
    name: default
    sort:
      - score:asc
`.trim(),
      documents,
    );
    const desc = runWithDocuments(
      `
views:
  - type: table
    name: default
    sort:
      - score:desc
`.trim(),
      documents,
    );

    expect(asc.rows.map((row) => row.projected.title)).toEqual(["C", "A", "B"]);
    expect(desc.rows.map((row) => row.projected.title)).toEqual(["A", "C", "B"]);
  });

  test("sort compares numeric-string columns numerically", () => {
    const documents = [
      makeDocument("a.md", { title: "A", priority: "10" }),
      makeDocument("b.md", { title: "B", priority: "9" }),
      makeDocument("c.md", { title: "C", priority: "2" }),
    ];

    const result = runWithDocuments(
      `
views:
  - type: table
    name: default
    sort:
      - priority:asc
`.trim(),
      documents,
    );

    expect(result.rows.map((row) => row.projected.title)).toEqual(["C", "B", "A"]);
  });

  test("sort compares date columns chronologically", () => {
    const documents = [
      makeDocument("a.md", { title: "A", created: "2024-03-01" }),
      makeDocument("b.md", { title: "B", created: "2024-01-01" }),
      makeDocument("c.md", { title: "C", created: "2024-02-01" }),
    ];

    const asc = runWithDocuments(
      `
views:
  - type: table
    name: default
    sort:
      - created:asc
`.trim(),
      documents,
    );
    const desc = runWithDocuments(
      `
views:
  - type: table
    name: default
    sort:
      - created:desc
`.trim(),
      documents,
    );

    expect(asc.rows.map((row) => row.projected.title)).toEqual(["B", "C", "A"]);
    expect(desc.rows.map((row) => row.projected.title)).toEqual(["A", "C", "B"]);
  });

  test("display-only formulas are evaluated only on notes that pass filters", () => {
    const documents = [
      makeDocument("filtered-out.md", { title: "Filtered", score: 1 }),
      makeDocument("matched.md", { title: "Matched", score: 10, count: 5 }),
    ];

    // formula.heavy will fail/throw if evaluated on filtered-out.md because `count` is missing
    const specText = `
filters: score >= 5
formulas:
  heavy: count.toFixed(2)
views:
  - type: table
    name: default
    properties:
      - title
      - formula.heavy
`.trim();

    const result = runWithDocuments(specText, documents);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].projected.title).toBe("Matched");
    expect(result.rows[0].projected["formula.heavy"]).toBe("5.00");
    expect(result.diagnostics.errors).toHaveLength(0);
  });

  test("uses properties.displayName for CSV/MD headers and columnLabels", () => {
    const documents = [
      makeDocument("a.md", { title: "Alpha", status: "open" }),
    ];

    const specText = `
properties:
  title:
    displayName: Document Title
  status:
    displayName: Current Status
views:
  - type: table
    name: default
    properties:
      - title
      - status
`.trim();

    const result = runWithDocuments(specText, documents);

    expect(result.columnLabels).toEqual({
      title: "Document Title",
      status: "Current Status",
    });

    const csv = serializeResult(result, "csv");
    expect(csv.startsWith("Document Title,Current Status")).toBeTrue();

    const md = serializeResult(result, "md");
    expect(md).toContain("| Document Title | Current Status |");
  });
});
