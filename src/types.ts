export type Scalar = null | boolean | number | string;

export type FilterSpec =
  | string
  | {
      and?: FilterSpec[];
      or?: FilterSpec[];
      not?: FilterSpec;
    };

export type SortDirection = "asc" | "desc";

export interface SortSpec {
  by: string;
  direction: SortDirection;
}

export interface ViewSpec {
  type: string;
  name: string;
  filters?: FilterSpec;
  order?: SortSpec[];
  groupBy?: string;
  limit?: number;
  summaries?: Record<string, string>;
  properties?: string[];
}

export interface QuerySpec {
  filters?: FilterSpec;
  formulas?: Record<string, string>;
  properties?: string[];
  summaries?: Record<string, string>;
  views: ViewSpec[];
}

export interface QueryDiagnostics {
  warnings: string[];
  errors: string[];
}

export interface QueryStats {
  scannedFiles: number;
  markdownFiles: number;
  matchedRows: number;
  elapsedMs: number;
}

export interface QueryGroup {
  key: unknown;
  rows: QueryRow[];
}

export interface QueryResult {
  rows: QueryRow[];
  columns: string[];
  groups?: QueryGroup[];
  summaries?: Record<string, unknown>;
  stats: QueryStats;
  diagnostics: QueryDiagnostics;
}

export interface QueryRow {
  note: Record<string, unknown>;
  file: FileRecord;
  formula: Record<string, unknown>;
  this: Record<string, unknown>;
  projected: Record<string, unknown>;
}

export interface FileRecord {
  name: string;
  path: string;
  folder: string;
  ext: string;
  size: number;
  ctime: Date;
  mtime: Date;
  tags: string[];
  links: string[];
  raw: string;
}

export interface NoteRecord {
  frontmatter: Record<string, unknown>;
}

export interface IndexedDocument {
  note: NoteRecord;
  file: FileRecord;
}

export type OutputFormat = "json" | "jsonl" | "yaml" | "csv" | "md";

export interface QueryBaseOptions {
  spec?: QuerySpec;
  basePath?: string;
  yaml?: string;
  view?: string;
  dir?: string;
  strict?: boolean;
  include?: string[];
  exclude?: string[];
  debug?: boolean;
  adapter?: RuntimeAdapter;
}

export interface RuntimeFileStat {
  isFile: boolean;
  size: number;
  ctime: Date;
  mtime: Date;
}

export interface RuntimeFileEntry {
  path: string;
  stat: RuntimeFileStat;
}

export interface RuntimeAdapter {
  cwd(): string;
  resolve(...parts: string[]): string;
  relative(from: string, to: string): string;
  basename(path: string): string;
  extname(path: string): string;
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, content: string): Promise<void>;
  listFilesRecursive(path: string): Promise<RuntimeFileEntry[]>;
  exists(path: string): Promise<boolean>;
}
