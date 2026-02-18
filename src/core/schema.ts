import { parse as parseYaml } from "yaml";

import type {
  FilterSpec,
  QuerySpec,
  SortDirection,
  SortSpec,
  ViewSpec,
} from "../types.js";

export class QueryValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(issues.join("; "));
    this.name = "QueryValidationError";
    this.issues = issues;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeFilter(value: unknown, path: string, issues: string[]): FilterSpec | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "string") {
    return value;
  }

  if (!isPlainObject(value)) {
    issues.push(`${path} must be a string or filter object`);
    return undefined;
  }

  const result: Exclude<FilterSpec, string> = {};
  const keys = Object.keys(value);

  for (const key of keys) {
    if (key !== "and" && key !== "or" && key !== "not") {
      issues.push(`${path}.${key} is not a supported filter operator`);
    }
  }

  if ("and" in value) {
    if (!Array.isArray(value.and)) {
      issues.push(`${path}.and must be an array`);
    } else {
      result.and = value.and
        .map((entry, index) => normalizeFilter(entry, `${path}.and[${index}]`, issues))
        .filter((entry): entry is FilterSpec => entry !== undefined);
    }
  }

  if ("or" in value) {
    if (!Array.isArray(value.or)) {
      issues.push(`${path}.or must be an array`);
    } else {
      result.or = value.or
        .map((entry, index) => normalizeFilter(entry, `${path}.or[${index}]`, issues))
        .filter((entry): entry is FilterSpec => entry !== undefined);
    }
  }

  if ("not" in value) {
    result.not = normalizeFilter(value.not, `${path}.not`, issues);
  }

  return result;
}

function parseSortSpec(value: string): SortSpec {
  const [property, directionText] = value.split(":");
  const direction = (directionText ?? "asc").toLowerCase() as SortDirection;

  return {
    by: property.trim(),
    direction: direction === "desc" ? "desc" : "asc",
  };
}

function normalizeSortList(
  value: unknown,
  path: string,
  issues: string[],
): SortSpec[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    issues.push(`${path} must be an array`);
    return undefined;
  }

  const output: SortSpec[] = [];

  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];

    if (typeof entry === "string") {
      output.push(parseSortSpec(entry));
      continue;
    }

    if (isPlainObject(entry) && typeof entry.by === "string") {
      const direction = String(entry.direction ?? "asc").toLowerCase();

      output.push({
        by: entry.by,
        direction: direction === "desc" ? "desc" : "asc",
      });

      continue;
    }

    issues.push(`${path}[${index}] must be a string (property:direction) or sort object`);
  }

  return output;
}

function normalizeView(value: unknown, index: number, issues: string[]): ViewSpec | undefined {
  const path = `views[${index}]`;

  if (!isPlainObject(value)) {
    issues.push(`${path} must be an object`);
    return undefined;
  }

  if (typeof value.type !== "string") {
    issues.push(`${path}.type must be a string`);
  }

  if (typeof value.name !== "string") {
    issues.push(`${path}.name must be a string`);
  }

  const limitRaw = value.limit;
  let limit: number | undefined;

  if (limitRaw !== undefined) {
    const parsedLimit = Number(limitRaw);

    if (!Number.isFinite(parsedLimit) || parsedLimit < 0) {
      issues.push(`${path}.limit must be a non-negative number`);
    } else {
      limit = Math.floor(parsedLimit);
    }
  }

  const groupBy = value.groupBy;
  if (groupBy !== undefined && typeof groupBy !== "string") {
    issues.push(`${path}.groupBy must be a string`);
  }

  const summaries = value.summaries;
  if (summaries !== undefined && !isPlainObject(summaries)) {
    issues.push(`${path}.summaries must be an object`);
  }

  const properties = value.properties;
  if (properties !== undefined && !Array.isArray(properties)) {
    issues.push(`${path}.properties must be an array of strings`);
  }

  const order = normalizeSortList(value.order, `${path}.order`, issues);
  const filters = normalizeFilter(value.filters, `${path}.filters`, issues);

  return {
    type: String(value.type ?? "table"),
    name: String(value.name ?? `view-${index}`),
    filters,
    order,
    groupBy: typeof groupBy === "string" ? groupBy : undefined,
    limit,
    summaries: isPlainObject(summaries)
      ? Object.fromEntries(
          Object.entries(summaries)
            .filter(([, entryValue]) => typeof entryValue === "string")
            .map(([summaryKey, entryValue]) => [summaryKey, String(entryValue)]),
        )
      : undefined,
    properties: Array.isArray(properties)
      ? properties.filter((entry): entry is string => typeof entry === "string")
      : undefined,
  };
}

export function validateAndNormalizeQuery(value: unknown): QuerySpec {
  const issues: string[] = [];

  if (!isPlainObject(value)) {
    throw new QueryValidationError(["query must be a YAML object"]);
  }

  const viewsRaw = value.views;

  if (!Array.isArray(viewsRaw) || viewsRaw.length === 0) {
    issues.push("views must be a non-empty array");
  }

  const formulasRaw = value.formulas;
  if (formulasRaw !== undefined && !isPlainObject(formulasRaw)) {
    issues.push("formulas must be an object");
  }

  const propertiesRaw = value.properties;
  if (propertiesRaw !== undefined && !Array.isArray(propertiesRaw)) {
    issues.push("properties must be an array of strings");
  }

  const summariesRaw = value.summaries;
  if (summariesRaw !== undefined && !isPlainObject(summariesRaw)) {
    issues.push("summaries must be an object");
  }

  const views = Array.isArray(viewsRaw)
    ? viewsRaw
        .map((entry, index) => normalizeView(entry, index, issues))
        .filter((entry): entry is ViewSpec => entry !== undefined)
    : [];

  const spec: QuerySpec = {
    filters: normalizeFilter(value.filters, "filters", issues),
    formulas: isPlainObject(formulasRaw)
      ? Object.fromEntries(
          Object.entries(formulasRaw)
            .filter(([, entryValue]) => typeof entryValue === "string")
            .map(([formulaName, entryValue]) => [formulaName, String(entryValue)]),
        )
      : undefined,
    properties: Array.isArray(propertiesRaw)
      ? propertiesRaw.filter((entry): entry is string => typeof entry === "string")
      : undefined,
    summaries: isPlainObject(summariesRaw)
      ? Object.fromEntries(
          Object.entries(summariesRaw)
            .filter(([, entryValue]) => typeof entryValue === "string")
            .map(([summaryName, entryValue]) => [summaryName, String(entryValue)]),
        )
      : undefined,
    views,
  };

  if (issues.length > 0) {
    throw new QueryValidationError(issues);
  }

  return spec;
}

export function parseBaseYaml(input: string): QuerySpec {
  let parsed: unknown;

  try {
    parsed = parseYaml(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new QueryValidationError([`invalid YAML: ${message}`]);
  }

  return validateAndNormalizeQuery(parsed);
}
