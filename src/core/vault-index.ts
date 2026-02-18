import { minimatch } from "minimatch";

import { parseMarkdownMetadata } from "./markdown.js";

import type { IndexedDocument, RuntimeAdapter, RuntimeFileEntry } from "../types.js";

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

function sortEntries(entries: RuntimeFileEntry[]): RuntimeFileEntry[] {
  return [...entries].sort((left, right) => left.path.localeCompare(right.path));
}

export async function indexVault(options: VaultIndexOptions): Promise<VaultIndexResult> {
  const entries = sortEntries(await options.adapter.listFilesRecursive(options.rootDir));

  const documents: IndexedDocument[] = [];
  let markdownFiles = 0;

  for (const entry of entries) {
    const relativePath = normalizePath(options.adapter.relative(options.rootDir, entry.path));

    if (!shouldInclude(relativePath, options.include, options.exclude)) {
      continue;
    }

    if (!entry.stat.isFile || !isMarkdown(relativePath)) {
      continue;
    }

    markdownFiles += 1;

    const raw = await options.adapter.readTextFile(entry.path);
    const metadata = parseMarkdownMetadata(raw);

    documents.push({
      note: {
        frontmatter: metadata.frontmatter,
      },
      file: {
        name: options.adapter.basename(relativePath),
        path: relativePath,
        ext: options.adapter.extname(relativePath),
        size: entry.stat.size,
        ctime: entry.stat.ctime,
        mtime: entry.stat.mtime,
        tags: metadata.tags,
        links: metadata.links,
        raw,
      },
    });
  }

  return {
    documents,
    scannedFiles: entries.length,
    markdownFiles,
  };
}
