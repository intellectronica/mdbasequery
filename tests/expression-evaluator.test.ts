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

  test("and/or return operand values per JS semantics", () => {
    expect(evaluateExpression("1 and 'high' or 'low'", {}, { strict: true })).toBe("high");
    expect(evaluateExpression("0 and 'high' or 'low'", {}, { strict: true })).toBe("low");
    expect(evaluateExpression("null and 'high'", {}, { strict: true })).toBeNull();
    expect(evaluateExpression("'' or 0", {}, { strict: true })).toBe(0);
    expect(evaluateExpression("0 || 'fallback'", {}, { strict: true })).toBe("fallback");
    expect(evaluateExpression("'x' && 'y'", {}, { strict: true })).toBe("y");
  });

  test("compares date values against date strings", () => {
    expect(evaluateExpression("'2024-01-01' < date('2025-01-01')", {}, { strict: true })).toBeTrue();
    expect(evaluateExpression("date('2025-01-01') > '2024-06-15 08:30:00'", {}, { strict: true })).toBeTrue();
    expect(evaluateExpression("date('2024-01-10') == '2024-01-10'", {}, { strict: true })).toBeTrue();
    expect(evaluateExpression("'2024-01-10' == date('2024-01-10')", {}, { strict: true })).toBeTrue();
    expect(evaluateExpression("'not-a-date' < date('2025-01-01')", {}, { strict: true })).toBeFalse();
  });

  test("calls date methods on date-typed values", () => {
    const context = { note: { created: new Date("2024-01-10T00:00:00.000Z") } };
    expect(evaluateExpression("created.format('YYYY-MM-DD')", context, { strict: true })).toBe("2024-01-10");
    expect(evaluateExpression("created.year", context, { strict: true })).toBe(2024);
  });

  test("list stat methods sum/mean/min/max", () => {
    expect(evaluateExpression("[1,2,3].sum()", {}, { strict: true })).toBe(6);
    expect(evaluateExpression("[1,2,3].mean()", {}, { strict: true })).toBe(2);
    expect(evaluateExpression("[1,2,3].min()", {}, { strict: true })).toBe(1);
    expect(evaluateExpression("[1,2,3].max()", {}, { strict: true })).toBe(3);
    expect(evaluateExpression("[1, null, 3].mean()", {}, { strict: true })).toBe(2);
    expect(evaluateExpression("[].sum()", {}, { strict: true })).toBe(0);
    expect(evaluateExpression("[].mean()", {}, { strict: true })).toBe(0);
    expect(evaluateExpression("[].min()", {}, { strict: true })).toBeNull();
    expect(evaluateExpression("[].max()", {}, { strict: true })).toBeNull();
    expect(evaluateExpression("[1,2,3].mean().round(3)", {}, { strict: true })).toBe(2);
  });

  test("plain strings do not compare equal via .md path normalisation", () => {
    expect(evaluateExpression('"notes.md" == "notes"', {}, { strict: true })).toBeFalse();
    expect(evaluateExpression('"./a.md" == "a.md"', {}, { strict: true })).toBeFalse();
    expect(evaluateExpression('"notes.md" != "notes"', {}, { strict: true })).toBeTrue();
    expect(evaluateExpression('["notes.md"].contains("notes")', {}, { strict: true })).toBeFalse();
  });

  test("link and file values still compare via path resolution", () => {
    expect(evaluateExpression('link("a") == link("a.md")', {}, { strict: true })).toBeTrue();
    expect(evaluateExpression('link("a") == "a.md"', {}, { strict: true })).toBeTrue();
    expect(evaluateExpression('link("a") == "notes.md"', {}, { strict: true })).toBeFalse();

    const fileContext = {
      file: {
        name: "beta.md",
        basename: "beta",
        path: "beta.md",
        folder: "",
        ext: ".md",
        size: 10,
        ctime: new Date("2024-01-01"),
        mtime: new Date("2024-01-02"),
        tags: [],
        links: [],
        properties: {},
      },
    };

    expect(evaluateExpression('file == "beta.md"', fileContext, { strict: true })).toBeTrue();
    expect(evaluateExpression('"beta" == file', fileContext, { strict: true })).toBeTrue();
  });

  test("date.format() handles Moment tokens", () => {
    const expr = (format: string) =>
      evaluateExpression(`date("2025-01-04 15:06:07").format("${format}")`, {}, { strict: true });

    expect(expr("YYYY-MM-DD")).toBe("2025-01-04");
    expect(expr("YY")).toBe("25");
    expect(expr("M-D")).toBe("1-4");
    expect(expr("MM-DD")).toBe("01-04");
    expect(expr("MMM")).toBe("Jan");
    expect(expr("MMMM")).toBe("January");
    expect(expr("ddd")).toBe("Sat");
    expect(expr("dddd")).toBe("Saturday");
    expect(expr("dd")).toBe("Sa");
    expect(expr("Do")).toBe("4th");
    expect(expr("HH:mm")).toBe("15:06");
    expect(expr("hh:mm A")).toBe("03:06 PM");
    expect(expr("h:m a")).toBe("3:6 pm");
    expect(expr("ss.SSS")).toBe("07.000");
    expect(
      evaluateExpression(
        "created.format('ss.SSS')",
        { note: { created: new Date(2025, 0, 4, 15, 6, 7, 8) } },
        { strict: true },
      ),
    ).toBe("07.008");
    expect(expr("[on] YYYY")).toBe("on 2025");
    expect(expr("[[bracket]]")).toBe("[bracket]");
    expect(expr("x")).toBe(String(new Date(2025, 0, 4, 15, 6, 7).getTime()));
  });

  test("date.format() ordinal suffixes follow Moment rules", () => {
    const expr = (day: number) =>
      evaluateExpression(`date("2025-01-${String(day).padStart(2, "0")} 00:00:00").format("Do")`, {}, { strict: true });

    expect(expr(1)).toBe("1st");
    expect(expr(2)).toBe("2nd");
    expect(expr(3)).toBe("3rd");
    expect(expr(4)).toBe("4th");
    expect(expr(11)).toBe("11th");
    expect(expr(12)).toBe("12th");
    expect(expr(13)).toBe("13th");
    expect(expr(21)).toBe("21st");
    expect(expr(22)).toBe("22nd");
    expect(expr(23)).toBe("23rd");
    expect(expr(31)).toBe("31st");
  });
});
