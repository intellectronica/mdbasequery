import { describe, expect, test } from "bun:test";

import { evaluateExpression } from "../src/core/expression/index.js";

describe("expression evaluator", () => {
  test("handles primitive operators", () => {
    const result = evaluateExpression("1 + 2 * 3", {}, { strict: true });
    expect(result).toBe(7);
  });

  test("evaluates global and method functions", () => {
    const contains = evaluateExpression("contains(file.tags, \"a\")", { file: { tags: ["a", "b"] } }, { strict: true });
    const upper = evaluateExpression("title.upper()", { title: "alpha" }, { strict: true });

    expect(contains).toBeTrue();
    expect(upper).toBe("ALPHA");
  });

  test("supports date and duration helpers", () => {
    const date = evaluateExpression("date(\"2024-01-01\")", {}, { strict: true });
    const duration = evaluateExpression("duration(\"2d\")", {}, { strict: true });

    expect(date).toBeInstanceOf(Date);
    expect(duration).toBe(172800000);
  });

  test("throws on unknown symbols in strict mode", () => {
    expect(() => evaluateExpression("missing + 1", {}, { strict: true })).toThrow();
    expect(() => evaluateExpression("missingFn()", {}, { strict: true })).toThrow();
  });

  test("returns undefined on unknown symbols in non-strict mode", () => {
    const result = evaluateExpression("missing", {}, { strict: false });
    expect(result).toBeUndefined();
  });
});
