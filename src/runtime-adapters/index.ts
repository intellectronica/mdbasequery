import type { RuntimeAdapter } from "../types.js";
import { bunAdapter } from "./bun.js";
import { denoAdapter } from "./deno.js";
import { nodeAdapter } from "./node.js";

export function detectRuntimeAdapter(): RuntimeAdapter {
  if (typeof Bun !== "undefined") {
    return bunAdapter;
  }

  if (typeof Deno !== "undefined") {
    return denoAdapter;
  }

  return nodeAdapter;
}

declare const Bun: unknown;
declare const Deno: unknown;

export { bunAdapter, denoAdapter, nodeAdapter };
