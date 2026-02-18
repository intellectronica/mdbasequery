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
    properties:
      - title
      - score
      - status
    order:
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
});
