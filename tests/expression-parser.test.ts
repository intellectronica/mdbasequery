import { describe, expect, test } from "bun:test";

import { ExpressionSyntaxError, parseExpression } from "../src/core/expression/index.js";

describe("expression parser", () => {
  test("respects operator precedence", () => {
    const ast = parseExpression("1 + 2 * 3");

    expect(ast.kind).toBe("binary");
    if (ast.kind !== "binary") {
      return;
    }

    expect(ast.operator).toBe("+");
    expect(ast.right.kind).toBe("binary");
    if (ast.right.kind === "binary") {
      expect(ast.right.operator).toBe("*");
    }
  });

  test("parses property and index access", () => {
    const ast = parseExpression("note.tags[0]");
    expect(ast.kind).toBe("index");
  });

  test("parses function calls", () => {
    const ast = parseExpression("contains(file.tags, \"project/core\")");
    expect(ast.kind).toBe("call");
  });

  test("parses regex literals", () => {
    const ast = parseExpression("/alpha/i");
    expect(ast.kind).toBe("literal");
    if (ast.kind === "literal") {
      expect(ast.value).toBeInstanceOf(RegExp);
    }
  });

  test("parses array and object literals", () => {
    const listAst = parseExpression("[1, 2, title]");
    const objectAst = parseExpression('{"name": title, count: 2}');

    expect(listAst.kind).toBe("array");
    expect(objectAst.kind).toBe("object");
  });

  test("parses list callback-style expressions", () => {
    const ast = parseExpression("[1,2,3].filter(value > 1)");
    expect(ast.kind).toBe("call");
  });

  test("reports syntax errors with index", () => {
    expect(() => parseExpression("1 + )")).toThrow(ExpressionSyntaxError);
  });
});
