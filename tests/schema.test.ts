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
});
