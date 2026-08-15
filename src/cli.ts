#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { serializeResult } from "./core/serialize.js";
import { queryBase } from "./query.js";
import { detectRuntimeAdapter } from "./runtime-adapters/index.js";

import type { FilterSpec, OutputFormat, QuerySpec, SortSpec } from "./types.js";

interface CliOptions {
  dir?: string;
  base?: string;
  yaml?: string;
  view?: string;
  format: OutputFormat;
  out?: string;
  strict: boolean;
  include: string[];
  exclude: string[];
  debug: boolean;
  filters: string[];
  select: string[];
  sort: string[];
  groupBy?: string;
  limit?: number;
  help: boolean;
  version: boolean;
}

const HELP_TEXT = `mdbasequery [options]

Core options:
  --dir <path>                target directory (default .)
  --base <path>               load .base YAML file
  --yaml <yaml-text>          inline YAML query text
  --view <name>               choose view by name (default first view)
  --format <fmt>              json|jsonl|yaml|csv|md (default json)
  --out <path>                write output to file
  --strict                    fail on unknown functions/properties (default true)
  --no-strict                 disable strict mode for unknown symbols
  --include <glob>            include pattern (repeatable)
  --exclude <glob>            exclude pattern (repeatable)
  --debug                     include diagnostics and stderr timings
  --version, -v               show version number
  --help, -h                  show help text

Query options (flag mode only):
  --filter <expr>             repeatable filter expression
  --select <property>         repeatable selected column
  --sort <prop:asc|desc>      repeatable sort
  --group-by <property>       grouping property
  --limit <n>                 row limit
`;

function getVersion(): string {
  try {
    const pkgPath = new URL("../package.json", import.meta.url);
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function parseSort(input: string): SortSpec {
  const [property, directionRaw] = input.split(":");
  return {
    by: property,
    direction: directionRaw?.toLowerCase() === "desc" ? "desc" : "asc",
  };
}

function combineFilters(filters: string[]): FilterSpec | undefined {
  if (filters.length === 0) {
    return undefined;
  }

  if (filters.length === 1) {
    return filters[0];
  }

  return {
    and: filters,
  };
}

function buildSpecFromFlags(options: CliOptions): QuerySpec {
  const viewName = options.view ?? "default";

  return {
    views: [
      {
        type: "table",
        name: viewName,
        filters: combineFilters(options.filters),
        sort: options.sort.map(parseSort),
        groupBy: options.groupBy,
        limit: options.limit,
        properties: options.select.length > 0 ? options.select : undefined,
      },
    ],
    properties: options.select.length > 0 ? options.select : undefined,
  };
}

function parseCli(argv: string[]): CliOptions {
  const output: CliOptions = {
    format: "json",
    strict: true,
    include: [],
    exclude: [],
    debug: false,
    filters: [],
    select: [],
    sort: [],
    help: false,
    version: false,
  };

  const args = [...argv];

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];

    if (token === "--help" || token === "-h") {
      output.help = true;
      continue;
    }

    if (token === "--version" || token === "-v") {
      output.version = true;
      continue;
    }

    if (token === "--strict") {
      output.strict = true;
      continue;
    }

    if (token === "--no-strict") {
      output.strict = false;
      continue;
    }

    if (token === "--debug") {
      output.debug = true;
      continue;
    }

    const value = args[index + 1];
    if (value === undefined) {
      throw new Error(`missing value for ${token}`);
    }

    index += 1;

    switch (token) {
      case "--dir":
        output.dir = value;
        break;
      case "--base":
        output.base = value;
        break;
      case "--yaml":
        output.yaml = value;
        break;
      case "--view":
        output.view = value;
        break;
      case "--format": {
        const format = value.toLowerCase() as OutputFormat;
        if (!["json", "jsonl", "yaml", "csv", "md"].includes(format)) {
          throw new Error(`unsupported format: ${value}`);
        }
        output.format = format;
        break;
      }
      case "--out":
        output.out = value;
        break;
      case "--include":
        output.include.push(value);
        break;
      case "--exclude":
        output.exclude.push(value);
        break;
      case "--filter":
        output.filters.push(value);
        break;
      case "--select":
        output.select.push(value);
        break;
      case "--sort":
        output.sort.push(value);
        break;
      case "--group-by":
        output.groupBy = value;
        break;
      case "--limit":
        output.limit = Math.max(0, Number.parseInt(value, 10));
        break;
      default:
        throw new Error(`unknown option: ${token}`);
    }
  }

  const hasSource = output.base !== undefined || output.yaml !== undefined;
  const hasQueryFlags =
    output.filters.length > 0 ||
    output.select.length > 0 ||
    output.sort.length > 0 ||
    output.groupBy !== undefined ||
    output.limit !== undefined;

  if (hasSource && hasQueryFlags) {
    throw new Error(
      "cannot combine --base/--yaml query definition with query flags (--filter, --select, --sort, --group-by, --limit)",
    );
  }

  return output;
}

async function run(): Promise<void> {
  const options = parseCli(process.argv.slice(2));

  if (options.help) {
    process.stdout.write(HELP_TEXT);
    return;
  }

  if (options.version) {
    process.stdout.write(`${getVersion()}\n`);
    return;
  }

  const adapter = detectRuntimeAdapter();
  const spec = !options.base && !options.yaml ? buildSpecFromFlags(options) : undefined;

  const result = await queryBase({
    adapter,
    spec,
    basePath: options.base,
    yaml: options.yaml,
    view: options.view,
    dir: options.dir,
    strict: options.strict,
    include: options.include,
    exclude: options.exclude,
    debug: options.debug,
  });

  if (options.debug) {
    process.stderr.write(
      `[debug] scanned: ${result.stats.scannedFiles}, matched: ${result.stats.matchedRows}, elapsed: ${result.stats.elapsedMs}ms\n`,
    );
  }

  const serialized = serializeResult(result, options.format);

  if (options.out) {
    await adapter.writeTextFile(options.out, serialized);
  } else {
    process.stdout.write(serialized);
  }

  if (result.diagnostics.errors.length > 0) {
    process.exitCode = 1;
  }
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
