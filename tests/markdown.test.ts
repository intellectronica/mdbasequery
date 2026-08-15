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
});
