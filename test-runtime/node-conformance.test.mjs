import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import * as distModules from "../dist/index.js";
import { registerConformanceTests } from "./conformance-tests.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

registerConformanceTests(test, repoRoot, distModules);
