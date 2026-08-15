import assert from "node:assert/strict";
import { resolve } from "node:path";

export function registerConformanceTests(testFn, repoRoot, modules) {
  const { queryBase, serializeResult } = modules;
  const basicVault = resolve(repoRoot, "fixtures/vaults/basic");
  const linksVault = resolve(repoRoot, "fixtures/vaults/links");

  testFn("conformance: basic query with formulas and summaries", async () => {
    const result = await queryBase({
      dir: basicVault,
      yaml: `
formulas:
  doubled: score * 2
summaries:
  avgScore: values.mean().round(2)
views:
  - type: table
    name: default
    filters: score >= 3
    order:
      - title
      - score
      - formula.doubled
    summaries:
      score: avgScore
`.trim(),
      strict: true,
    });

    assert.equal(result.rows.length, 3);
    assert.equal(result.summaries.score, 6.67);
    const serialized = serializeResult(result, "json");
    assert.match(serialized, /"rows"/);
    assert.match(serialized, /6\.67/);
  });

  testFn("conformance: and/or formula returns operand values", async () => {
    const result = await queryBase({
      dir: basicVault,
      yaml: `
formulas:
  band: score >= 7 and "high" or "low"
views:
  - type: table
    name: default
    properties:
      - title
      - formula.band
`.trim(),
      strict: true,
    });

    const bands = Object.fromEntries(result.rows.map((r) => [r.projected.title, r.projected["formula.band"]]));
    assert.equal(bands.Alpha, "high");
    assert.equal(bands.Beta, "low");
    assert.equal(bands.Gamma, "high");
  });

  testFn("conformance: frontmatter date coercion and Moment formatting", async () => {
    const result = await queryBase({
      dir: basicVault,
      yaml: `
formulas:
  formatted: created.format("YYYY-MM-DD (dddd)")
views:
  - type: table
    name: default
    filters: created >= date("2024-01-01")
    properties:
      - title
      - formula.formatted
`.trim(),
      strict: true,
    });

    assert.equal(result.rows.length, 3);
    const alpha = result.rows.find((r) => r.projected.title === "Alpha");
    assert.match(alpha.projected["formula.formatted"], /2024-01-10/);
  });

  testFn("conformance: grouped view and projected group rows", async () => {
    const result = await queryBase({
      dir: basicVault,
      yaml: `
views:
  - type: table
    name: default
    groupBy: status
    properties:
      - title
      - status
`.trim(),
      strict: true,
    });

    assert.ok(result.groups);
    assert.equal(result.groups.length, 2);
    for (const group of result.groups) {
      for (const row of group.rows) {
        assert.equal(row.file, undefined);
        assert.equal(row.raw, undefined);
        assert.ok(row.title);
      }
    }
  });

  testFn("conformance: strict mode rejects unknown identifiers", async () => {
    await assert.rejects(
      () =>
        queryBase({
          dir: basicVault,
          yaml: `
filters: scoree >= 7
views:
  - type: table
    name: default
`.trim(),
          strict: true,
        }),
      /scoree/,
    );
  });

  testFn("conformance: schema warnings on unknown top-level keys", async () => {
    const result = await queryBase({
      dir: basicVault,
      yaml: `
formuals:
  doubled: score * 2
views:
  - type: custom_view
    name: default
`.trim(),
      strict: false,
    });

    assert.ok(result.diagnostics.warnings.length >= 2);
    assert.ok(result.diagnostics.warnings.some((w) => w.includes("formuals")));
  });

  testFn("conformance: CSV formula injection escaping and Markdown <br>", () => {
    const dummyResult = {
      rows: [
        {
          note: {},
          file: {
            name: "a.md",
            basename: "a",
            path: "a.md",
            folder: "",
            ext: ".md",
            size: 1,
            ctime: new Date(0),
            mtime: new Date(0),
            properties: {},
            tags: [],
            links: [],
            embeds: [],
            backlinks: [],
          },
          formula: {},
          this: {},
          projected: {
            title: "=SUM(A1:A5)",
            desc: "Line 1\nLine 2",
          },
        },
      ],
      columns: ["title", "desc"],
      stats: { scannedFiles: 1, markdownFiles: 1, matchedRows: 1, returnedRows: 1, elapsedMs: 1 },
      diagnostics: { errors: [], warnings: [] },
    };

    const csv = serializeResult(dummyResult, "csv");
    assert.match(csv, /'=SUM\(A1:A5\)/);

    const md = serializeResult(dummyResult, "md");
    assert.match(md, /Line 1<br>Line 2/);
  });

  testFn("conformance: properties.displayName in CSV and MD headers", async () => {
    const result = await queryBase({
      dir: basicVault,
      yaml: `
properties:
  title:
    displayName: Document Title
  score:
    displayName: Quality Score
views:
  - type: table
    name: default
    properties:
      - title
      - score
`.trim(),
      strict: true,
    });

    assert.equal(result.columnLabels.title, "Document Title");
    const csv = serializeResult(result, "csv");
    assert.match(csv, /^Document Title,Quality Score/);
  });

  testFn("conformance: unambiguous basename backlinks", async () => {
    const result = await queryBase({
      dir: linksVault,
      yaml: `
views:
  - type: table
    name: default
    properties:
      - file.name
`.trim(),
      strict: true,
    });

    const betaDoc = result.rows.find((r) => r.file.path === "beta.md");
    assert.ok(betaDoc);
    assert.deepEqual(betaDoc.file.backlinks, ["d.md"]);
  });

  testFn("conformance: duration numeric properties", async () => {
    const result = await queryBase({
      dir: basicVault,
      yaml: `
formulas:
  two_days: duration("48h").days
views:
  - type: table
    name: default
    properties:
      - title
      - formula.two_days
`.trim(),
      strict: true,
    });

    assert.equal(result.rows[0].projected["formula.two_days"], 2);
  });
}
