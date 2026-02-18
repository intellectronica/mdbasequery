import type { ExpressionNode } from "./ast.js";

type TokenType =
  | "number"
  | "string"
  | "identifier"
  | "regex"
  | "operator"
  | "punct"
  | "eof";

interface Token {
  type: TokenType;
  value: string;
  start: number;
  end: number;
}

const binaryPrecedence = new Map<string, number>([
  ["or", 1],
  ["||", 1],
  ["and", 2],
  ["&&", 2],
  ["==", 3],
  ["!=", 3],
  [">", 4],
  [">=", 4],
  ["<", 4],
  ["<=", 4],
  ["+", 5],
  ["-", 5],
  ["*", 6],
  ["/", 6],
  ["%", 6],
]);

const punctuators = new Set(["(", ")", "[", "]", ".", ","]);

const operators = ["==", "!=", ">=", "<=", "&&", "||", "+", "-", "*", "/", "%", ">", "<", "!"];

function isWhitespace(char: string): boolean {
  return /\s/.test(char);
}

function isDigit(char: string): boolean {
  return /[0-9]/.test(char);
}

function isIdentifierStart(char: string): boolean {
  return /[A-Za-z_$]/.test(char);
}

function isIdentifierPart(char: string): boolean {
  return /[A-Za-z0-9_$]/.test(char);
}

export class ExpressionSyntaxError extends Error {
  readonly index: number;

  constructor(message: string, index: number) {
    super(`${message} at index ${index}`);
    this.name = "ExpressionSyntaxError";
    this.index = index;
  }
}

class Parser {
  private readonly input: string;
  private offset: number;
  private previous: Token | undefined;
  private current: Token;

  constructor(input: string) {
    this.input = input;
    this.offset = 0;
    this.current = this.readToken();
  }

  parse(): ExpressionNode {
    const expression = this.parseExpression(0);

    if (this.current.type !== "eof") {
      throw new ExpressionSyntaxError(
        `unexpected token ${JSON.stringify(this.current.value)}`,
        this.current.start,
      );
    }

    return expression;
  }

  private parseExpression(minPrecedence: number): ExpressionNode {
    let left = this.parseUnary();

    while (this.current.type === "operator") {
      const precedence = binaryPrecedence.get(this.current.value);

      if (!precedence || precedence <= minPrecedence) {
        break;
      }

      const operator = this.consume().value;
      const right = this.parseExpression(precedence);

      left = {
        kind: "binary",
        operator,
        left,
        right,
      };
    }

    return left;
  }

  private parseUnary(): ExpressionNode {
    if (
      this.current.type === "operator" &&
      (this.current.value === "-" || this.current.value === "!" || this.current.value === "not")
    ) {
      const operator = this.consume().value;
      const argument = this.parseUnary();

      return {
        kind: "unary",
        operator,
        argument,
      };
    }

    return this.parsePostfix();
  }

  private parsePostfix(): ExpressionNode {
    let expression = this.parsePrimary();

    while (true) {
      if (this.current.type === "punct" && this.current.value === ".") {
        this.consume();
        const propertyToken = this.expect("identifier");

        expression = {
          kind: "member",
          object: expression,
          property: propertyToken.value,
        };

        continue;
      }

      if (this.current.type === "punct" && this.current.value === "[") {
        this.consume();
        const indexExpression = this.parseExpression(0);
        this.expectPunct("]");

        expression = {
          kind: "index",
          object: expression,
          index: indexExpression,
        };

        continue;
      }

      if (this.current.type === "punct" && this.current.value === "(") {
        this.consume();
        const args: ExpressionNode[] = [];

        if (!this.isCurrentPunct(")")) {
          while (true) {
            args.push(this.parseExpression(0));

            if (this.isCurrentPunct(",")) {
              this.consume();
              continue;
            }

            break;
          }
        }

        this.expectPunct(")");

        expression = {
          kind: "call",
          callee: expression,
          args,
        };

        continue;
      }

      break;
    }

    return expression;
  }

  private parsePrimary(): ExpressionNode {
    if (this.current.type === "number") {
      const token = this.consume();
      return {
        kind: "literal",
        value: Number(token.value),
        raw: token.value,
      };
    }

    if (this.current.type === "string") {
      const token = this.consume();
      return {
        kind: "literal",
        value: token.value,
        raw: JSON.stringify(token.value),
      };
    }

    if (this.current.type === "regex") {
      const token = this.consume();
      const firstSlash = token.value.lastIndexOf("/");
      const body = token.value.slice(1, firstSlash);
      const flags = token.value.slice(firstSlash + 1);

      return {
        kind: "literal",
        value: new RegExp(body, flags),
        raw: token.value,
      };
    }

    if (this.current.type === "identifier") {
      const token = this.consume();

      if (token.value === "true") {
        return { kind: "literal", value: true, raw: token.value };
      }

      if (token.value === "false") {
        return { kind: "literal", value: false, raw: token.value };
      }

      if (token.value === "null") {
        return { kind: "literal", value: null, raw: token.value };
      }

      return {
        kind: "identifier",
        name: token.value,
      };
    }

    if (this.current.type === "punct" && this.current.value === "(") {
      this.consume();
      const expression = this.parseExpression(0);
      this.expectPunct(")");
      return expression;
    }

    throw new ExpressionSyntaxError(
      `unexpected token ${JSON.stringify(this.current.value)}`,
      this.current.start,
    );
  }

  private expect(type: TokenType): Token {
    if (this.current.type !== type) {
      throw new ExpressionSyntaxError(`expected ${type}`, this.current.start);
    }

    return this.consume();
  }

  private expectPunct(value: string): Token {
    if (!this.isCurrentPunct(value)) {
      throw new ExpressionSyntaxError(`expected ${value}`, this.current.start);
    }

    return this.consume();
  }

  private isCurrentPunct(value: string): boolean {
    return this.current.type === "punct" && this.current.value === value;
  }

  private consume(): Token {
    const token = this.current;
    this.previous = token;
    this.current = this.readToken();
    return token;
  }

  private canStartRegex(): boolean {
    if (!this.previous) {
      return true;
    }

    if (this.previous.type === "operator") {
      return true;
    }

    if (
      this.previous.type === "punct" &&
      (this.previous.value === "(" || this.previous.value === "[" || this.previous.value === ",")
    ) {
      return true;
    }

    return false;
  }

  private readToken(): Token {
    while (this.offset < this.input.length && isWhitespace(this.input[this.offset])) {
      this.offset += 1;
    }

    const start = this.offset;

    if (start >= this.input.length) {
      return { type: "eof", value: "", start, end: start };
    }

    const char = this.input[this.offset];

    if (char === "\"" || char === "'") {
      this.offset += 1;
      let value = "";

      while (this.offset < this.input.length) {
        const current = this.input[this.offset];

        if (current === "\\") {
          const next = this.input[this.offset + 1] ?? "";
          value += next;
          this.offset += 2;
          continue;
        }

        if (current === char) {
          this.offset += 1;
          return {
            type: "string",
            value,
            start,
            end: this.offset,
          };
        }

        value += current;
        this.offset += 1;
      }

      throw new ExpressionSyntaxError("unterminated string literal", start);
    }

    if (isDigit(char)) {
      this.offset += 1;

      while (this.offset < this.input.length && /[0-9._]/.test(this.input[this.offset])) {
        this.offset += 1;
      }

      const value = this.input.slice(start, this.offset).replaceAll("_", "");
      return { type: "number", value, start, end: this.offset };
    }

    if (isIdentifierStart(char)) {
      this.offset += 1;

      while (this.offset < this.input.length && isIdentifierPart(this.input[this.offset])) {
        this.offset += 1;
      }

      const value = this.input.slice(start, this.offset);

      if (value === "and" || value === "or" || value === "not") {
        return { type: "operator", value, start, end: this.offset };
      }

      return { type: "identifier", value, start, end: this.offset };
    }

    if (char === "/" && this.canStartRegex()) {
      this.offset += 1;
      let escaped = false;

      while (this.offset < this.input.length) {
        const current = this.input[this.offset];

        if (!escaped && current === "/") {
          this.offset += 1;

          while (this.offset < this.input.length && /[a-z]/i.test(this.input[this.offset])) {
            this.offset += 1;
          }

          const value = this.input.slice(start, this.offset);
          return { type: "regex", value, start, end: this.offset };
        }

        if (!escaped && current === "\\") {
          escaped = true;
          this.offset += 1;
          continue;
        }

        escaped = false;
        this.offset += 1;
      }

      throw new ExpressionSyntaxError("unterminated regex literal", start);
    }

    for (const operator of operators) {
      if (this.input.startsWith(operator, this.offset)) {
        this.offset += operator.length;
        return {
          type: "operator",
          value: operator,
          start,
          end: this.offset,
        };
      }
    }

    if (punctuators.has(char)) {
      this.offset += 1;
      return { type: "punct", value: char, start, end: this.offset };
    }

    throw new ExpressionSyntaxError(`unexpected character ${JSON.stringify(char)}`, this.offset);
  }
}

export function parseExpression(input: string): ExpressionNode {
  const parser = new Parser(input);
  return parser.parse();
}
