import { parseExpression } from "./parser.js";

import type { ExpressionNode } from "./ast.js";

export interface EvaluationContext {
  note?: Record<string, unknown>;
  file?: unknown;
  formula?: Record<string, unknown>;
  this?: unknown;
  values?: unknown[];
  value?: unknown;
  index?: number;
  acc?: unknown;
  filesByPath?: Map<string, unknown>;
}

export interface EvaluateOptions {
  strict: boolean;
}

type GlobalFunction = (
  argNodes: ExpressionNode[],
  context: EvaluationContext,
  options: EvaluateOptions,
) => unknown;

type MethodFunction = (
  target: unknown,
  argNodes: ExpressionNode[],
  context: EvaluationContext,
  options: EvaluateOptions,
) => unknown;

type DurationUnit =
  | "year"
  | "month"
  | "week"
  | "day"
  | "hour"
  | "minute"
  | "second"
  | "millisecond";

interface DurationPart {
  unit: DurationUnit;
  value: number;
}

interface DurationValue {
  __kind: "duration";
  parts: DurationPart[];
}

interface LinkValue {
  __kind: "link";
  path: string;
  display?: unknown;
}

interface HtmlValue {
  __kind: "html";
  html: string;
}

interface ImageValue {
  __kind: "image";
  source: string;
}

interface IconValue {
  __kind: "icon";
  name: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDurationValue(value: unknown): value is DurationValue {
  return isRecord(value) && value.__kind === "duration" && Array.isArray(value.parts);
}

function isLinkValue(value: unknown): value is LinkValue {
  return isRecord(value) && value.__kind === "link" && typeof value.path === "string";
}

function isHtmlValue(value: unknown): value is HtmlValue {
  return isRecord(value) && value.__kind === "html" && typeof value.html === "string";
}

function isImageValue(value: unknown): value is ImageValue {
  return isRecord(value) && value.__kind === "image" && typeof value.source === "string";
}

function isIconValue(value: unknown): value is IconValue {
  return isRecord(value) && value.__kind === "icon" && typeof value.name === "string";
}

function isFileLike(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    typeof value.path === "string" &&
    typeof value.name === "string" &&
    typeof value.ext === "string"
  );
}

function isNullish(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "").trim();
}

function basename(path: string): string {
  const normalized = normalizePath(path);
  const slashIndex = normalized.lastIndexOf("/");
  return slashIndex === -1 ? normalized : normalized.slice(slashIndex + 1);
}

function basenameWithoutExt(path: string): string {
  const name = basename(path);
  const dotIndex = name.lastIndexOf(".");
  return dotIndex === -1 ? name : name.slice(0, dotIndex);
}

function normalizeTag(tag: string): string {
  return tag.trim().replace(/^#/, "");
}

function padNumber(value: number, size = 2): string {
  return String(Math.trunc(Math.abs(value))).padStart(size, "0");
}

function toDate(value: unknown): Date {
  if (value instanceof Date) {
    return value;
  }

  return new Date(String(value));
}

function inferType(value: unknown): string {
  if (isNullish(value)) {
    return "null";
  }

  if (value instanceof Date) {
    return "date";
  }

  if (value instanceof RegExp) {
    return "regexp";
  }

  if (isDurationValue(value)) {
    return "duration";
  }

  if (isLinkValue(value)) {
    return "link";
  }

  if (isFileLike(value)) {
    return "file";
  }

  if (isHtmlValue(value)) {
    return "html";
  }

  if (isImageValue(value)) {
    return "image";
  }

  if (isIconValue(value)) {
    return "icon";
  }

  if (Array.isArray(value)) {
    return "list";
  }

  if (typeof value === "string") {
    return "string";
  }

  if (typeof value === "number") {
    return "number";
  }

  if (typeof value === "boolean") {
    return "boolean";
  }

  if (isRecord(value)) {
    return "object";
  }

  return typeof value;
}

function stableStringify(value: unknown): string {
  if (isNullish(value)) {
    return "null";
  }

  if (value instanceof Date) {
    return `date:${value.getTime()}`;
  }

  if (isDurationValue(value)) {
    return `duration:${value.parts.map((part) => `${part.value}${part.unit}`).join("|")}`;
  }

  if (isLinkValue(value)) {
    return `link:${normalizePath(value.path)}`;
  }

  if (isFileLike(value)) {
    return `file:${normalizePath(String(value.path))}`;
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  if (isRecord(value)) {
    const entries = Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => `${key}:${stableStringify(value[key])}`)
      .join(",");
    return `{${entries}}`;
  }

  return `${typeof value}:${String(value)}`;
}

function toBoolean(value: unknown): boolean {
  return Boolean(value);
}

function durationToMilliseconds(duration: DurationValue): number {
  const unitMs: Record<DurationUnit, number> = {
    year: 365 * 24 * 60 * 60 * 1_000,
    month: 30 * 24 * 60 * 60 * 1_000,
    week: 7 * 24 * 60 * 60 * 1_000,
    day: 24 * 60 * 60 * 1_000,
    hour: 60 * 60 * 1_000,
    minute: 60 * 1_000,
    second: 1_000,
    millisecond: 1,
  };

  return duration.parts.reduce((total, part) => total + unitMs[part.unit] * part.value, 0);
}

function toNumber(value: unknown, options: EvaluateOptions): number {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  if (isDurationValue(value)) {
    return durationToMilliseconds(value);
  }

  if (isNullish(value)) {
    return 0;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    if (options.strict) {
      throw new Error(`cannot convert value to number: ${String(value)}`);
    }

    return 0;
  }

  return parsed;
}

function mapDurationUnit(unit: string): DurationUnit | undefined {
  const normalized = unit.trim();

  switch (normalized) {
    case "y":
    case "year":
    case "years":
      return "year";
    case "M":
    case "month":
    case "months":
      return "month";
    case "w":
    case "week":
    case "weeks":
      return "week";
    case "d":
    case "day":
    case "days":
      return "day";
    case "h":
    case "hour":
    case "hours":
      return "hour";
    case "m":
    case "minute":
    case "minutes":
      return "minute";
    case "s":
    case "second":
    case "seconds":
      return "second";
    case "ms":
    case "millisecond":
    case "milliseconds":
      return "millisecond";
    default:
      return undefined;
  }
}

function parseDuration(value: string): DurationValue {
  const input = value.trim();
  const pattern = /([+-]?\d+(?:\.\d+)?)\s*(ms|milliseconds?|M|months?|m|minutes?|y|years?|w|weeks?|d|days?|h|hours?|s|seconds?)/g;
  const parts: DurationPart[] = [];

  for (const match of input.matchAll(pattern)) {
    const amount = Number(match[1]);
    const unit = mapDurationUnit(match[2]);

    if (!Number.isFinite(amount) || !unit) {
      continue;
    }

    parts.push({ unit, value: amount });
  }

  if (parts.length === 0) {
    throw new Error(`invalid duration: ${value}`);
  }

  return {
    __kind: "duration",
    parts,
  };
}

function tryParseDuration(value: unknown): DurationValue | undefined {
  if (isDurationValue(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  try {
    return parseDuration(value);
  } catch {
    return undefined;
  }
}

function applyDurationToDate(date: Date, duration: DurationValue, sign: 1 | -1): Date {
  const output = new Date(date.getTime());

  for (const part of duration.parts) {
    const amount = part.value * sign;

    if (part.unit === "year") {
      output.setFullYear(output.getFullYear() + Math.trunc(amount));
      continue;
    }

    if (part.unit === "month") {
      output.setMonth(output.getMonth() + Math.trunc(amount));
      continue;
    }

    const subDuration: DurationValue = {
      __kind: "duration",
      parts: [{ unit: part.unit, value: amount }],
    };

    output.setTime(output.getTime() + durationToMilliseconds(subDuration));
  }

  return output;
}

function addValues(left: unknown, right: unknown, options: EvaluateOptions): unknown {
  if (left instanceof Date) {
    const duration = tryParseDuration(right);

    if (duration) {
      return applyDurationToDate(left, duration, 1);
    }

    if (typeof right === "number") {
      return new Date(left.getTime() + right);
    }
  }

  if (right instanceof Date) {
    const duration = tryParseDuration(left);

    if (duration) {
      return applyDurationToDate(right, duration, 1);
    }
  }

  if (isDurationValue(left) && isDurationValue(right)) {
    return {
      __kind: "duration",
      parts: [...left.parts, ...right.parts],
    } satisfies DurationValue;
  }

  if (typeof left === "string" || typeof right === "string") {
    return `${stringifyValue(left)}${stringifyValue(right)}`;
  }

  return toNumber(left, options) + toNumber(right, options);
}

function subtractValues(left: unknown, right: unknown, options: EvaluateOptions): unknown {
  if (left instanceof Date && right instanceof Date) {
    return left.getTime() - right.getTime();
  }

  if (left instanceof Date) {
    const duration = tryParseDuration(right);

    if (duration) {
      return applyDurationToDate(left, duration, -1);
    }

    if (typeof right === "number") {
      return new Date(left.getTime() - right);
    }
  }

  if (isDurationValue(left) && isDurationValue(right)) {
    return durationToMilliseconds(left) - durationToMilliseconds(right);
  }

  return toNumber(left, options) - toNumber(right, options);
}

function multiplyValues(left: unknown, right: unknown, options: EvaluateOptions): unknown {
  if (isDurationValue(left) && typeof right === "number") {
    return {
      __kind: "duration",
      parts: left.parts.map((part) => ({ unit: part.unit, value: part.value * right })),
    } satisfies DurationValue;
  }

  if (isDurationValue(right) && typeof left === "number") {
    return {
      __kind: "duration",
      parts: right.parts.map((part) => ({ unit: part.unit, value: part.value * left })),
    } satisfies DurationValue;
  }

  return toNumber(left, options) * toNumber(right, options);
}

function divideValues(left: unknown, right: unknown, options: EvaluateOptions): unknown {
  if (isDurationValue(left) && typeof right === "number") {
    return {
      __kind: "duration",
      parts: left.parts.map((part) => ({ unit: part.unit, value: part.value / right })),
    } satisfies DurationValue;
  }

  return toNumber(left, options) / toNumber(right, options);
}

function compareValues(left: unknown, right: unknown, options: EvaluateOptions): number {
  if (left instanceof Date && right instanceof Date) {
    return left.getTime() - right.getTime();
  }

  if (isDurationValue(left) || isDurationValue(right)) {
    return toNumber(left, options) - toNumber(right, options);
  }

  if (typeof left === "string" && typeof right === "string") {
    return left.localeCompare(right);
  }

  if (typeof left === "boolean" && typeof right === "boolean") {
    return Number(left) - Number(right);
  }

  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }

  return stringifyValue(left).localeCompare(stringifyValue(right));
}

function resolveComparablePath(value: unknown): string | undefined {
  if (isLinkValue(value)) {
    return normalizePath(value.path).replace(/\.md$/i, "");
  }

  if (isFileLike(value)) {
    return normalizePath(String(value.path)).replace(/\.md$/i, "");
  }

  if (typeof value === "string") {
    return normalizePath(value).replace(/\.md$/i, "");
  }

  return undefined;
}

function equalsValues(left: unknown, right: unknown, options: EvaluateOptions): boolean {
  if (left instanceof Date && right instanceof Date) {
    return left.getTime() === right.getTime();
  }

  const leftPath = resolveComparablePath(left);
  const rightPath = resolveComparablePath(right);

  if (leftPath !== undefined && rightPath !== undefined) {
    return leftPath === rightPath;
  }

  if (isDurationValue(left) && isDurationValue(right)) {
    return durationToMilliseconds(left) === durationToMilliseconds(right);
  }

  if (typeof left === "number" || typeof right === "number") {
    return toNumber(left, options) === toNumber(right, options);
  }

  if (Array.isArray(left) && Array.isArray(right) && left.length === right.length) {
    return left.every((entry, index) => equalsValues(entry, right[index], options));
  }

  if (isRecord(left) && isRecord(right)) {
    return stableStringify(left) === stableStringify(right);
  }

  return left === right;
}

function stringifyValue(value: unknown): string {
  if (isNullish(value)) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (isDurationValue(value)) {
    return value.parts.map((part) => `${part.value}${part.unit}`).join(" ");
  }

  if (isLinkValue(value)) {
    return value.display === undefined ? value.path : String(value.display);
  }

  if (isFileLike(value)) {
    return String(value.path);
  }

  if (isIconValue(value)) {
    return value.name;
  }

  if (isImageValue(value)) {
    return value.source;
  }

  if (isHtmlValue(value)) {
    return value.html;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatDate(date: Date, format: string): string {
  return format
    .replaceAll("YYYY", String(date.getFullYear()))
    .replaceAll("MM", padNumber(date.getMonth() + 1))
    .replaceAll("DD", padNumber(date.getDate()))
    .replaceAll("HH", padNumber(date.getHours()))
    .replaceAll("mm", padNumber(date.getMinutes()))
    .replaceAll("ss", padNumber(date.getSeconds()))
    .replaceAll("SSS", padNumber(date.getMilliseconds(), 3));
}

function relativeDate(date: Date): string {
  const deltaMs = date.getTime() - Date.now();
  const abs = Math.abs(deltaMs);

  const units = [
    { ms: 365 * 24 * 60 * 60 * 1_000, singular: "year" },
    { ms: 30 * 24 * 60 * 60 * 1_000, singular: "month" },
    { ms: 7 * 24 * 60 * 60 * 1_000, singular: "week" },
    { ms: 24 * 60 * 60 * 1_000, singular: "day" },
    { ms: 60 * 60 * 1_000, singular: "hour" },
    { ms: 60 * 1_000, singular: "minute" },
    { ms: 1_000, singular: "second" },
  ];

  for (const unit of units) {
    if (abs >= unit.ms) {
      const value = Math.round(abs / unit.ms);
      const label = value === 1 ? unit.singular : `${unit.singular}s`;
      return deltaMs >= 0 ? `in ${value} ${label}` : `${value} ${label} ago`;
    }
  }

  return "just now";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function evaluateArgNodes(
  argNodes: ExpressionNode[],
  context: EvaluationContext,
  options: EvaluateOptions,
): unknown[] {
  return argNodes.map((node) => evaluateAst(node, context, options));
}

function resolveIdentifier(
  name: string,
  context: EvaluationContext,
  options: EvaluateOptions,
): unknown {
  const direct = context as Record<string, unknown>;

  if (Object.prototype.hasOwnProperty.call(direct, name)) {
    return direct[name];
  }

  if (context.note) {
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
  if (isNullish(object)) {
    if (options.strict) {
      throw new Error(`cannot access property ${property} on nullish value`);
    }

    return undefined;
  }

  if (object instanceof Date) {
    switch (property) {
      case "year":
        return object.getFullYear();
      case "month":
        return object.getMonth() + 1;
      case "day":
        return object.getDate();
      case "hour":
        return object.getHours();
      case "minute":
        return object.getMinutes();
      case "second":
        return object.getSeconds();
      case "millisecond":
        return object.getMilliseconds();
      default:
        if (options.strict) {
          throw new Error(`unknown property: ${property}`);
        }
        return undefined;
    }
  }

  if (isFileLike(object) && property === "file") {
    return object;
  }

  if (typeof object === "string" && property === "length") {
    return object.length;
  }

  if (Array.isArray(object) && property === "length") {
    return object.length;
  }

  if (isRecord(object) || Array.isArray(object)) {
    if (property in object) {
      return (object as Record<string, unknown>)[property];
    }

    if (isFileLike(object) && options.strict) {
      throw new Error(`unknown property: ${property}`);
    }

    return undefined;
  }

  if (options.strict) {
    throw new Error(`cannot access property ${property} on non-object value`);
  }

  return undefined;
}

function createSyntheticFile(pathLike: string): Record<string, unknown> {
  const path = normalizePath(pathLike);
  const name = basename(path);
  const folderIndex = path.lastIndexOf("/");
  const folder = folderIndex === -1 ? "" : path.slice(0, folderIndex);
  const dotIndex = name.lastIndexOf(".");
  const ext = dotIndex === -1 ? "" : name.slice(dotIndex);

  return {
    name,
    basename: basenameWithoutExt(name),
    path,
    folder,
    ext,
    size: 0,
    ctime: new Date(0),
    mtime: new Date(0),
    properties: {},
    tags: [],
    links: [],
    embeds: [],
    backlinks: [],
    raw: "",
  };
}

function lookupFile(pathLike: string, context: EvaluationContext): Record<string, unknown> | undefined {
  const map = context.filesByPath;

  if (!map) {
    return undefined;
  }

  const normalized = normalizePath(pathLike);
  const candidates = [normalized, basename(normalized), basenameWithoutExt(normalized), `${basenameWithoutExt(normalized)}.md`];

  for (const candidate of candidates) {
    const found = map.get(candidate);

    if (isRecord(found)) {
      return found;
    }
  }

  return undefined;
}

function resolveFileArg(value: unknown, context: EvaluationContext): Record<string, unknown> | undefined {
  if (isFileLike(value)) {
    return value;
  }

  if (isLinkValue(value)) {
    return lookupFile(value.path, context) ?? createSyntheticFile(value.path);
  }

  if (typeof value === "string") {
    return lookupFile(value, context) ?? createSyntheticFile(value);
  }

  return undefined;
}

function matchesLinkTarget(link: string, target: string): boolean {
  const normalize = (value: string): string => normalizePath(value).replace(/\.md$/i, "").toLowerCase();
  const left = normalize(link);
  const right = normalize(target);

  return left === right || basename(left) === basename(right);
}

const globalFunctions: Record<string, GlobalFunction> = {
  escapeHTML(argNodes, context, options): string {
    const [input] = evaluateArgNodes(argNodes, context, options);
    return escapeHtml(stringifyValue(input));
  },
  date(argNodes, context, options): Date {
    const [input] = evaluateArgNodes(argNodes, context, options);
    return toDate(input);
  },
  duration(argNodes, context, options): DurationValue {
    const [input] = evaluateArgNodes(argNodes, context, options);

    if (isDurationValue(input)) {
      return input;
    }

    if (typeof input !== "string") {
      throw new Error("duration() requires a duration string");
    }

    return parseDuration(input);
  },
  file(argNodes, context, options): unknown {
    const [input] = evaluateArgNodes(argNodes, context, options);
    return resolveFileArg(input, context);
  },
  html(argNodes, context, options): HtmlValue {
    const [input] = evaluateArgNodes(argNodes, context, options);
    return {
      __kind: "html",
      html: stringifyValue(input),
    };
  },
  if(argNodes, context, options): unknown {
    if (argNodes.length < 2) {
      throw new Error("if() expects at least 2 arguments");
    }

    const condition = evaluateAst(argNodes[0], context, options);

    if (toBoolean(condition)) {
      return evaluateAst(argNodes[1], context, options);
    }

    if (argNodes.length >= 3) {
      return evaluateAst(argNodes[2], context, options);
    }

    return null;
  },
  image(argNodes, context, options): ImageValue {
    const [input] = evaluateArgNodes(argNodes, context, options);
    return {
      __kind: "image",
      source: stringifyValue(input),
    };
  },
  icon(argNodes, context, options): IconValue {
    const [input] = evaluateArgNodes(argNodes, context, options);
    return {
      __kind: "icon",
      name: stringifyValue(input),
    };
  },
  link(argNodes, context, options): LinkValue {
    const args = evaluateArgNodes(argNodes, context, options);
    return {
      __kind: "link",
      path: normalizePath(stringifyValue(args[0] ?? "")),
      display: args[1],
    };
  },
  list(argNodes, context, options): unknown[] {
    const args = evaluateArgNodes(argNodes, context, options);

    if (args.length === 0) {
      return [];
    }

    if (args.length === 1 && Array.isArray(args[0])) {
      return args[0];
    }

    if (args.length === 1) {
      return [args[0]];
    }

    return args;
  },
  max(argNodes, context, options): number {
    const args = evaluateArgNodes(argNodes, context, options);
    const values = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
    return Math.max(...values.map((entry) => toNumber(entry, options)));
  },
  min(argNodes, context, options): number {
    const args = evaluateArgNodes(argNodes, context, options);
    const values = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
    return Math.min(...values.map((entry) => toNumber(entry, options)));
  },
  now(): Date {
    return new Date();
  },
  number(argNodes, context, options): number {
    const [input] = evaluateArgNodes(argNodes, context, options);
    return toNumber(input, options);
  },
  today(): Date {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return now;
  },
  regexp(argNodes, context, options): RegExp {
    const [pattern, flags] = evaluateArgNodes(argNodes, context, options);
    return new RegExp(stringifyValue(pattern), stringifyValue(flags ?? ""));
  },

  // Compatibility helpers used by existing fixtures and summaries.
  contains(argNodes, context, options): boolean {
    const [container, needle] = evaluateArgNodes(argNodes, context, options);

    if (typeof container === "string") {
      return container.includes(stringifyValue(needle));
    }

    if (Array.isArray(container)) {
      return container.some((entry) => equalsValues(entry, needle, options));
    }

    if (isRecord(container)) {
      return !isNullish(needle) && Object.prototype.hasOwnProperty.call(container, String(needle));
    }

    return false;
  },
  sum(argNodes, context, options): number {
    const [values] = evaluateArgNodes(argNodes, context, options);

    if (!Array.isArray(values)) {
      return 0;
    }

    return values.reduce((total, entry) => total + toNumber(entry, options), 0);
  },
  avg(argNodes, context, options): number {
    const [values] = evaluateArgNodes(argNodes, context, options);

    if (!Array.isArray(values) || values.length === 0) {
      return 0;
    }

    const total = values.reduce((sum, entry) => sum + toNumber(entry, options), 0);
    return total / values.length;
  },
  count(argNodes, context, options): number {
    const [values] = evaluateArgNodes(argNodes, context, options);
    return Array.isArray(values) ? values.length : 0;
  },
};

const anyMethods: Record<string, MethodFunction> = {
  isTruthy(target): boolean {
    return toBoolean(target);
  },
  isType(target, argNodes, context, options): boolean {
    const [expectedRaw] = evaluateArgNodes(argNodes, context, options);
    const expected = stringifyValue(expectedRaw).toLowerCase();
    const actual = inferType(target).toLowerCase();

    if (expected === "regex") {
      return actual === "regexp";
    }

    if (expected === "array") {
      return actual === "list";
    }

    return actual === expected;
  },
  toString(target: unknown): string {
    return stringifyValue(target);
  },
  isEmpty(target): boolean {
    if (isNullish(target)) {
      return true;
    }

    if (typeof target === "string") {
      return target.length === 0;
    }

    if (Array.isArray(target)) {
      return target.length === 0;
    }

    if (isRecord(target)) {
      return Object.keys(target).length === 0;
    }

    return false;
  },
};

const dateMethods: Record<string, MethodFunction> = {
  date(target): Date {
    const date = toDate(target);
    date.setHours(0, 0, 0, 0);
    return date;
  },
  format(target, argNodes, context, options): string {
    const [format] = evaluateArgNodes(argNodes, context, options);
    return formatDate(toDate(target), stringifyValue(format));
  },
  time(target): string {
    return formatDate(toDate(target), "HH:mm:ss");
  },
  relative(target): string {
    return relativeDate(toDate(target));
  },
  isEmpty(): boolean {
    return false;
  },
};

const stringMethods: Record<string, MethodFunction> = {
  contains(target, argNodes, context, options): boolean {
    const [needle] = evaluateArgNodes(argNodes, context, options);
    return stringifyValue(target).includes(stringifyValue(needle));
  },
  containsAll(target, argNodes, context, options): boolean {
    const source = stringifyValue(target);
    const needles = evaluateArgNodes(argNodes, context, options).map((entry) => stringifyValue(entry));
    return needles.every((needle) => source.includes(needle));
  },
  containsAny(target, argNodes, context, options): boolean {
    const source = stringifyValue(target);
    const needles = evaluateArgNodes(argNodes, context, options).map((entry) => stringifyValue(entry));
    return needles.some((needle) => source.includes(needle));
  },
  endsWith(target, argNodes, context, options): boolean {
    const [query] = evaluateArgNodes(argNodes, context, options);
    return stringifyValue(target).endsWith(stringifyValue(query));
  },
  isEmpty(target): boolean {
    return stringifyValue(target).length === 0;
  },
  lower(target): string {
    return stringifyValue(target).toLowerCase();
  },
  upper(target): string {
    return stringifyValue(target).toUpperCase();
  },
  replace(target, argNodes, context, options): string {
    const [pattern, replacement] = evaluateArgNodes(argNodes, context, options);
    const source = stringifyValue(target);

    if (pattern instanceof RegExp) {
      return source.replace(pattern, stringifyValue(replacement));
    }

    return source.replaceAll(stringifyValue(pattern), stringifyValue(replacement));
  },
  repeat(target, argNodes, context, options): string {
    const [count] = evaluateArgNodes(argNodes, context, options);
    return stringifyValue(target).repeat(Math.max(0, Math.floor(toNumber(count, options))));
  },
  reverse(target): string {
    return [...stringifyValue(target)].reverse().join("");
  },
  slice(target, argNodes, context, options): string {
    const [start, end] = evaluateArgNodes(argNodes, context, options);
    const source = stringifyValue(target);
    return source.slice(Math.trunc(toNumber(start, options)), isNullish(end) ? undefined : Math.trunc(toNumber(end, options)));
  },
  split(target, argNodes, context, options): unknown[] {
    const [separator, limit] = evaluateArgNodes(argNodes, context, options);
    const source = stringifyValue(target);
    const parts = separator instanceof RegExp
      ? source.split(separator)
      : source.split(stringifyValue(separator));

    if (isNullish(limit)) {
      return parts;
    }

    return parts.slice(0, Math.max(0, Math.trunc(toNumber(limit, options))));
  },
  startsWith(target, argNodes, context, options): boolean {
    const [query] = evaluateArgNodes(argNodes, context, options);
    return stringifyValue(target).startsWith(stringifyValue(query));
  },
  title(target): string {
    return stringifyValue(target)
      .toLowerCase()
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  },
  trim(target): string {
    return stringifyValue(target).trim();
  },
};

const numberMethods: Record<string, MethodFunction> = {
  abs(target, _argNodes, _context, options): number {
    return Math.abs(toNumber(target, options));
  },
  ceil(target, _argNodes, _context, options): number {
    return Math.ceil(toNumber(target, options));
  },
  floor(target, _argNodes, _context, options): number {
    return Math.floor(toNumber(target, options));
  },
  isEmpty(target): boolean {
    return isNullish(target);
  },
  round(target, argNodes, context, options): number {
    const [digitsRaw] = evaluateArgNodes(argNodes, context, options);
    const digits = isNullish(digitsRaw) ? 0 : Math.max(0, Math.floor(toNumber(digitsRaw, options)));
    const numeric = toNumber(target, options);
    const multiplier = 10 ** digits;
    return Math.round(numeric * multiplier) / multiplier;
  },
  toFixed(target, argNodes, context, options): string {
    const [precisionRaw] = evaluateArgNodes(argNodes, context, options);
    const precision = Math.max(0, Math.floor(toNumber(precisionRaw ?? 0, options)));
    return toNumber(target, options).toFixed(precision);
  },
};

const listMethods: Record<string, MethodFunction> = {
  contains(target, argNodes, context, options): boolean {
    const [needle] = evaluateArgNodes(argNodes, context, options);
    const list = Array.isArray(target) ? target : [];
    return list.some((entry) => equalsValues(entry, needle, options));
  },
  containsAll(target, argNodes, context, options): boolean {
    const list = Array.isArray(target) ? target : [];
    const needles = evaluateArgNodes(argNodes, context, options);
    return needles.every((needle) => list.some((entry) => equalsValues(entry, needle, options)));
  },
  containsAny(target, argNodes, context, options): boolean {
    const list = Array.isArray(target) ? target : [];
    const needles = evaluateArgNodes(argNodes, context, options);
    return needles.some((needle) => list.some((entry) => equalsValues(entry, needle, options)));
  },
  filter(target, argNodes, context, options): unknown[] {
    const list = Array.isArray(target) ? target : [];
    const expression = argNodes[0];

    if (!expression) {
      return list;
    }

    return list.filter((value, index) => {
      const scoped: EvaluationContext = {
        ...context,
        value,
        index,
      };
      return toBoolean(evaluateAst(expression, scoped, options));
    });
  },
  flat(target): unknown[] {
    const list = Array.isArray(target) ? target : [];
    return list.flat(Infinity);
  },
  isEmpty(target): boolean {
    return !Array.isArray(target) || target.length === 0;
  },
  join(target, argNodes, context, options): string {
    const [separator] = evaluateArgNodes(argNodes, context, options);
    const list = Array.isArray(target) ? target : [];
    const joiner = isNullish(separator) ? "," : stringifyValue(separator);
    return list.map((entry) => stringifyValue(entry)).join(joiner);
  },
  map(target, argNodes, context, options): unknown[] {
    const list = Array.isArray(target) ? target : [];
    const expression = argNodes[0];

    if (!expression) {
      return list;
    }

    return list.map((value, index) => {
      const scoped: EvaluationContext = {
        ...context,
        value,
        index,
      };
      return evaluateAst(expression, scoped, options);
    });
  },
  reduce(target, argNodes, context, options): unknown {
    const list = Array.isArray(target) ? target : [];
    const expression = argNodes[0];

    if (!expression) {
      return undefined;
    }

    const initial = argNodes[1] ? evaluateAst(argNodes[1], context, options) : undefined;

    return list.reduce((acc, value, index) => {
      const scoped: EvaluationContext = {
        ...context,
        value,
        index,
        acc,
      };
      return evaluateAst(expression, scoped, options);
    }, initial);
  },
  reverse(target): unknown[] {
    const list = Array.isArray(target) ? target : [];
    return [...list].reverse();
  },
  slice(target, argNodes, context, options): unknown[] {
    const [startRaw, endRaw] = evaluateArgNodes(argNodes, context, options);
    const list = Array.isArray(target) ? target : [];
    const start = Math.trunc(toNumber(startRaw ?? 0, options));
    const end = isNullish(endRaw) ? undefined : Math.trunc(toNumber(endRaw, options));
    return list.slice(start, end);
  },
  sort(target, _argNodes, _context, options): unknown[] {
    const list = Array.isArray(target) ? target : [];
    return [...list].sort((left, right) => compareValues(left, right, options));
  },
  unique(target): unknown[] {
    const list = Array.isArray(target) ? target : [];
    const seen = new Set<string>();
    const output: unknown[] = [];

    for (const entry of list) {
      const key = stableStringify(entry);

      if (!seen.has(key)) {
        seen.add(key);
        output.push(entry);
      }
    }

    return output;
  },
};

const linkMethods: Record<string, MethodFunction> = {
  asFile(target, _argNodes, context): unknown {
    if (!isLinkValue(target)) {
      return undefined;
    }

    return resolveFileArg(target.path, context);
  },
  linksTo(target, argNodes, context, options): boolean {
    if (!isLinkValue(target)) {
      return false;
    }

    const [other] = evaluateArgNodes(argNodes, context, options);
    const source = resolveFileArg(target.path, context);

    if (!source) {
      return false;
    }

    return fileMethods.hasLink(source, [
      {
        kind: "literal",
        value: other,
        raw: JSON.stringify(stringifyValue(other)),
      },
    ], context, options) as boolean;
  },
};

const fileMethods: Record<string, MethodFunction> = {
  asLink(target, argNodes, context, options): LinkValue {
    const file = isFileLike(target) ? target : createSyntheticFile(stringifyValue(target));
    const [display] = evaluateArgNodes(argNodes, context, options);

    return {
      __kind: "link",
      path: normalizePath(String(file.path)),
      display,
    };
  },
  hasLink(target, argNodes, context, options): boolean {
    if (!isFileLike(target)) {
      return false;
    }

    const [other] = evaluateArgNodes(argNodes, context, options);
    const targetPath = resolveComparablePath(other);

    if (!targetPath) {
      return false;
    }

    const links = Array.isArray(target.links) ? target.links.map((entry) => stringifyValue(entry)) : [];
    return links.some((entry) => matchesLinkTarget(entry, targetPath));
  },
  hasProperty(target, argNodes, context, options): boolean {
    if (!isFileLike(target)) {
      return false;
    }

    const [nameRaw] = evaluateArgNodes(argNodes, context, options);
    const name = stringifyValue(nameRaw);
    const props = isRecord(target.properties) ? target.properties : {};
    return Object.prototype.hasOwnProperty.call(props, name);
  },
  hasTag(target, argNodes, context, options): boolean {
    if (!isFileLike(target)) {
      return false;
    }

    const tags = Array.isArray(target.tags)
      ? target.tags.filter((entry): entry is string => typeof entry === "string").map(normalizeTag)
      : [];
    const wanted = evaluateArgNodes(argNodes, context, options)
      .map((entry) => normalizeTag(stringifyValue(entry)))
      .filter((entry) => entry.length > 0);

    return wanted.some((query) => tags.some((tag) => tag === query || tag.startsWith(`${query}/`)));
  },
  inFolder(target, argNodes, context, options): boolean {
    if (!isFileLike(target)) {
      return false;
    }

    const [folderRaw] = evaluateArgNodes(argNodes, context, options);
    const folder = normalizePath(stringifyValue(folderRaw)).replace(/\/+$/, "");
    const fileFolder = normalizePath(String(target.folder));

    if (folder.length === 0) {
      return true;
    }

    return fileFolder === folder || fileFolder.startsWith(`${folder}/`);
  },
};

const objectMethods: Record<string, MethodFunction> = {
  isEmpty(target): boolean {
    return !isRecord(target) || Object.keys(target).length === 0;
  },
  keys(target): unknown[] {
    return isRecord(target) ? Object.keys(target) : [];
  },
  values(target): unknown[] {
    return isRecord(target) ? Object.values(target) : [];
  },
};

const regexpMethods: Record<string, MethodFunction> = {
  matches(target, argNodes, context, options): boolean {
    if (!(target instanceof RegExp)) {
      return false;
    }

    const [value] = evaluateArgNodes(argNodes, context, options);
    return target.test(stringifyValue(value));
  },
};

const methodRegistries: Record<string, Record<string, MethodFunction>> = {
  date: dateMethods,
  string: stringMethods,
  number: numberMethods,
  list: listMethods,
  link: linkMethods,
  file: fileMethods,
  object: objectMethods,
  regexp: regexpMethods,
};

function invokeGlobalFunction(
  name: string,
  argNodes: ExpressionNode[],
  context: EvaluationContext,
  options: EvaluateOptions,
): unknown {
  const fn = globalFunctions[name];

  if (!fn) {
    if (options.strict) {
      throw new Error(`unknown function: ${name}`);
    }

    return undefined;
  }

  return fn(argNodes, context, options);
}

function invokeMethod(
  target: unknown,
  name: string,
  argNodes: ExpressionNode[],
  context: EvaluationContext,
  options: EvaluateOptions,
): unknown {
  const type = inferType(target);
  const specificRegistry = methodRegistries[type];
  const fn = specificRegistry?.[name] ?? anyMethods[name];

  if (!fn) {
    if (options.strict) {
      throw new Error(`unknown method: ${name}`);
    }

    return undefined;
  }

  return fn(target, argNodes, context, options);
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

  if (expression.kind === "array") {
    return expression.elements.map((element) => evaluateAst(element, context, options));
  }

  if (expression.kind === "object") {
    return Object.fromEntries(
      expression.entries.map((entry) => [entry.key, evaluateAst(entry.value, context, options)]),
    );
  }

  if (expression.kind === "unary") {
    const value = evaluateAst(expression.argument, context, options);

    switch (expression.operator) {
      case "-":
        return -toNumber(value, options);
      case "!":
      case "not":
        return !toBoolean(value);
      default:
        throw new Error(`unsupported unary operator: ${expression.operator}`);
    }
  }

  if (expression.kind === "binary") {
    if (expression.operator === "and" || expression.operator === "&&") {
      return toBoolean(evaluateAst(expression.left, context, options))
        ? evaluateAst(expression.right, context, options)
        : false;
    }

    if (expression.operator === "or" || expression.operator === "||") {
      return toBoolean(evaluateAst(expression.left, context, options))
        ? true
        : evaluateAst(expression.right, context, options);
    }

    const left = evaluateAst(expression.left, context, options);
    const right = evaluateAst(expression.right, context, options);

    switch (expression.operator) {
      case "==":
        return equalsValues(left, right, options);
      case "!=":
        return !equalsValues(left, right, options);
      case ">":
        return compareValues(left, right, options) > 0;
      case ">=":
        return compareValues(left, right, options) >= 0;
      case "<":
        return compareValues(left, right, options) < 0;
      case "<=":
        return compareValues(left, right, options) <= 0;
      case "+":
        return addValues(left, right, options);
      case "-":
        return subtractValues(left, right, options);
      case "*":
        return multiplyValues(left, right, options);
      case "/":
        return divideValues(left, right, options);
      case "%":
        return toNumber(left, options) % toNumber(right, options);
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
      return object[Math.trunc(toNumber(index, options))];
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
      return invokeGlobalFunction(expression.callee.name, expression.args, context, options);
    }

    if (expression.callee.kind === "member") {
      const target = evaluateAst(expression.callee.object, context, options);
      return invokeMethod(target, expression.callee.property, expression.args, context, options);
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
