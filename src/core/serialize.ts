import { stringify as stringifyYaml } from "yaml";

import type { OutputFormat, QueryResult } from "../types.js";

function normalizedRows(result: QueryResult): Record<string, unknown>[] {
  return result.rows.map((row) => row.projected);
}

function toDisplayValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function escapeCsv(value: string): string {
  if (!/[",\n]/.test(value)) {
    return value;
  }

  return `"${value.replaceAll('"', '""')}"`;
}

function serializeCsv(result: QueryResult): string {
  const rows = normalizedRows(result);
  const columns = result.columns;
  const lines: string[] = [columns.map(escapeCsv).join(",")];

  for (const row of rows) {
    lines.push(
      columns
        .map((column) => toDisplayValue(row[column]))
        .map((value) => escapeCsv(value))
        .join(","),
    );
  }

  return `${lines.join("\n")}\n`;
}

function serializeMarkdownTable(result: QueryResult): string {
  const rows = normalizedRows(result);
  const columns = result.columns;
  const header = `| ${columns.join(" | ")} |`;
  const divider = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => {
    const cells = columns.map((column) => toDisplayValue(row[column]).replaceAll("|", "\\|"));
    return `| ${cells.join(" | ")} |`;
  });

  return `${[header, divider, ...body].join("\n")}\n`;
}

export function serializeResult(result: QueryResult, format: OutputFormat): string {
  if (format === "json") {
    return `${JSON.stringify(
      {
        rows: normalizedRows(result),
        columns: result.columns,
        groups: result.groups,
        summaries: result.summaries,
        stats: result.stats,
        diagnostics: result.diagnostics,
      },
      null,
      2,
    )}\n`;
  }

  if (format === "jsonl") {
    return `${normalizedRows(result).map((row) => JSON.stringify(row)).join("\n")}\n`;
  }

  if (format === "yaml") {
    return `${stringifyYaml({
      rows: normalizedRows(result),
      columns: result.columns,
      groups: result.groups,
      summaries: result.summaries,
      stats: result.stats,
      diagnostics: result.diagnostics,
    })}`;
  }

  if (format === "csv") {
    return serializeCsv(result);
  }

  if (format === "md") {
    return serializeMarkdownTable(result);
  }

  throw new Error(`unsupported output format: ${format}`);
}
