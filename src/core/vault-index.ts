import { minimatch } from "minimatch";
import type { IndexedDocument, RuntimeAdapter, RuntimeFileEntry } from "../types.js";
import { parseMarkdownMetadata } from "./markdown.js";

export interface VaultIndexOptions {
  rootDir: string;
  include: string[];
  exclude: string[];
  adapter: RuntimeAdapter;
}

export interface VaultIndexResult {
  documents: IndexedDocument[];
  scannedFiles: number;
  markdownFiles: number;
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function matchesAny(path: string, patterns: string[]): boolean {
  if (patterns.length === 0) {
    return true;
  }

  return patterns.some((pattern) => minimatch(path, pattern, { dot: true }));
}

function shouldInclude(path: string, includePatterns: string[], excludePatterns: string[]): boolean {
  const included = includePatterns.length === 0 ? true : matchesAny(path, includePatterns);
  const excluded = excludePatterns.length === 0 ? false : matchesAny(path, excludePatterns);

  return included && !excluded;
}

function isMarkdown(path: string): boolean {
  return path.toLowerCase().endsWith(".md");
}

function folderFromPath(path: string): string {
  const slashIndex = path.lastIndexOf("/");

  if (slashIndex === -1) {
    return "";
  }

  return path.slice(0, slashIndex);
}

function basenameFromPath(path: string): string {
  const slashIndex = path.lastIndexOf("/");
  const fileName = slashIndex === -1 ? path : path.slice(slashIndex + 1);
  const dotIndex = fileName.lastIndexOf(".");

  if (dotIndex === -1) {
    return fileName;
  }

  return fileName.slice(0, dotIndex);
}

function normalizeLinkTarget(path: string): string {
  return normalizePath(path.trim());
}

function sortEntries(entries: RuntimeFileEntry[]): RuntimeFileEntry[] {
  return [...entries].sort((left, right) => left.path.localeCompare(right.path));
}

export interface PathLookupIndexes {
  byPath: Map<string, IndexedDocument>;
  byShortName: Map<string, IndexedDocument>;
}

export function buildPathLookupIndexes(documents: IndexedDocument[]): PathLookupIndexes {
  const byPath = new Map<string, IndexedDocument>();
  const shortNameCounts = new Map<string, string[]>();

  for (const document of documents) {
    const path = document.file.path;
    byPath.set(path, document);

    for (const shortName of [document.file.name, document.file.basename, `${document.file.basename}.md`]) {
      const paths = shortNameCounts.get(shortName) ?? [];
      paths.push(path);
      shortNameCounts.set(shortName, paths);
    }
  }

  const byShortName = new Map<string, IndexedDocument>();

  for (const document of documents) {
    for (const shortName of [document.file.name, document.file.basename, `${document.file.basename}.md`]) {
      if ((shortNameCounts.get(shortName)?.length ?? 0) === 1) {
        byShortName.set(shortName, document);
      }
    }
  }

  return { byPath, byShortName };
}

export function resolveLinkTarget(link: string, indexes: PathLookupIndexes): IndexedDocument | undefined {
  const normalized = normalizeLinkTarget(link);

  return (
    indexes.byPath.get(normalized) ??
    indexes.byShortName.get(normalized) ??
    (normalized.endsWith(".md") ? undefined : indexes.byShortName.get(`${normalized}.md`))
  );
}

async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await fn(items[index], index);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);

  return results;
}

export async function indexVault(options: VaultIndexOptions): Promise<VaultIndexResult> {
  const entries = sortEntries(await options.adapter.listFilesRecursive(options.rootDir));

  const candidateEntries: Array<{ entry: RuntimeFileEntry; relativePath: string }> = [];

  for (const entry of entries) {
    const relativePath = normalizePath(options.adapter.relative(options.rootDir, entry.path));

    if (!shouldInclude(relativePath, options.include, options.exclude)) {
      continue;
    }

    if (!entry.stat.isFile || !isMarkdown(relativePath)) {
      continue;
    }

    candidateEntries.push({ entry, relativePath });
  }

  const documents = await mapConcurrent(candidateEntries, 32, async ({ entry, relativePath }) => {
    const raw = await options.adapter.readTextFile(entry.path);
    const metadata = parseMarkdownMetadata(raw);

    return {
      note: {
        frontmatter: metadata.frontmatter,
      },
      file: {
        name: options.adapter.basename(relativePath),
        basename: basenameFromPath(relativePath),
        path: relativePath,
        folder: folderFromPath(relativePath),
        ext: options.adapter.extname(relativePath),
        size: entry.stat.size,
        ctime: entry.stat.ctime,
        mtime: entry.stat.mtime,
        properties: metadata.frontmatter,
        tags: metadata.tags,
        links: metadata.links,
        embeds: metadata.embeds,
        backlinks: [] as string[],
      },
    } satisfies IndexedDocument;
  });

  const indexes = buildPathLookupIndexes(documents);

  for (const document of documents) {
    for (const link of document.file.links) {
      const target = resolveLinkTarget(link, indexes);

      if (!target) {
        continue;
      }

      if (!target.file.backlinks.includes(document.file.path)) {
        target.file.backlinks.push(document.file.path);
      }
    }

    document.file.backlinks.sort((left, right) => left.localeCompare(right));
  }

  return {
    documents,
    scannedFiles: entries.length,
    markdownFiles: candidateEntries.length,
  };
}
