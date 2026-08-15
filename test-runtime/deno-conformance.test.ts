import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as distModules from "../dist/index.js";
import { registerConformanceTests } from "./conformance-tests.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

function denoTestAdapter(name: string, fn: () => Promise<void> | void) {
  Deno.test(name, async () => {
    await fn();
  });
}

registerConformanceTests(denoTestAdapter, repoRoot, distModules);
