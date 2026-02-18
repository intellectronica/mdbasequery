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

const BUILTIN_SUMMARIES = new Set(["count", "sum", "avg", "min", "max"]);

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

function evaluateFilter(filter: CompiledFilter | undefined, context: QueryRow, strict: boolean): boolean {
  if (!filter) {
    return true;
  }

  if (filter.kind === "expr") {
    const result = evaluateAst(filter.expression, context, { strict });
    return Boolean(result);
  }

  if (filter.and && !filter.and.every((entry) => evaluateFilter(entry, context, strict))) {
    return false;
  }

  if (filter.or && filter.or.length > 0 && !filter.or.some((entry) => evaluateFilter(entry, context, strict))) {
    return false;
  }

  if (filter.not && evaluateFilter(filter.not, context, strict)) {
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
): void {
  for (const name of order) {
    const ast = formulas.get(name);

    if (!ast) {
      continue;
    }

    row.formula[name] = evaluateAst(ast, row, { strict });
  }
}

function projectRow(row: QueryRow, columns: string[], strict: boolean): Record<string, unknown> {
  const output: Record<string, unknown> = {};

  for (const column of columns) {
    output[column] = evaluateExpression(column, row, { strict });
  }

  return output;
}

function stableSort(rows: QueryRow[], view: ViewSpec, strict: boolean): QueryRow[] {
  const order = view.order ?? [];

  const sorted = [...rows].sort((left, right) => {
    for (const spec of order) {
      const leftValue = toComparable(evaluateExpression(spec.by, left, { strict }));
      const rightValue = toComparable(evaluateExpression(spec.by, right, { strict }));

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

function groupRows(rows: QueryRow[], view: ViewSpec, strict: boolean): QueryGroup[] | undefined {
  if (!view.groupBy) {
    return undefined;
  }

  const groups = new Map<string, QueryGroup>();

  for (const row of rows) {
    const key = evaluateExpression(view.groupBy, row, { strict });
    const mapKey = JSON.stringify(key);

    if (!groups.has(mapKey)) {
      groups.set(mapKey, { key, rows: [] });
    }

    groups.get(mapKey)?.rows.push(row);
  }

  return [...groups.values()].sort((left, right) => String(left.key).localeCompare(String(right.key)));
}

function applyLimit(rows: QueryRow[], view: ViewSpec): QueryRow[] {
  if (view.limit === undefined) {
    return rows;
  }

  return rows.slice(0, view.limit);
}

function evalBuiltinSummary(name: string, values: unknown[]): unknown {
  switch (name) {
    case "count":
      return values.length;
    case "sum":
      return values.reduce<number>((total, entry) => total + Number(entry ?? 0), 0);
    case "avg": {
      if (values.length === 0) {
        return 0;
      }

      const sum = values.reduce<number>((total, entry) => total + Number(entry ?? 0), 0);
      return sum / values.length;
    }
    case "min":
      return values.length === 0 ? null : Math.min(...values.map((entry) => Number(entry)));
    case "max":
      return values.length === 0 ? null : Math.max(...values.map((entry) => Number(entry)));
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

    if (BUILTIN_SUMMARIES.has(summaryName)) {
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
      evaluateFormulas(row, compiled.formulas, compiled.formulaOrder, compiled.strict);

      if (!evaluateFilter(compiled.globalFilter, row, compiled.strict)) {
        continue;
      }

      const viewFilter = compiled.viewFilters.get(view.name);
      if (!evaluateFilter(viewFilter, row, compiled.strict)) {
        continue;
      }

      rows.push(row);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      diagnostics.errors.push(`row ${document.file.path}: ${message}`);
    }
  }

  const sorted = stableSort(rows, view, compiled.strict);
  const limited = applyLimit(sorted, view);

  const columns =
    view.properties ??
    compiled.spec.properties ??
    ["file.name", "file.path", ...Object.keys(compiled.spec.formulas ?? {}).map((name) => `formula.${name}`)];

  for (const row of limited) {
    row.projected = projectRow(row, columns, compiled.strict);
  }

  const groups = groupRows(limited, view, compiled.strict);
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
