import { afterAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

import { generateVault } from "../bench/generate-vault.js";

describe("synthetic vault generator determinism", () => {
  const dir1 = resolve(process.cwd(), ".tmp/test-vault-1");
  const dir2 = resolve(process.cwd(), ".tmp/test-vault-2");

  afterAll(() => {
    rmSync(dir1, { recursive: true, force: true });
    rmSync(dir2, { recursive: true, force: true });
  });

  test("generates identical files for identical seeds", () => {
    generateVault({ outDir: dir1, notes: 20, seed: 123 });
    generateVault({ outDir: dir2, notes: 20, seed: 123 });

    const files1 = readdirSync(dir1).sort();
    const files2 = readdirSync(dir2).sort();

    expect(files1).toEqual(files2);

    for (const file of files1) {
      if (file === "nested" || file === "archive") continue;
      const content1 = readFileSync(resolve(dir1, file), "utf8");
      const content2 = readFileSync(resolve(dir2, file), "utf8");
      expect(content1).toBe(content2);
    }
  });
});
