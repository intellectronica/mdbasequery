import type { CompiledQuery, CompileQueryOptions, ExecuteQueryOptions } from "./core/query-engine.js";
import { compileQuery as compileQueryInternal, executeCompiledQuery } from "./core/query-engine.js";
import { parseBaseYaml } from "./core/schema.js";
import { indexVault } from "./core/vault-index.js";
import { detectRuntimeAdapter } from "./runtime-adapters/index.js";
import type { FileRecord, IndexedDocument, QueryBaseOptions, QueryResult, QuerySpec, RuntimeAdapter } from "./types.js";

async function loadSpec(options: QueryBaseOptions, adapter: RuntimeAdapter): Promise<QuerySpec> {
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
      throw new Error("--yaml expects inline YAML text; use basePath/--base for file paths");
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

function resolveThisFile(options: QueryBaseOptions, adapter: RuntimeAdapter, dir: string): FileRecord | undefined {
  const targetPath = options.basePath;

  if (!targetPath) {
    return undefined;
  }

  const resolved = adapter.resolve(targetPath);
  const relativePath = normalizeFilePath(adapter.relative(dir, resolved));
  const slashIndex = relativePath.lastIndexOf("/");
  const name = slashIndex === -1 ? relativePath : relativePath.slice(slashIndex + 1);
  const folder = slashIndex === -1 ? "" : relativePath.slice(0, slashIndex);
  const dotIndex = name.lastIndexOf(".");
  const basename = dotIndex === -1 ? name : name.slice(0, dotIndex);
  const ext = dotIndex === -1 ? "" : name.slice(dotIndex);

  return {
    name,
    basename,
    path: relativePath,
    folder,
    ext,
    size: 0,
    ctime: new Date(0),
    mtime: new Date(0),
    properties: {},
    tags: [],
    links: [],
    embeds: [],
    backlinks: [],
  };
}

function normalizeFilePath(path: string): string {
  return path.replaceAll("\\", "/");
}

export async function queryBase(options: QueryBaseOptions): Promise<QueryResult> {
  const adapter = options.adapter ?? detectRuntimeAdapter();
  const strict = options.strict ?? true;
  const dir = options.dir ? adapter.resolve(options.dir) : adapter.cwd();
  const spec = await loadSpec(options, adapter);
  const compiled = compileQuery(spec, { strict });
  const thisFile = resolveThisFile(options, adapter, dir);

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
    thisFile,
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
