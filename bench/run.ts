import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { generateVault } from "./generate-vault.js";
import { queryBase } from "../src/query.js";

async function timeQuery(name: string, fn: () => Promise<unknown>): Promise<number> {
  const start = performance.now();
  await fn();
  const elapsed = performance.now() - start;
  console.log(`  ${name.padEnd(45)}: ${elapsed.toFixed(2)} ms`);
  return elapsed;
}

async function runBenchmark(notes: number): Promise<void> {
  const vaultDir = resolve(process.cwd(), `.tmp/bench-vault-${notes}`);

  if (!existsSync(vaultDir)) {
    console.log(`Generating synthetic vault with ${notes} notes...`);
    generateVault({ outDir: vaultDir, notes, seed: 42 });
  }

  console.log(`\n=== Running benchmarks on ${notes} notes ===\n`);

  // 1. Plain filter on note property
  await timeQuery("1. Filter (score >= 50)", () =>
    queryBase({
      dir: vaultDir,
      yaml: `
views:
  - type: table
    name: default
    filters: score >= 50
    properties:
      - title
      - score
      - category
`.trim(),
    }),
  );

  // 2. Filter + dotted sort key (file.mtime)
  await timeQuery("2. Filter + Sort (score >= 50, sort file.mtime:desc)", () =>
    queryBase({
      dir: vaultDir,
      yaml: `
views:
  - type: table
    name: default
    filters: score >= 50
    sort:
      - file.mtime:desc
    properties:
      - title
      - file.mtime
`.trim(),
    }),
  );

  // 3. Formula-heavy view
  await timeQuery("3. Formulas (doubled, status_label, due_days)", () =>
    queryBase({
      dir: vaultDir,
      yaml: `
formulas:
  doubled: score * 2
  status_label: if(score > 70, "high", "normal")
  has_urgent: tags.contains("urgent")
views:
  - type: table
    name: default
    filters: score >= 20
    properties:
      - title
      - formula.doubled
      - formula.status_label
      - formula.has_urgent
`.trim(),
    }),
  );

  // 4. Grouped + Summarised view
  await timeQuery("4. Grouped (by category) + Summary (mean score)", () =>
    queryBase({
      dir: vaultDir,
      yaml: `
summaries:
  avgScore: values.mean().round(2)
views:
  - type: table
    name: default
    groupBy: category
    order:
      - title
      - score
      - category
    summaries:
      score: avgScore
`.trim(),
    }),
  );
}

async function main() {
  mkdirSync(resolve(process.cwd(), ".tmp"), { recursive: true });
  await runBenchmark(1000);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
