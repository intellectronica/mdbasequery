import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { describe, expect, test } from "bun:test";

import { queryBase, serializeResult } from "../src/index.js";
import { fixturesRoot, repoRoot } from "./helpers.js";

describe("phase 0 smoke", () => {
  test("public API imports and runs", async () => {
    const result = await queryBase({
      dir: resolve(fixturesRoot, "vaults/basic"),
      yaml: `
views:
  - type: table
    name: default
`.trim(),
      strict: true,
    });

    expect(result.rows.length).toBeGreaterThan(0);
    const serialized = serializeResult(result, "json");
    expect(serialized).toContain("rows");
  });

  test("queryBase rejects yaml file paths", async () => {
    await expect(
      queryBase({
        dir: resolve(fixturesRoot, "vaults/basic"),
        yaml: resolve(fixturesRoot, "queries/basic.base"),
      }),
    ).rejects.toThrow("--yaml expects inline YAML text");
  });

  test("CLI help works", () => {
    const output = spawnSync("bun", ["run", "src/cli.ts", "--help"], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    expect(output.status).toBe(0);
    expect(output.stdout).toContain("mdbasequery [options]");
  });
});
