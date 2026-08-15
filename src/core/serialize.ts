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

function sanitizeCsvCell(value: string): string {
  const trimmed = value.trim();

  if (/^[=+\-@]/.test(trimmed)) {
    if (!Number.isFinite(Number(trimmed))) {
      return `'${value}`;
    }
  }

  return value;
}

function escapeCsv(value: string): string {
  const sanitized = sanitizeCsvCell(value);

  if (!/[",\n]/.test(sanitized)) {
    return sanitized;
  }

  return `"${sanitized.replaceAll('"', '""')}"`;
}

function getColumnHeader(column: string, result: QueryResult): string {
  return result.columnLabels?.[column] ?? column;
}

function serializeCsv(result: QueryResult): string {
  if (result.groups && result.groups.length > 0) {
    const columns = ["group", ...result.columns];
    const lines: string[] = [columns.map((col) => escapeCsv(col === "group" ? "group" : getColumnHeader(col, result))).join(",")];

    for (const group of result.groups) {
      const groupKeyStr = toDisplayValue(group.key);

      for (const row of group.rows) {
        lines.push(
          [
            escapeCsv(groupKeyStr),
            ...result.columns.map((column) => escapeCsv(toDisplayValue(row[column]))),
          ].join(","),
        );
      }
    }

    return `${lines.join("\n")}\n`;
  }

  const rows = normalizedRows(result);
  const columns = result.columns;
  const lines: string[] = [columns.map((col) => escapeCsv(getColumnHeader(col, result))).join(",")];

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

function toMarkdownCell(value: unknown): string {
  const text = toDisplayValue(value);
  return text.replaceAll("|", "\\|").replace(/\r?\n/g, "<br>");
}

function renderSingleMarkdownTable(rows: Record<string, unknown>[], columns: string[], result: QueryResult): string {
  const headers = columns.map((col) => getColumnHeader(col, result));
  const header = `| ${headers.join(" | ")} |`;
  const divider = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => {
    const cells = columns.map((column) => toMarkdownCell(row[column]));
    return `| ${cells.join(" | ")} |`;
  });

  return [header, divider, ...body].join("\n");
}

function serializeMarkdownTable(result: QueryResult): string {
  if (result.groups && result.groups.length > 0) {
    const sections: string[] = [];

    for (const group of result.groups) {
      const keyStr = toDisplayValue(group.key);
      sections.push(`### ${keyStr}\n\n${renderSingleMarkdownTable(group.rows, result.columns, result)}`);
    }

    return `${sections.join("\n\n")}\n`;
  }

  const rows = normalizedRows(result);
  return `${renderSingleMarkdownTable(rows, result.columns, result)}\n`;
}

export function serializeResult(result: QueryResult, format: OutputFormat): string {
  if (format === "json") {
    return `${JSON.stringify(
      {
        rows: normalizedRows(result),
        columns: result.columns,
        columnLabels: result.columnLabels,
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
      columnLabels: result.columnLabels,
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
