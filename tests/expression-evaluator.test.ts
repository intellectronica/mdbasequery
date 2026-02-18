import { describe, expect, test } from "bun:test";

import { evaluateExpression } from "../src/core/expression/index.js";

describe("expression evaluator", () => {
  test("handles primitive operators", () => {
    const result = evaluateExpression("1 + 2 * 3", {}, { strict: true });
    expect(result).toBe(7);
  });

  test("supports array/object literals and indexing", () => {
    const listValue = evaluateExpression("[1, 2, 3][1]", {}, { strict: true });
    const objectValue = evaluateExpression('{"a": 1, b: 2}["b"]', {}, { strict: true });

    expect(listValue).toBe(2);
    expect(objectValue).toBe(2);
  });

  test("supports date and duration helpers", () => {
    const date = evaluateExpression("date('2024-01-01') + '1M'", {}, { strict: true });
    const durationMs = evaluateExpression("duration('2d')", {}, { strict: true });
    const today = evaluateExpression("today()", {}, { strict: true });
    const now = evaluateExpression("now()", {}, { strict: true });

    expect(date).toBeInstanceOf(Date);
    expect(durationMs).toBeTypeOf("object");
    expect(today).toBeInstanceOf(Date);
    expect(now).toBeInstanceOf(Date);
  });

  test("supports string and number methods", () => {
    expect(evaluateExpression("title.lower()", { title: "Hello WORLD" }, { strict: true })).toBe(
      "hello world",
    );
    expect(evaluateExpression("title.title()", { title: "hello world" }, { strict: true })).toBe(
      "Hello World",
    );
    expect(evaluateExpression("'a,b,c'.split(',').length", {}, { strict: true })).toBe(3);
    expect(evaluateExpression("(-2.1).abs()", {}, { strict: true })).toBe(2.1);
    expect(evaluateExpression("(2.345).round(2)", {}, { strict: true })).toBe(2.35);
  });

  test("supports list callback methods map/filter/reduce", () => {
    const filtered = evaluateExpression("[1,2,3,4].filter(value > 2)", {}, { strict: true });
    const mapped = evaluateExpression("[1,2,3].map(value + index)", {}, { strict: true });
    const reduced = evaluateExpression("[1,2,3].reduce(acc + value, 0)", {}, { strict: true });

    expect(filtered).toEqual([3, 4]);
    expect(mapped).toEqual([1, 3, 5]);
    expect(reduced).toBe(6);
  });

  test("supports object and regexp methods", () => {
    const keys = evaluateExpression('{"a": 1, "b": 2}.keys()', {}, { strict: true });
    const values = evaluateExpression('{"a": 1, "b": 2}.values()', {}, { strict: true });
    const matches = evaluateExpression("/abc/.matches('abcde')", {}, { strict: true });

    expect(keys).toEqual(["a", "b"]);
    expect(values).toEqual([1, 2]);
    expect(matches).toBeTrue();
  });

  test("supports file-specific methods", () => {
    const context = {
      file: {
        name: "note.md",
        basename: "note",
        path: "projects/note.md",
        folder: "projects",
        ext: ".md",
        size: 10,
        ctime: new Date("2024-01-01"),
        mtime: new Date("2024-01-02"),
        tags: ["team", "team/core"],
        links: ["projects/other.md", "Other"],
        properties: {
          Type: "contact",
        },
      },
    };

    expect(evaluateExpression("file.hasTag('team')", context, { strict: true })).toBeTrue();
    expect(evaluateExpression("file.inFolder('projects')", context, { strict: true })).toBeTrue();
    expect(evaluateExpression("file.hasProperty('Type')", context, { strict: true })).toBeTrue();
  });

  test("uses if() lazily", () => {
    const result = evaluateExpression("if(true, 'ok', missingIdentifier)", {}, { strict: true });
    expect(result).toBe("ok");
  });

  test("missing note properties evaluate as empty instead of errors", () => {
    const result = evaluateExpression("Type == 'contact'", { note: {} }, { strict: true });
    expect(result).toBeFalse();
  });

  test("throws on unknown functions in strict mode", () => {
    expect(() => evaluateExpression("missingFn()", {}, { strict: true })).toThrow();
  });
});
