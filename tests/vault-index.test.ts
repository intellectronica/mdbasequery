import { resolve } from "node:path";

import { describe, expect, test } from "bun:test";

import { nodeAdapter } from "../src/runtime-adapters/node.js";
import { indexVault } from "../src/core/vault-index.js";
import { fixturesRoot } from "./helpers.js";

describe("vault indexing", () => {
  const rootDir = resolve(fixturesRoot, "vaults/basic");

  test("indexes markdown files from target directory", async () => {
    const indexed = await indexVault({
      rootDir,
      include: ["**/*.md"],
      exclude: [],
      adapter: nodeAdapter,
    });

    expect(indexed.scannedFiles).toBeGreaterThanOrEqual(4);
    expect(indexed.markdownFiles).toBe(3);
    expect(indexed.documents).toHaveLength(3);
  });

  test("supports include and exclude patterns", async () => {
    const indexed = await indexVault({
      rootDir,
      include: ["nested/*.md"],
      exclude: ["**/gamma.md"],
      adapter: nodeAdapter,
    });

    expect(indexed.documents).toHaveLength(0);
  });

  test("extracts frontmatter, tags, and links", async () => {
    const indexed = await indexVault({
      rootDir,
      include: ["alpha.md"],
      exclude: [],
      adapter: nodeAdapter,
    });

    expect(indexed.documents).toHaveLength(1);
    const [document] = indexed.documents;

    expect(document.note.frontmatter.title).toBe("Alpha");
    expect(document.file.tags).toEqual(["project/core"]);
    expect(document.file.links).toEqual(["beta"]);
  });

  test("file properties are deterministic", async () => {
    const indexed = await indexVault({
      rootDir,
      include: ["**/*.md"],
      exclude: [],
      adapter: nodeAdapter,
    });

    const paths = indexed.documents.map((entry) => entry.file.path);
    expect(paths).toEqual(["alpha.md", "beta.md", "nested/gamma.md"]);
  });

  test("backlinks resolve unique basenames", async () => {
    const linksRoot = resolve(fixturesRoot, "vaults/links");
    const indexed = await indexVault({
      rootDir: linksRoot,
      include: ["**/*.md"],
      exclude: [],
      adapter: nodeAdapter,
    });

    const byPath = new Map(indexed.documents.map((doc) => [doc.file.path, doc]));

    expect(byPath.get("beta.md")?.file.backlinks).toEqual(["d.md"]);
    expect(byPath.get("a/alpha.md")?.file.backlinks).toEqual(["c.md"]);
  });

  test("ambiguous basenames produce no backlink", async () => {
    const linksRoot = resolve(fixturesRoot, "vaults/links");
    const indexed = await indexVault({
      rootDir: linksRoot,
      include: ["**/*.md"],
      exclude: [],
      adapter: nodeAdapter,
    });

    const byPath = new Map(indexed.documents.map((doc) => [doc.file.path, doc]));

    // e.md links to ambiguous [[alpha]], which matches neither a/alpha nor b/alpha
    expect(byPath.get("a/alpha.md")?.file.backlinks).not.toContain("e.md");
    expect(byPath.get("b/alpha.md")?.file.backlinks).not.toContain("e.md");
    expect(byPath.get("b/alpha.md")?.file.backlinks).toEqual([]);
  });
});
