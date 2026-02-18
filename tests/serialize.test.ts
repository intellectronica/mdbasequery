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
        raw: "",
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

  test("csv escaping and order", () => {
    const output = serializeResult(
      {
        ...fixtureResult,
        rows: [
          {
            ...fixtureResult.rows[0],
            projected: {
              title: "Alpha, Inc",
              score: 7,
            },
          },
        ],
      },
      "csv",
    );

    expect(output.split("\n")[0]).toBe("title,score");
    expect(output).toContain('"Alpha, Inc",7');
  });
});
