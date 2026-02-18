import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { describe, expect, test } from "bun:test";

import { queryBase, serializeResult } from "../src/index.js";
import { fixturesRoot, repoRoot } from "./helpers.js";

describe("documentation smoke", () => {
  test("CLI README example executes", () => {
    const output = spawnSync(
      "bun",
      [
        "run",
        "src/cli.ts",
        "--base",
        resolve(fixturesRoot, "queries/basic.base"),
        "--dir",
        resolve(fixturesRoot, "vaults/basic"),
        "--format",
        "json",
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
      },
    );

    expect(output.status).toBe(0);
    expect(output.stdout).toContain("rows");
  });

  test("library README example executes", async () => {
    const result = await queryBase({
      dir: resolve(fixturesRoot, "vaults/basic"),
      yaml: `
views:
  - type: table
    name: default
    filters: score >= 7
    properties:
      - title
      - score
`.trim(),
      strict: true,
    });

    const serialized = serializeResult(result, "json");

    expect(result.rows).toHaveLength(2);
    expect(serialized).toContain("Gamma");
  });
});
