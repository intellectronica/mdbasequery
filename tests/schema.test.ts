import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { QueryValidationError } from "../src/core/schema.js";
import { parseBaseYaml } from "../src/query.js";
import { fixturesRoot } from "./helpers.js";

describe("schema parser", () => {
  test("parses valid minimal base", () => {
    const spec = parseBaseYaml(
      `
views:
  - type: table
    name: default
`.trim(),
    );

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
      parseBaseYaml(
        `
views:
  - type: table
    name: default
    order: invalid
`.trim(),
      );
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(QueryValidationError);
    const queryError = error as QueryValidationError;
    expect(queryError.issues.some((issue) => issue.includes("views[0].order"))).toBeTrue();
  });

  test("supports filter not-list and sort/group object forms", () => {
    const spec = parseBaseYaml(
      `
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
`.trim(),
    );

    expect(spec.filters).toBeDefined();
    expect(spec.views[0].groupBy).toEqual({ property: "file.folder", direction: "desc" });
    expect(spec.views[0].sort).toEqual([{ by: "file.name", direction: "asc" }]);
  });

  test("accepts Obsidian properties object and keeps property keys and propertyConfigs", () => {
    const spec = parseBaseYaml(
      `
properties:
  Type:
    displayName: Item Type
  Date:
    displayName: Due Date
views:
  - type: table
    name: default
`.trim(),
    );

    expect(spec.properties).toEqual(["Type", "Date"]);
    expect(spec.propertyConfigs).toEqual({
      Type: { displayName: "Item Type" },
      Date: { displayName: "Due Date" },
    });
  });

  test("emits warnings on unknown top-level keys and unknown view types", () => {
    const spec = parseBaseYaml(
      `
formuals:
  bad: score * 2
views:
  - type: custom_gallery
    name: default
`.trim(),
    );

    expect(spec.warnings).toBeDefined();
    expect(spec.warnings).toContain('unknown top-level key "formuals" in query');
    expect(spec.warnings).toContain('unknown view type "custom_gallery" in views[0]');
  });

  test("rejects non-string formula and summary expressions", () => {
    expect(() =>
      parseBaseYaml(
        `
formulas:
  score: 42
views:
  - type: table
    name: default
`.trim(),
      ),
    ).toThrow(/formulas\.score must be a string expression/);

    expect(() =>
      parseBaseYaml(
        `
summaries:
  avg: 123
views:
  - type: table
    name: default
`.trim(),
      ),
    ).toThrow(/summaries\.avg must be a string expression/);
  });
});
