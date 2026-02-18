import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export const repoRoot = resolve(here, "..");
export const fixturesRoot = resolve(repoRoot, "fixtures");
