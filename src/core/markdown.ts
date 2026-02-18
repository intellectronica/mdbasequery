import { parse as parseYaml } from "yaml";

export interface MarkdownMetadata {
  frontmatter: Record<string, unknown>;
  tags: string[];
  links: string[];
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function extractFrontmatter(raw: string): Record<string, unknown> {
  if (!raw.startsWith("---\n")) {
    return {};
  }

  const closingIndex = raw.indexOf("\n---\n", 4);

  if (closingIndex === -1) {
    return {};
  }

  const yamlBody = raw.slice(4, closingIndex);

  if (yamlBody.trim().length === 0) {
    return {};
  }

  try {
    const parsed = parseYaml(yamlBody);

    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
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

export function parseMarkdownMetadata(raw: string): MarkdownMetadata {
  return {
    frontmatter: extractFrontmatter(raw),
    tags: extractTags(raw),
    links: extractLinks(raw),
  };
}
