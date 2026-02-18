import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

import { queryBase, serializeResult } from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

test("node runtime conformance", async () => {
  const result = await queryBase({
    dir: resolve(repoRoot, "fixtures/vaults/basic"),
    yaml: `
formulas:
  doubled: score * 2
views:
  - type: table
    name: default
    filters: score >= 3
    properties:
      - title
      - formula.doubled
`.trim(),
    strict: true,
  });

  assert.equal(result.rows.length, 3);
  assert.equal(result.rows[0].projected["formula.doubled"], 14);

  const serialized = serializeResult(result, "json");
  assert.match(serialized, /"rows"/);
});
