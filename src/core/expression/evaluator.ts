import { parseExpression } from "./parser.js";

import type { ExpressionNode } from "./ast.js";

export interface EvaluationContext {
  note?: Record<string, unknown>;
  file?: unknown;
  formula?: Record<string, unknown>;
  this?: unknown;
  values?: unknown[];
}

export interface EvaluateOptions {
  strict: boolean;
}

type GlobalFunction = (...args: unknown[]) => unknown;
type MethodFunction = (target: unknown, ...args: unknown[]) => unknown;

function toNumber(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  const parsed = Number(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function toBoolean(value: unknown): boolean {
  return Boolean(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseDuration(value: string): number {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)(ms|s|m|h|d|w)$/i);

  if (!match) {
    return Number(value);
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();

  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
  };

  return amount * multipliers[unit];
}

const globalFunctions: Record<string, GlobalFunction> = {
  contains(container: unknown, value: unknown): boolean {
    if (typeof container === "string") {
      return container.includes(String(value));
    }

    if (Array.isArray(container)) {
      return container.some((entry) => entry === value);
    }

    if (isRecord(container)) {
      return value !== null && value !== undefined && String(value) in container;
    }

    return false;
  },
  round(value: unknown, digits: unknown = 0): number {
    const numeric = toNumber(value);
    const precision = Math.max(0, Math.floor(toNumber(digits)));
    const multiplier = 10 ** precision;
    return Math.round(numeric * multiplier) / multiplier;
  },
  lower(value: unknown): string {
    return String(value).toLowerCase();
  },
  upper(value: unknown): string {
    return String(value).toUpperCase();
  },
  length(value: unknown): number {
    if (typeof value === "string" || Array.isArray(value)) {
      return value.length;
    }

    if (isRecord(value)) {
      return Object.keys(value).length;
    }

    return 0;
  },
  list(...values: unknown[]): unknown[] {
    return values;
  },
  date(value: unknown): Date {
    if (value instanceof Date) {
      return value;
    }

    return new Date(String(value));
  },
  duration(value: unknown): number {
    if (typeof value === "number") {
      return value;
    }

    return parseDuration(String(value));
  },
  sum(values: unknown): number {
    if (!Array.isArray(values)) {
      return 0;
    }

    return values.reduce((total, entry) => total + toNumber(entry), 0);
  },
  avg(values: unknown): number {
    if (!Array.isArray(values) || values.length === 0) {
      return 0;
    }

    const total = values.reduce((sum, entry) => sum + toNumber(entry), 0);
    return total / values.length;
  },
  min(values: unknown): number {
    if (!Array.isArray(values) || values.length === 0) {
      return Number.POSITIVE_INFINITY;
    }

    return Math.min(...values.map((entry) => toNumber(entry)));
  },
  max(values: unknown): number {
    if (!Array.isArray(values) || values.length === 0) {
      return Number.NEGATIVE_INFINITY;
    }

    return Math.max(...values.map((entry) => toNumber(entry)));
  },
  count(values: unknown): number {
    return Array.isArray(values) ? values.length : 0;
  },
  format(value: unknown): string {
    if (value instanceof Date) {
      return value.toISOString();
    }

    return String(value);
  },
  startsWith(value: unknown, needle: unknown): boolean {
    return String(value).startsWith(String(needle));
  },
  endsWith(value: unknown, needle: unknown): boolean {
    return String(value).endsWith(String(needle));
  },
  link(path: unknown, display?: unknown): Record<string, unknown> {
    return {
      path: String(path),
      display: display === undefined ? String(path) : String(display),
    };
  },
  regexp(pattern: unknown, flags: unknown = ""): RegExp {
    return new RegExp(String(pattern), String(flags));
  },
};

const stringMethods: Record<string, MethodFunction> = {
  contains(target, needle): boolean {
    return String(target).includes(String(needle));
  },
  lower(target): string {
    return String(target).toLowerCase();
  },
  upper(target): string {
    return String(target).toUpperCase();
  },
  startsWith(target, needle): boolean {
    return String(target).startsWith(String(needle));
  },
  endsWith(target, needle): boolean {
    return String(target).endsWith(String(needle));
  },
};

const arrayMethods: Record<string, MethodFunction> = {
  contains(target, needle): boolean {
    return Array.isArray(target) ? target.includes(needle) : false;
  },
  length(target): number {
    return Array.isArray(target) ? target.length : 0;
  },
};

const numberMethods: Record<string, MethodFunction> = {
  round(target, digits = 0): number {
    const numeric = toNumber(target);
    const precision = Math.max(0, Math.floor(toNumber(digits)));
    const multiplier = 10 ** precision;
    return Math.round(numeric * multiplier) / multiplier;
  },
};

function resolveIdentifier(
  name: string,
  context: EvaluationContext,
  options: EvaluateOptions,
): unknown {
  const direct = context as Record<string, unknown>;

  if (name in direct) {
    return direct[name];
  }

  if (context.note && name in context.note) {
    return context.note[name];
  }

  if (options.strict) {
    throw new Error(`unknown identifier: ${name}`);
  }

  return undefined;
}

function resolveMember(
  object: unknown,
  property: string,
  options: EvaluateOptions,
): unknown {
  if (object === null || object === undefined) {
    if (options.strict) {
      throw new Error(`cannot access property ${property} on nullish value`);
    }

    return undefined;
  }

  if (isRecord(object) || Array.isArray(object)) {
    if (property in object) {
      return (object as Record<string, unknown>)[property];
    }

    if (options.strict) {
      throw new Error(`unknown property: ${property}`);
    }

    return undefined;
  }

  if (typeof object === "string" && property === "length") {
    return object.length;
  }

  if (options.strict) {
    throw new Error(`cannot access property ${property} on non-object value`);
  }

  return undefined;
}

function invokeGlobalFunction(
  name: string,
  args: unknown[],
  options: EvaluateOptions,
): unknown {
  const fn = globalFunctions[name];

  if (!fn) {
    if (options.strict) {
      throw new Error(`unknown function: ${name}`);
    }

    return undefined;
  }

  return fn(...args);
}

function invokeMethod(
  target: unknown,
  name: string,
  args: unknown[],
  options: EvaluateOptions,
): unknown {
  const registry =
    typeof target === "string"
      ? stringMethods
      : typeof target === "number"
        ? numberMethods
        : Array.isArray(target)
          ? arrayMethods
          : undefined;

  const fn = registry?.[name];

  if (!fn) {
    if (options.strict) {
      throw new Error(`unknown method: ${name}`);
    }

    return undefined;
  }

  return fn(target, ...args);
}

export function evaluateAst(
  expression: ExpressionNode,
  context: EvaluationContext,
  options: EvaluateOptions,
): unknown {
  if (expression.kind === "literal") {
    return expression.value;
  }

  if (expression.kind === "identifier") {
    return resolveIdentifier(expression.name, context, options);
  }

  if (expression.kind === "unary") {
    const value = evaluateAst(expression.argument, context, options);

    switch (expression.operator) {
      case "-":
        return -toNumber(value);
      case "!":
      case "not":
        return !toBoolean(value);
      default:
        throw new Error(`unsupported unary operator: ${expression.operator}`);
    }
  }

  if (expression.kind === "binary") {
    if (expression.operator === "and" || expression.operator === "&&") {
      const left = evaluateAst(expression.left, context, options);
      return toBoolean(left) ? evaluateAst(expression.right, context, options) : left;
    }

    if (expression.operator === "or" || expression.operator === "||") {
      const left = evaluateAst(expression.left, context, options);
      return toBoolean(left) ? left : evaluateAst(expression.right, context, options);
    }

    const left = evaluateAst(expression.left, context, options);
    const right = evaluateAst(expression.right, context, options);

    switch (expression.operator) {
      case "==":
        return left === right;
      case "!=":
        return left !== right;
      case ">":
        return toNumber(left) > toNumber(right);
      case ">=":
        return toNumber(left) >= toNumber(right);
      case "<":
        return toNumber(left) < toNumber(right);
      case "<=":
        return toNumber(left) <= toNumber(right);
      case "+":
        if (typeof left === "string" || typeof right === "string") {
          return String(left ?? "") + String(right ?? "");
        }
        return toNumber(left) + toNumber(right);
      case "-":
        return toNumber(left) - toNumber(right);
      case "*":
        return toNumber(left) * toNumber(right);
      case "/":
        return toNumber(left) / toNumber(right);
      case "%":
        return toNumber(left) % toNumber(right);
      default:
        throw new Error(`unsupported binary operator: ${expression.operator}`);
    }
  }

  if (expression.kind === "member") {
    const object = evaluateAst(expression.object, context, options);
    return resolveMember(object, expression.property, options);
  }

  if (expression.kind === "index") {
    const object = evaluateAst(expression.object, context, options);
    const index = evaluateAst(expression.index, context, options);

    if (Array.isArray(object)) {
      return object[toNumber(index)];
    }

    if (isRecord(object) && (typeof index === "string" || typeof index === "number")) {
      return object[String(index)];
    }

    if (options.strict) {
      throw new Error("cannot index non-indexable value");
    }

    return undefined;
  }

  if (expression.kind === "call") {
    if (expression.callee.kind === "identifier") {
      const args = expression.args.map((entry) => evaluateAst(entry, context, options));
      return invokeGlobalFunction(expression.callee.name, args, options);
    }

    if (expression.callee.kind === "member") {
      const target = evaluateAst(expression.callee.object, context, options);
      const args = expression.args.map((entry) => evaluateAst(entry, context, options));
      return invokeMethod(target, expression.callee.property, args, options);
    }

    if (options.strict) {
      throw new Error("unsupported call target");
    }

    return undefined;
  }

  throw new Error(`unsupported expression kind: ${(expression as { kind: string }).kind}`);
}

export function evaluateExpression(
  source: string,
  context: EvaluationContext,
  options: EvaluateOptions,
): unknown {
  const ast = parseExpression(source);
  return evaluateAst(ast, context, options);
}

export function compileExpression(source: string): ExpressionNode {
  return parseExpression(source);
}
