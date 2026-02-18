import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "bun:test";

import { parseBaseYaml } from "../src/query.js";
import { QueryValidationError } from "../src/core/schema.js";
import { fixturesRoot } from "./helpers.js";

describe("schema parser", () => {
  test("parses valid minimal base", () => {
    const spec = parseBaseYaml(`
views:
  - type: table
    name: default
`.trim());

    expect(spec.views).toHaveLength(1);
    expect(spec.views[0].name).toBe("default");
  });

  test("rejects invalid YAML", () => {
    expect(() => parseBaseYaml("views: [\n")).toThrow(QueryValidationError);
  });

  test("rejects invalid schema combinations", () => {
    const content = readFileSync(resolve(fixturesRoot, "queries/invalid.yaml"), "utf8");
    expect(() => parseBaseYaml(content)).toThrow(QueryValidationError);
  });

  test("parser diagnostics include path context", () => {
    let error: unknown;

    try {
      parseBaseYaml(`
views:
  - type: table
    name: default
    order: invalid
`.trim());
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(QueryValidationError);
    const queryError = error as QueryValidationError;
    expect(queryError.issues.some((issue) => issue.includes("views[0].order"))).toBeTrue();
  });

  test("supports filter not-list and sort/group object forms", () => {
    const spec = parseBaseYaml(`
filters:
  not:
    - file.hasTag("archive")
    - file.inFolder("templates")
views:
  - type: table
    name: default
    groupBy:
      property: file.folder
      direction: DESC
    sort:
      - property: file.name
        direction: ASC
`.trim());

    expect(spec.filters).toBeDefined();
    expect(spec.views[0].groupBy).toEqual({ property: "file.folder", direction: "desc" });
    expect(spec.views[0].sort).toEqual([{ by: "file.name", direction: "asc" }]);
  });

  test("accepts Obsidian properties object and keeps property keys", () => {
    const spec = parseBaseYaml(`
properties:
  Type:
    displayName: Type
  Date:
    displayName: Date
views:
  - type: table
    name: default
`.trim());

    expect(spec.properties).toEqual(["Type", "Date"]);
  });
});
