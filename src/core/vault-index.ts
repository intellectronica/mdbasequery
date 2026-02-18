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
        backlinks: [],
        raw,
      },
    });
  }

  const pathLookup = new Map<string, IndexedDocument>();

  for (const document of documents) {
    pathLookup.set(normalizeLinkTarget(document.file.path), document);
    pathLookup.set(normalizeLinkTarget(document.file.name), document);
    pathLookup.set(normalizeLinkTarget(document.file.basename), document);
    pathLookup.set(normalizeLinkTarget(`${document.file.basename}.md`), document);
  }

  for (const document of documents) {
    for (const link of document.file.links) {
      const normalized = normalizeLinkTarget(link);
      const target =
        pathLookup.get(normalized) ??
        (normalized.endsWith(".md") ? undefined : pathLookup.get(`${normalized}.md`));

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
    markdownFiles,
  };
}
