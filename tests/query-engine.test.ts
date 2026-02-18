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
});
