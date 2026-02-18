import { executeCompiledQuery, compileQuery as compileQueryInternal } from "./core/query-engine.js";
import { parseBaseYaml } from "./core/schema.js";
import { indexVault } from "./core/vault-index.js";
import { detectRuntimeAdapter } from "./runtime-adapters/index.js";

import type {
  CompiledQuery,
  CompileQueryOptions,
  ExecuteQueryOptions,
} from "./core/query-engine.js";
import type {
  IndexedDocument,
  QueryBaseOptions,
  QueryResult,
  QuerySpec,
  RuntimeAdapter,
} from "./types.js";

async function loadSpec(
  options: QueryBaseOptions,
  adapter: RuntimeAdapter,
): Promise<QuerySpec> {
  if (options.spec) {
    return options.spec;
  }

  if (options.basePath) {
    const content = await adapter.readTextFile(options.basePath);
    return parseBaseYaml(content);
  }

  if (options.yaml) {
    const yamlInput = options.yaml;

    if (await adapter.exists(yamlInput)) {
      const content = await adapter.readTextFile(yamlInput);
      return parseBaseYaml(content);
    }

    return parseBaseYaml(yamlInput);
  }

  throw new Error("query source missing: provide spec, basePath, or yaml");
}

export function compileQuery(spec: QuerySpec, options: CompileQueryOptions = {}): CompiledQuery {
  return compileQueryInternal(spec, options);
}

export interface RunCompiledQuerySource {
  documents?: IndexedDocument[];
  dir?: string;
  include?: string[];
  exclude?: string[];
  adapter?: RuntimeAdapter;
  view?: string;
}

export async function runCompiledQuery(
  compiled: CompiledQuery,
  source: RunCompiledQuerySource = {},
): Promise<QueryResult> {
  const adapter = source.adapter ?? detectRuntimeAdapter();
  const rootDir = source.dir ?? adapter.cwd();
  const include = source.include ?? ["**/*.md"];
  const exclude = source.exclude ?? [];

  const documents =
    source.documents ??
    (
      await indexVault({
        rootDir,
        include,
        exclude,
        adapter,
      })
    ).documents;

  const executionOptions: ExecuteQueryOptions = {
    compiled,
    documents,
    view: source.view,
  };

  return executeCompiledQuery(executionOptions);
}

export async function queryBase(options: QueryBaseOptions): Promise<QueryResult> {
  const adapter = options.adapter ?? detectRuntimeAdapter();
  const strict = options.strict ?? true;
  const dir = options.dir ? adapter.resolve(options.dir) : adapter.cwd();
  const spec = await loadSpec(options, adapter);
  const compiled = compileQuery(spec, { strict });

  const indexed = await indexVault({
    rootDir: dir,
    include: options.include ?? ["**/*.md"],
    exclude: options.exclude ?? [],
    adapter,
  });

  const result = executeCompiledQuery({
    compiled,
    view: options.view,
    documents: indexed.documents,
    diagnostics: {
      warnings: [],
      errors: [],
    },
  });

  result.stats.scannedFiles = indexed.scannedFiles;
  result.stats.markdownFiles = indexed.markdownFiles;

  return result;
}

export { parseBaseYaml };
