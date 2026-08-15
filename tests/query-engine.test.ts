import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "bun:test";

import { parseBaseYaml } from "../src/core/schema.js";
import { compileQuery, executeCompiledQuery } from "../src/core/query-engine.js";
import { indexVault } from "../src/core/vault-index.js";
import { nodeAdapter } from "../src/runtime-adapters/node.js";
import { fixturesRoot } from "./helpers.js";

describe("query engine", () => {
  const vaultDir = resolve(fixturesRoot, "vaults/basic");

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

    const makeDocument = (path: string, frontmatter: Record<string, unknown>) => ({
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
        raw: "",
      },
    });

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

    const makeDocument = (path: string, frontmatter: Record<string, unknown>) => ({
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
        raw: "",
      },
    });

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
});
