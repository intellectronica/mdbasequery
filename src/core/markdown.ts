import { parse as parseYaml } from "yaml";

export interface MarkdownMetadata {
  frontmatter: Record<string, unknown>;
  tags: string[];
  links: string[];
  embeds: string[];
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:[Zz]|[+-]\d{2}:?\d{2})?$/;

function coerceDateValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  if (!DATE_ONLY_PATTERN.test(value) && !DATE_TIME_PATTERN.test(value)) {
    return value;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  if (DATE_ONLY_PATTERN.test(value) && parsed.toISOString().slice(0, 10) !== value) {
    return value;
  }

  return parsed;
}

function coerceDates(value: unknown): unknown {
  if (value instanceof Date) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(coerceDates);
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, coerceDates(entry)]),
    );
  }

  return coerceDateValue(value);
}

export function extractFrontmatter(raw: string): Record<string, unknown> {
  const normalized = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");

  if (!normalized.startsWith("---\n") && !normalized.startsWith("--- ")) {
    return {};
  }

  const closingIndex = normalized.search(/\n---[ \t]*(?:\n|$)/);

  if (closingIndex === -1) {
    return {};
  }

  const yamlBody = normalized.slice(4, closingIndex);

  if (yamlBody.trim().length === 0) {
    return {};
  }

  try {
    const parsed = parseYaml(yamlBody);

    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return coerceDates(parsed) as Record<string, unknown>;
    }

    return {};
  } catch {
    return {};
  }
}

export function extractTags(raw: string): string[] {
  const tagPattern = /(^|\s)#([A-Za-z0-9/_-]+)/g;
  const output: string[] = [];

  for (const match of raw.matchAll(tagPattern)) {
    if (match[2]) {
      output.push(match[2]);
    }
  }

  return uniqueSorted(output);
}

function extractTagsFromFrontmatter(frontmatter: Record<string, unknown>): string[] {
  const rawTags = frontmatter.tags;

  if (typeof rawTags === "string") {
    return [rawTags];
  }

  if (Array.isArray(rawTags)) {
    return rawTags.filter((entry): entry is string => typeof entry === "string");
  }

  return [];
}

function normalizeTag(tag: string): string {
  return tag.startsWith("#") ? tag.slice(1) : tag;
}

export function extractLinks(raw: string): string[] {
  const output: string[] = [];

  const wikiLinkPattern = /\[\[([^\]|#]+)(?:#[^\]]+)?(?:\|[^\]]+)?\]\]/g;
  for (const match of raw.matchAll(wikiLinkPattern)) {
    if (match[1]) {
      output.push(match[1].trim());
    }
  }

  const markdownLinkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
  for (const match of raw.matchAll(markdownLinkPattern)) {
    if (match[1]) {
      output.push(match[1].trim());
    }
  }

  return uniqueSorted(output);
}

export function extractEmbeds(raw: string): string[] {
  const output: string[] = [];

  const wikiEmbedPattern = /!\[\[([^\]|#]+)(?:#[^\]]+)?(?:\|[^\]]+)?\]\]/g;
  for (const match of raw.matchAll(wikiEmbedPattern)) {
    if (match[1]) {
      output.push(match[1].trim());
    }
  }

  const markdownEmbedPattern = /!\[[^\]]*\]\(([^)]+)\)/g;
  for (const match of raw.matchAll(markdownEmbedPattern)) {
    if (match[1]) {
      output.push(match[1].trim());
    }
  }

  return uniqueSorted(output);
}

export function parseMarkdownMetadata(raw: string): MarkdownMetadata {
  const frontmatter = extractFrontmatter(raw);

  return {
    frontmatter,
    tags: uniqueSorted([...extractTags(raw), ...extractTagsFromFrontmatter(frontmatter)].map(normalizeTag)),
    links: extractLinks(raw),
    embeds: extractEmbeds(raw),
  };
}
