import { describe, expect, test } from "bun:test";

import { parseMarkdownMetadata } from "../src/core/markdown.js";

describe("markdown metadata parsing", () => {
  test("parses standard LF frontmatter", () => {
    const metadata = parseMarkdownMetadata("---\ntitle: Standard\nscore: 5\n---\nbody");
    expect(metadata.frontmatter).toEqual({ title: "Standard", score: 5 });
  });

  test("parses CRLF frontmatter", () => {
    const metadata = parseMarkdownMetadata("---\r\ntitle: CRLF\r\nscore: 5\r\n---\r\nbody");
    expect(metadata.frontmatter).toEqual({ title: "CRLF", score: 5 });
  });

  test("parses frontmatter whose closing delimiter is at EOF without trailing newline", () => {
    const metadata = parseMarkdownMetadata("---\ntitle: EOF\n---");
    expect(metadata.frontmatter).toEqual({ title: "EOF" });
  });

  test("parses frontmatter with trailing whitespace after the closing delimiter", () => {
    const metadata = parseMarkdownMetadata("---\ntitle: Space\n---  \nbody");
    expect(metadata.frontmatter).toEqual({ title: "Space" });
  });

  test("parses BOM-prefixed frontmatter", () => {
    const metadata = parseMarkdownMetadata("\uFEFF---\ntitle: Bom\n---\nbody");
    expect(metadata.frontmatter).toEqual({ title: "Bom" });
  });

  test("returns empty frontmatter for files without frontmatter", () => {
    const metadata = parseMarkdownMetadata("just a body\nwith no frontmatter");
    expect(metadata.frontmatter).toEqual({});
  });

  test("returns empty frontmatter for an unterminated frontmatter block", () => {
    const metadata = parseMarkdownMetadata("---\ntitle: Unclosed\nbody");
    expect(metadata.frontmatter).toEqual({});
  });

  test("extracts inline and frontmatter tags without duplication", () => {
    const metadata = parseMarkdownMetadata(
      "---\ntags: [frontmatter-tag, nested/child]\n---\nbody with #inline and #frontmatter-tag",
    );
    expect(metadata.tags).toEqual(["frontmatter-tag", "inline", "nested/child"]);
  });

  test("coerces YYYY-MM-DD frontmatter values to Date", () => {
    const metadata = parseMarkdownMetadata("---\ncreated: 2024-01-10\n---\nbody");
    expect(metadata.frontmatter.created).toBeInstanceOf(Date);
    expect((metadata.frontmatter.created as Date).toISOString()).toBe("2024-01-10T00:00:00.000Z");
  });

  test("coerces YYYY-MM-DD HH:mm:ss frontmatter values to Date preserving time", () => {
    const metadata = parseMarkdownMetadata("---\ndue: 2024-06-15 08:30:00\n---\nbody");
    const due = metadata.frontmatter.due as Date;
    expect(due).toBeInstanceOf(Date);
    expect(due.getFullYear()).toBe(2024);
    expect(due.getMonth()).toBe(5);
    expect(due.getDate()).toBe(15);
    expect(due.getHours()).toBe(8);
    expect(due.getMinutes()).toBe(30);
  });

  test("coerces ISO datetime with T separator and offset", () => {
    const metadata = parseMarkdownMetadata("---\nat: 2024-01-10T08:30:00Z\n---\nbody");
    expect((metadata.frontmatter.at as Date).toISOString()).toBe("2024-01-10T08:30:00.000Z");
  });

  test("coerces dates inside nested lists and objects", () => {
    const metadata = parseMarkdownMetadata(
      "---\nhistory:\n  - 2024-01-01\n  - 2024-02-02\nmeta:\n  start: 2024-03-03\n---\nbody",
    );
    expect(metadata.frontmatter.history).toHaveLength(2);
    expect(metadata.frontmatter.history[0]).toBeInstanceOf(Date);
    expect((metadata.frontmatter.meta as { start: unknown }).start).toBeInstanceOf(Date);
  });

  test("keeps invalid and ambiguous date-like strings as strings", () => {
    const metadata = parseMarkdownMetadata(
      "---\nbad: 2024-13-45\nyear_month: 2024-01\nversion: 2024-01-10-alpha\n---\nbody",
    );
    expect(metadata.frontmatter.bad).toBe("2024-13-45");
    expect(metadata.frontmatter.year_month).toBe("2024-01");
    expect(metadata.frontmatter.version).toBe("2024-01-10-alpha");
  });

  test("keeps ordinary strings and numbers untouched", () => {
    const metadata = parseMarkdownMetadata("---\ntitle: Notes\ncount: 3\n---\nbody");
    expect(metadata.frontmatter.title).toBe("Notes");
    expect(metadata.frontmatter.count).toBe(3);
  });

  test("does not harvest tags from fenced code blocks", () => {
    const metadata = parseMarkdownMetadata(
      [
        "---",
        "title: Code",
        "---",
        "Real tag #project/core",
        "",
        "```bash",
        "#codetag-here",
        "echo '#another'",
        "```",
        "",
        "~~~",
        "#tildetag",
        "~~~",
      ].join("\n"),
    );
    expect(metadata.tags).toEqual(["project/core"]);
  });

  test("does not harvest tags from inline code spans", () => {
    const metadata = parseMarkdownMetadata("Body with `#inline-tag` and `` #double `#nested`` real #tag1");
    expect(metadata.tags).toEqual(["tag1"]);
  });

  test("does not harvest tags from frontmatter values outside the tags key", () => {
    const metadata = parseMarkdownMetadata(
      "---\ntitle: A #hash-literal\ndesc: '#quoted too'\n---\nbody #real",
    );
    expect(metadata.tags).toEqual(["real"]);
  });

  test("keeps line-start #tags without a space (Obsidian behaviour)", () => {
    const metadata = parseMarkdownMetadata("#HeadingLikeTag\n\ntext #real/sub\n");
    expect(metadata.tags).toEqual(["HeadingLikeTag", "real/sub"]);
  });

  test("excludes embeds and external URLs from file.links", () => {
    const metadata = parseMarkdownMetadata(
      "![alt](image.png) ![[alpha]] [text](https://example.com) [mail](mailto:a@b.com) [[beta]] [rel](notes/other.md)",
    );
    expect(metadata.links).toEqual(["notes/other.md", "beta"]);
    expect(metadata.embeds).toEqual(["alpha", "image.png"]);
  });

  test("keeps protocol-relative and root-relative targets as links", () => {
    const metadata = parseMarkdownMetadata("[a](/docs/guide.md) [b](./sibling.md) [c](../parent.md)");
    expect(metadata.links).toEqual(["./sibling.md", "../parent.md", "/docs/guide.md"]);
  });
});
