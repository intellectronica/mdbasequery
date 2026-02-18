export { compileQuery, parseBaseYaml, queryBase, runCompiledQuery } from "./query.js";
export { serializeResult } from "./core/serialize.js";
export { detectRuntimeAdapter, bunAdapter, denoAdapter, nodeAdapter } from "./runtime-adapters/index.js";

export type {
  CompiledQuery,
  CompileQueryOptions,
  ExecuteQueryOptions,
} from "./core/query-engine.js";

export type {
  FileRecord,
  FilterSpec,
  IndexedDocument,
  NoteRecord,
  OutputFormat,
  QueryBaseOptions,
  QueryDiagnostics,
  QueryGroup,
  QueryResult,
  QueryRow,
  QuerySpec,
  QueryStats,
  RuntimeAdapter,
  RuntimeFileEntry,
  RuntimeFileStat,
  Scalar,
  SortDirection,
  SortSpec,
  ViewSpec,
} from "./types.js";
