import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { queryBase, serializeResult } from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

Deno.test("deno runtime conformance", async () => {
  const result = await queryBase({
    dir: resolve(repoRoot, "fixtures/vaults/basic"),
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

  if (result.rows.length !== 2) {
    throw new Error(`expected 2 rows, got ${result.rows.length}`);
  }

  const serialized = serializeResult(result, "json");
  if (!serialized.includes("rows")) {
    throw new Error("serialized output missing rows key");
  }
});
