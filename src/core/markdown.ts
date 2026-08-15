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

function blankInlineCode(input: string): string {
  let output = "";
  let index = 0;

  while (index < input.length) {
    const char = input[index];

    if (char !== "`") {
      output += char;
      index += 1;
      continue;
    }

    let run = 0;

    while (input[index + run] === "`") {
      run += 1;
    }

    const closing = input.indexOf("`".repeat(run), index + run);

    if (closing === -1) {
      output += char;
      index += 1;
      continue;
    }

    output += " ".repeat(closing + run - index);
    index = closing + run;
  }

  return output;
}

function stripCodeRegions(raw: string): string {
  const lines = raw.split("\n");
  const blanked = new Array<boolean>(lines.length).fill(false);

  if (lines[0]?.startsWith("---")) {
    for (let index = 1; index < lines.length; index += 1) {
      blanked[index] = true;

      if (/^---[ \t]*$/.test(lines[index])) {
        break;
      }
    }
  }

  let fenceChar: string | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fenceMatch = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(line);

    if (fenceChar) {
      blanked[index] = true;
      const closer = new RegExp(`^[ \\t]{0,3}${fenceChar === "`" ? "`+" : "~+"}[ \\t]*$`);

      if (closer.test(line)) {
        fenceChar = null;
      }

      continue;
    }

    if (fenceMatch) {
      const char = fenceMatch[1][0];
      const rest = line.slice(fenceMatch[0].length);
      blanked[index] = true;
      fenceChar = new RegExp(`${char}{3,}`).test(rest) ? null : char;
    }
  }

  const blankedLines = lines
    .map((line, index) => (blanked[index] ? " ".repeat(line.length) : line))
    .join("\n");

  return blankInlineCode(blankedLines);
}

export function extractTags(raw: string): string[] {
  const tagPattern = /(^|\s)#([A-Za-z0-9/_-]+)/g;
  const output: string[] = [];
  const sanitized = stripCodeRegions(raw);

  for (const match of sanitized.matchAll(tagPattern)) {
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
