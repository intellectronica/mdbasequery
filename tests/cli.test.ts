import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

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

  test("rejects file path passed to --yaml", () => {
    const yamlPath = resolve(fixturesRoot, "queries/basic.base");
    const result = runCli(["--yaml", yamlPath, "--dir", vaultDir, "--format", "json"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--yaml expects inline YAML text");
    expect(result.stderr).toContain("--base");
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

  test("rejects deprecated query subcommand", () => {
    const result = runCli(["query", "--help"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unknown option: query");
  });

  test("shows version with --version and -v", () => {
    const res1 = runCli(["--version"]);
    expect(res1.status).toBe(0);
    expect(res1.stdout).toMatch(/^\d+\.\d+\.\d+/);

    const res2 = runCli(["-v"]);
    expect(res2.status).toBe(0);
    expect(res2.stdout).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("rejects query flags combined with --base or --yaml", () => {
    const basePath = resolve(fixturesRoot, "queries/basic.base");
    const result = runCli(["--base", basePath, "--filter", "score > 5"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("cannot combine --base/--yaml query definition with query flags");
  });

  test("--debug emits stats to stderr while keeping stdout valid JSON", () => {
    const basePath = resolve(fixturesRoot, "queries/basic.base");
    const result = runCli(["--base", basePath, "--dir", vaultDir, "--debug"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("[debug]");
    expect(result.stderr).toContain("scanned:");
    expect(JSON.parse(result.stdout).rows).toBeDefined();
  });

  test("--out automatically creates nested parent directories", () => {
    const basePath = resolve(fixturesRoot, "queries/basic.base");
    const tempDir = mkdtempSync(resolve(tmpdir(), "mdbasequery-"));
    const nestedOut = resolve(tempDir, "deeply/nested/dir/out.json");

    const result = runCli(["--base", basePath, "--dir", vaultDir, "--out", nestedOut]);

    expect(result.status).toBe(0);
    const content = readFileSync(nestedOut, "utf8");
    expect(content).toContain("rows");
  });
});
