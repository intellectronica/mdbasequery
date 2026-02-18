import { compileExpression, evaluateAst, evaluateExpression } from "./expression/index.js";

import type { ExpressionNode } from "./expression/index.js";
import type {
  FilterSpec,
  IndexedDocument,
  QueryDiagnostics,
  QueryGroup,
  QueryResult,
  QueryRow,
  QuerySpec,
  ViewSpec,
} from "../types.js";

const BUILTIN_SUMMARIES = new Set([
  "count",
  "sum",
  "avg",
  "min",
  "max",
  "average",
  "median",
  "stddev",
  "earliest",
  "latest",
  "range",
  "checked",
  "unchecked",
  "empty",
  "filled",
  "unique",
]);

export interface CompileQueryOptions {
  strict?: boolean;
}

export interface CompiledQuery {
  spec: QuerySpec;
  strict: boolean;
  globalFilter?: CompiledFilter;
  viewFilters: Map<string, CompiledFilter | undefined>;
  formulas: Map<string, ExpressionNode>;
  formulaOrder: string[];
  summaryFormulas: Map<string, ExpressionNode>;
}

type CompiledFilter =
  | { kind: "expr"; expression: ExpressionNode }
  | { kind: "tree"; and?: CompiledFilter[]; or?: CompiledFilter[]; not?: CompiledFilter };

function withEvalContext(row: QueryRow, filesByPath: Map<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    filesByPath,
  };
}

const DOTTED_IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

function evaluatePropertyRef(
  property: string,
  row: QueryRow,
  strict: boolean,
  filesByPath: Map<string, unknown>,
): unknown {
  if (!DOTTED_IDENTIFIER_RE.test(property) && Object.prototype.hasOwnProperty.call(row.note, property)) {
    return row.note[property];
  }

  return evaluateExpression(property, withEvalContext(row, filesByPath), { strict });
}

function toComparable(value: unknown): string | number {
  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}

function discoverFormulaDeps(expression: string): string[] {
  const matches = expression.matchAll(/\bformula\.([A-Za-z_][A-Za-z0-9_]*)\b/g);
  const output = new Set<string>();

  for (const match of matches) {
    if (match[1]) {
      output.add(match[1]);
    }
  }

  return [...output];
}

function topoSort(formulas: Record<string, string>): string[] {
  const keys = Object.keys(formulas).sort((left, right) => left.localeCompare(right));
  const dependencies = new Map<string, string[]>();

  for (const key of keys) {
    const deps = discoverFormulaDeps(formulas[key]).filter((dep) => dep in formulas);
    dependencies.set(key, deps);
  }

  const temp = new Set<string>();
  const visited = new Set<string>();
  const output: string[] = [];

  function visit(node: string): void {
    if (visited.has(node)) {
      return;
    }

    if (temp.has(node)) {
      throw new Error(`formula cycle detected at ${node}`);
    }

    temp.add(node);
    for (const dep of dependencies.get(node) ?? []) {
      visit(dep);
    }
    temp.delete(node);
    visited.add(node);
    output.push(node);
  }

  for (const key of keys) {
    visit(key);
  }

  return output;
}

function compileFilter(filter?: FilterSpec): CompiledFilter | undefined {
  if (!filter) {
    return undefined;
  }

  if (typeof filter === "string") {
    return {
      kind: "expr",
      expression: compileExpression(filter),
    };
  }

  return {
    kind: "tree",
    and: filter.and?.map((entry) => compileFilter(entry)).filter((entry): entry is CompiledFilter => !!entry),
    or: filter.or?.map((entry) => compileFilter(entry)).filter((entry): entry is CompiledFilter => !!entry),
    not: compileFilter(filter.not),
  };
}

function evaluateFilter(
  filter: CompiledFilter | undefined,
  context: QueryRow,
  strict: boolean,
  filesByPath: Map<string, unknown>,
): boolean {
  if (!filter) {
    return true;
  }

  if (filter.kind === "expr") {
    const result = evaluateAst(filter.expression, withEvalContext(context, filesByPath), { strict });
    return Boolean(result);
  }

  if (filter.and && !filter.and.every((entry) => evaluateFilter(entry, context, strict, filesByPath))) {
    return false;
  }

  if (
    filter.or &&
    filter.or.length > 0 &&
    !filter.or.some((entry) => evaluateFilter(entry, context, strict, filesByPath))
  ) {
    return false;
  }

  if (filter.not && evaluateFilter(filter.not, context, strict, filesByPath)) {
    return false;
  }

  return true;
}

function getView(spec: QuerySpec, requestedName?: string): ViewSpec {
  if (!requestedName) {
    return spec.views[0];
  }

  const view = spec.views.find((entry) => entry.name === requestedName);

  if (!view) {
    throw new Error(`view not found: ${requestedName}`);
  }

  return view;
}

function evaluateFormulas(
  row: QueryRow,
  formulas: Map<string, ExpressionNode>,
  order: string[],
  strict: boolean,
  filesByPath: Map<string, unknown>,
): void {
  for (const name of order) {
    const ast = formulas.get(name);

    if (!ast) {
      continue;
    }

    row.formula[name] = evaluateAst(ast, withEvalContext(row, filesByPath), { strict });
  }
}

function projectRow(
  row: QueryRow,
  columns: string[],
  strict: boolean,
  filesByPath: Map<string, unknown>,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};

  for (const column of columns) {
    output[column] = evaluatePropertyRef(column, row, strict, filesByPath);
  }

  return output;
}

function stableSort(
  rows: QueryRow[],
  view: ViewSpec,
  strict: boolean,
  filesByPath: Map<string, unknown>,
): QueryRow[] {
  const order = view.sort ?? [];

  const sorted = [...rows].sort((left, right) => {
    for (const spec of order) {
      const leftValue = toComparable(evaluatePropertyRef(spec.by, left, strict, filesByPath));
      const rightValue = toComparable(evaluatePropertyRef(spec.by, right, strict, filesByPath));

      if (leftValue < rightValue) {
        return spec.direction === "desc" ? 1 : -1;
      }

      if (leftValue > rightValue) {
        return spec.direction === "desc" ? -1 : 1;
      }
    }

    return left.file.path.localeCompare(right.file.path);
  });

  return sorted;
}

function groupRows(
  rows: QueryRow[],
  view: ViewSpec,
  strict: boolean,
  filesByPath: Map<string, unknown>,
): QueryGroup[] | undefined {
  if (!view.groupBy) {
    return undefined;
  }

  const groupProperty = typeof view.groupBy === "string" ? view.groupBy : view.groupBy.property;
  const groupDirection = typeof view.groupBy === "string" ? "asc" : view.groupBy.direction;

  const groups = new Map<string, QueryGroup>();

  for (const row of rows) {
    const key = evaluatePropertyRef(groupProperty, row, strict, filesByPath);
    const mapKey = JSON.stringify(key);

    if (!groups.has(mapKey)) {
      groups.set(mapKey, { key, rows: [] });
    }

    groups.get(mapKey)?.rows.push(row);
  }

  const sorted = [...groups.values()].sort((left, right) => String(left.key).localeCompare(String(right.key)));

  if (groupDirection === "desc") {
    sorted.reverse();
  }

  return sorted;
}

function applyLimit(rows: QueryRow[], view: ViewSpec): QueryRow[] {
  if (view.limit === undefined) {
    return rows;
  }

  return rows.slice(0, view.limit);
}

function inferColumns(rows: QueryRow[], compiled: CompiledQuery): string[] {
  const columns = ["file.name"];
  const seen = new Set(columns);

  const stableRows = [...rows].sort((left, right) => left.file.path.localeCompare(right.file.path));

  for (const row of stableRows) {
    for (const key of Object.keys(row.note)) {
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      columns.push(key);
    }
  }

  for (const formulaName of Object.keys(compiled.spec.formulas ?? {}).sort((left, right) => left.localeCompare(right))) {
    const key = `formula.${formulaName}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    columns.push(key);
  }

  if (columns.length === 1) {
    columns.push("file.path");
  }

  return columns;
}

function toSummaryName(name: string): string {
  return name.trim().toLowerCase();
}

function isDateList(values: unknown[]): values is Date[] {
  return values.length > 0 && values.every((entry) => entry instanceof Date);
}

function toNumberList(values: unknown[]): number[] {
  return values
    .map((entry) => {
      if (entry instanceof Date) {
        return entry.getTime();
      }

      const parsed = Number(entry);
      return Number.isFinite(parsed) ? parsed : Number.NaN;
    })
    .filter((entry) => Number.isFinite(entry));
}

function evalBuiltinSummary(name: string, values: unknown[]): unknown {
  const normalized = toSummaryName(name);

  switch (normalized) {
    case "count":
      return values.length;
    case "sum":
      return toNumberList(values).reduce((total, entry) => total + entry, 0);
    case "avg":
    case "average": {
      const numbers = toNumberList(values);

      if (numbers.length === 0) {
        return 0;
      }

      return numbers.reduce((total, entry) => total + entry, 0) / numbers.length;
    }
    case "min": {
      const numbers = toNumberList(values);

      if (numbers.length === 0) {
        return null;
      }

      return Math.min(...numbers);
    }
    case "max": {
      const numbers = toNumberList(values);

      if (numbers.length === 0) {
        return null;
      }

      return Math.max(...numbers);
    }
    case "range": {
      if (isDateList(values)) {
        const times = values.map((entry) => entry.getTime());

        if (times.length === 0) {
          return null;
        }

        return Math.max(...times) - Math.min(...times);
      }

      const numbers = toNumberList(values);

      if (numbers.length === 0) {
        return null;
      }

      return Math.max(...numbers) - Math.min(...numbers);
    }
    case "median": {
      const numbers = toNumberList(values).sort((left, right) => left - right);

      if (numbers.length === 0) {
        return null;
      }

      const middle = Math.floor(numbers.length / 2);

      if (numbers.length % 2 === 0) {
        return (numbers[middle - 1] + numbers[middle]) / 2;
      }

      return numbers[middle];
    }
    case "stddev": {
      const numbers = toNumberList(values);

      if (numbers.length === 0) {
        return null;
      }

      const mean = numbers.reduce((sum, entry) => sum + entry, 0) / numbers.length;
      const variance = numbers.reduce((sum, entry) => sum + (entry - mean) ** 2, 0) / numbers.length;
      return Math.sqrt(variance);
    }
    case "earliest":
      if (!isDateList(values) || values.length === 0) {
        return null;
      }

      return new Date(Math.min(...values.map((entry) => entry.getTime())));
    case "latest":
      if (!isDateList(values) || values.length === 0) {
        return null;
      }

      return new Date(Math.max(...values.map((entry) => entry.getTime())));
    case "checked":
      return values.filter((entry) => entry === true).length;
    case "unchecked":
      return values.filter((entry) => entry === false).length;
    case "empty":
      return values.filter((entry) => entry === null || entry === undefined || entry === "").length;
    case "filled":
      return values.filter((entry) => entry !== null && entry !== undefined && entry !== "").length;
    case "unique":
      return new Set(values.map((entry) => JSON.stringify(entry))).size;
    default:
      return null;
  }
}

function computeSummaries(
  rows: QueryRow[],
  spec: QuerySpec,
  view: ViewSpec,
  compiled: CompiledQuery,
): Record<string, unknown> | undefined {
  const summaryMap = view.summaries;

  if (!summaryMap || Object.keys(summaryMap).length === 0) {
    return undefined;
  }

  const output: Record<string, unknown> = {};

  for (const [column, summaryName] of Object.entries(summaryMap)) {
    const values = rows.map((row) => row.projected[column]);

    if (BUILTIN_SUMMARIES.has(toSummaryName(summaryName))) {
      output[column] = evalBuiltinSummary(summaryName, values);
      continue;
    }

    const summaryExpression = compiled.summaryFormulas.get(summaryName) ??
      (spec.summaries?.[summaryName] ? compileExpression(spec.summaries[summaryName]) : undefined);

    if (!summaryExpression) {
      output[column] = null;
      continue;
    }

    output[column] = evaluateAst(
      summaryExpression,
      {
        values,
      },
      { strict: compiled.strict },
    );
  }

  return output;
}

export function compileQuery(spec: QuerySpec, options: CompileQueryOptions = {}): CompiledQuery {
  const strict = options.strict ?? true;
  const formulas = spec.formulas ?? {};

  const formulaOrder = topoSort(formulas);
  const compiledFormulas = new Map<string, ExpressionNode>();

  for (const [name, expression] of Object.entries(formulas)) {
    compiledFormulas.set(name, compileExpression(expression));
  }

  const viewFilters = new Map<string, CompiledFilter | undefined>();

  for (const view of spec.views) {
    viewFilters.set(view.name, compileFilter(view.filters));
  }

  const summaryFormulas = new Map<string, ExpressionNode>();

  for (const [name, expression] of Object.entries(spec.summaries ?? {})) {
    summaryFormulas.set(name, compileExpression(expression));
  }

  return {
    spec,
    strict,
    globalFilter: compileFilter(spec.filters),
    viewFilters,
    formulas: compiledFormulas,
    formulaOrder,
    summaryFormulas,
  };
}

export interface ExecuteQueryOptions {
  compiled: CompiledQuery;
  view?: string;
  documents: IndexedDocument[];
  diagnostics?: QueryDiagnostics;
}

export function executeCompiledQuery(options: ExecuteQueryOptions): QueryResult {
  const start = Date.now();
  const { compiled } = options;
  const view = getView(compiled.spec, options.view);
  const diagnostics: QueryDiagnostics = options.diagnostics ?? { errors: [], warnings: [] };
  const filesByPath = new Map<string, unknown>();

  for (const document of options.documents) {
    filesByPath.set(document.file.path, document.file);
  }

  const rows: QueryRow[] = [];

  for (const document of options.documents) {
    const row: QueryRow = {
      note: document.note.frontmatter,
      file: document.file,
      formula: {},
      this: {
        filePath: document.file.path,
        name: document.file.name,
      },
      projected: {},
    };

    try {
      evaluateFormulas(row, compiled.formulas, compiled.formulaOrder, compiled.strict, filesByPath);

      if (!evaluateFilter(compiled.globalFilter, row, compiled.strict, filesByPath)) {
        continue;
      }

      const viewFilter = compiled.viewFilters.get(view.name);
      if (!evaluateFilter(viewFilter, row, compiled.strict, filesByPath)) {
        continue;
      }

      rows.push(row);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      diagnostics.errors.push(`row ${document.file.path}: ${message}`);
    }
  }

  const sorted = stableSort(rows, view, compiled.strict, filesByPath);
  const limited = applyLimit(sorted, view);

  const columns =
    (view.order && view.order.length > 0
      ? view.order
      : undefined) ??
    view.properties ??
    compiled.spec.properties ??
    inferColumns(limited, compiled);

  for (const row of limited) {
    row.projected = projectRow(row, columns, compiled.strict, filesByPath);
  }

  const groups = groupRows(limited, view, compiled.strict, filesByPath);
  const summaries = computeSummaries(limited, compiled.spec, view, compiled);

  return {
    rows: limited,
    columns,
    groups,
    summaries,
    stats: {
      scannedFiles: options.documents.length,
      markdownFiles: options.documents.length,
      matchedRows: limited.length,
      elapsedMs: Date.now() - start,
    },
    diagnostics,
  };
}
