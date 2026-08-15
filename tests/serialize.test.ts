import { describe, expect, test } from "bun:test";

import { serializeResult } from "../src/core/serialize.js";
import type { QueryResult } from "../src/types.js";

const fixtureResult: QueryResult = {
  rows: [
    {
      note: {},
      file: {
        name: "alpha.md",
        path: "alpha.md",
        folder: "",
        ext: ".md",
        size: 10,
        ctime: new Date("2024-01-01"),
        mtime: new Date("2024-01-01"),
        tags: ["a"],
        links: ["b"],
        embeds: [],
        backlinks: [],
        properties: {},
      },
      formula: {},
      this: {},
      projected: {
        title: "Alpha",
        score: 7,
      },
    },
  ],
  columns: ["title", "score"],
  stats: {
    scannedFiles: 1,
    markdownFiles: 1,
    matchedRows: 1,
    returnedRows: 1,
    elapsedMs: 1,
  },
  diagnostics: {
    errors: [],
    warnings: [],
  },
};

describe("serializers", () => {
  test("json output shape", () => {
    const output = serializeResult(fixtureResult, "json");
    expect(output).toContain("\"rows\"");
    expect(output).toContain("Alpha");
  });

  test("jsonl one row per line", () => {
    const output = serializeResult(fixtureResult, "jsonl").trim();
    expect(output.split("\n")).toHaveLength(1);
    expect(output).toContain("\"title\":\"Alpha\"");
  });

  test("yaml serialization", () => {
    const output = serializeResult(fixtureResult, "yaml");
    expect(output).toContain("rows:");
    expect(output).toContain("title: Alpha");
  });

  test("csv escaping, formula injection neutralization, and column order", () => {
    const output = serializeResult(
      {
        ...fixtureResult,
        rows: [
          {
            ...fixtureResult.rows[0],
            projected: {
              title: "=SUM(A1:A5)",
              score: -5,
            },
          },
        ],
      },
      "csv",
    );

    expect(output.split("\n")[0]).toBe("title,score");
    expect(output).toContain("'=SUM(A1:A5),-5");
  });

  test("markdown table converts newlines in cell values to <br>", () => {
    const output = serializeResult(
      {
        ...fixtureResult,
        rows: [
          {
            ...fixtureResult.rows[0],
            projected: {
              title: "Line 1\nLine 2",
              score: 7,
            },
          },
        ],
      },
      "md",
    );

    expect(output).toContain("| Line 1<br>Line 2 | 7 |");
    // Ensure table has exactly 3 lines: header, divider, body
    expect(output.trim().split("\n")).toHaveLength(3);
  });

  test("csv renders group column when groups exist", () => {
    const output = serializeResult(
      {
        ...fixtureResult,
        groups: [
          {
            key: "Active",
            rows: [{ title: "Alpha", score: 7 }],
          },
        ],
      },
      "csv",
    );

    expect(output.split("\n")[0]).toBe("group,title,score");
    expect(output).toContain("Active,Alpha,7");
  });

  test("markdown table renders grouped sections with headings", () => {
    const output = serializeResult(
      {
        ...fixtureResult,
        groups: [
          {
            key: "Active",
            rows: [{ title: "Alpha", score: 7 }],
          },
        ],
      },
      "md",
    );

    expect(output).toContain("### Active");
    expect(output).toContain("| title | score |");
  });
});
