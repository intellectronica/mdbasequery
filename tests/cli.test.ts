import { mkdtempSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, test } from "bun:test";

import { fixturesRoot, repoRoot } from "./helpers.js";

function runCli(args: string[]) {
  return spawnSync("bun", ["run", "src/cli.ts", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

describe("cli integration", () => {
  const vaultDir = resolve(fixturesRoot, "vaults/basic");

  test(".base input mode", () => {
    const basePath = resolve(fixturesRoot, "queries/basic.base");
    const result = runCli(["--base", basePath, "--dir", vaultDir, "--format", "json"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("rows");
    expect(result.stdout).toContain("formula.doubled");
  });

  test("CLI-flag query mode", () => {
    const result = runCli([
      "--dir",
      vaultDir,
      "--filter",
      "score >= 7",
      "--select",
      "title",
      "--sort",
      "score:desc",
      "--format",
      "json",
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Gamma");
    expect(result.stdout).toContain("Alpha");
  });

  test("--view selection and output destination", () => {
    const basePath = resolve(fixturesRoot, "queries/grouped.base");
    const tempDir = mkdtempSync(resolve(tmpdir(), "mdbasequery-"));
    const outputPath = resolve(tempDir, "result.csv");

    const result = runCli([
      "--base",
      basePath,
      "--view",
      "grouped",
      "--dir",
      vaultDir,
      "--format",
      "csv",
      "--out",
      outputPath,
    ]);

    expect(result.status).toBe(0);
    const written = readFileSync(outputPath, "utf8");
    expect(written).toContain("title,status,formula.band");
  });

  test("exit code and message on errors", () => {
    const basePath = resolve(fixturesRoot, "queries/grouped.base");
    const result = runCli(["--base", basePath, "--view", "missing", "--dir", vaultDir]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("view not found");
  });
});
