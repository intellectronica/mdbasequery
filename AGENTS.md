# MDBaseQuery - Agent Operating Guide

## Project Mission and Compatibility Scope

`mdbasequery` is a TypeScript library and CLI that executes Obsidian Bases-style queries against Markdown vaults.

Primary compatibility target:

1. Accept Obsidian-style `.base` YAML definitions.
2. Run filters, formulas, sorting, grouping, limits, and summaries with deterministic results.
3. Expose both library output objects and CLI serializers (`json`, `jsonl`, `yaml`, `csv`, `md`).
4. Preserve practical parity with Obsidian Bases expression semantics where feasible.

Non-goals for v0:

- Obsidian UI rendering.
- Editor interactions.
- Plugin-provided custom functions.

## TDD Workflow Requirements

Red-green-refactor is mandatory.

For every behaviour change:

1. Write or update failing tests first.
2. Implement the smallest change that makes tests pass.
3. Refactor while keeping tests green.
4. Add regression coverage for every bug fix.

Minimum local validation before completion:

- `bun run lint-typecheck`
- `bun run test:bun`
- `bun run test:node`
- `bun run test:deno`

## Query Compatibility Principles

1. Filter expressions and formulas use the same expression language.
2. Effective view filter is `global filters AND view filters`.
3. Formula dependencies are topologically ordered; cycles must fail with a clear error.
4. Strict mode defaults to enabled for unknown identifiers/functions.
5. Summary formulas evaluate with `values` bound to the selected column values.
6. Output ordering must remain deterministic across runs.

## Runtime Support Policy

Supported runtimes:

- Node.js 20+
- Bun (primary development runtime)
- Deno 2.x

Policy:

1. Core modules must remain runtime-agnostic.
2. Runtime-specific behaviour belongs in adapters (`src/runtime-adapters`).
3. Avoid introducing Node-only globals into shared core logic.

## CI Expectations and Required Checks

Pull requests are expected to pass all required jobs:

1. `lint-typecheck`
2. `test-bun`
3. `test-node`
4. `test-deno`
5. `compat-smoke-cli`

No merge with failing required checks.

## Decision Log Protocol

When implementation decisions affect compatibility, runtime behaviour, performance, or developer workflow:

1. Add an entry under `## Decision Log` in this file.
2. Include date, context, decision, and consequence.
3. If the decision creates an Obsidian divergence, also add it under `## Compatibility Notes`.

Entry template:

```
- YYYY-MM-DD - <topic>
  - Context: <why this mattered>
  - Decision: <what was chosen>
  - Consequence: <impact/tradeoff>
```

## Continuous Update Protocol

1. After landing any behaviour change, add or update a short note in AGENTS.md.
2. When a new edge case is discovered, record it under "Compatibility notes".
3. When implementation diverges from Obsidian behaviour, record divergence and rationale.
4. When adding/removing dependencies, record why and cross-runtime impact.
5. Keep AGENTS.md as living operational memory, not static policy text.

## Git Workflow

When asked to create commits in this repository:

1. Commit logical units with clear messages.
2. Prefix commit messages with `[AI] `.
3. Never rewrite remote history without explicit user instruction.

## Compatibility Notes

- `this` context is deterministic CLI/library metadata (`filePath`, `name`) rather than Obsidian embed-location semantics.
- `file.folder` is supported and resolves to the vault-relative parent directory (`""` for root-level notes).
- `file.backlinks` is not implemented in v0 (reserved for future opt-in indexing pass).
- CSV serialisation uses the selected/declared column list as the canonical header order.
- View `order` is treated as projected column order; row sorting is driven by `sort`.
- When no explicit columns are configured, projected columns are inferred from matched note frontmatter keys (with `file.name` first).
- `--yaml`/`yaml` accepts inline YAML text only; file paths must use `--base`/`basePath`.

## Decision Log

- 2026-02-18 - Runtime conformance strategy
  - Context: Full Bun test runner semantics are not directly shared with Node and Deno.
  - Decision: Keep broad coverage in Bun tests and run shared conformance smoke tests in Node/Deno against built output.
  - Consequence: Cross-runtime confidence exists for core flows while detailed behaviour remains Bun-led.

- 2026-02-18 - Strict mode default
  - Context: Query portability requires predictable failures on unknown symbols.
  - Decision: Enable strict mode by default in API and CLI.
  - Consequence: Users must opt out (`--no-strict`) for permissive behaviour.

- 2026-02-18 - `file.folder` compatibility support
  - Context: Real-world Base filters often rely on `file.folder` to scope notes by directory.
  - Decision: Add `file.folder` to indexed file metadata as the vault-relative parent path.
  - Consequence: Queries depending on folder-based filtering now evaluate correctly without strict-mode property errors.

- 2026-02-18 - View projection and property-name handling
  - Context: Real `.base` files depend on `order` for visible columns and often use frontmatter keys containing spaces.
  - Decision: Treat `view.order` as column projection order, keep `view.sort` for row ordering, infer columns when unspecified, and resolve non-expression property names directly from note data.
  - Consequence: Query output now includes expected Base properties instead of falling back to `file.name`/`file.path` defaults.

- 2026-02-18 - Inline-only YAML option semantics
  - Context: `--yaml` overlapped with `--base` by auto-detecting file paths, which created ambiguous query source behavior.
  - Decision: Restrict `--yaml`/`yaml` to inline YAML text and reject path-like input with guidance to use `--base`/`basePath`.
  - Consequence: CLI and library query-source semantics are clearer and avoid accidental mode switching based on filesystem state.

- 2026-02-18 - Release-driven npm publishing
  - Context: Package publication should happen automatically when a GitHub release is published.
  - Decision: Add a `publish-npm` GitHub Actions workflow triggered by `release.published` with manual `workflow_dispatch` support, using `NPM_TOKEN`, validating tag/version alignment when a tag is supplied, and publishing with `--access public --provenance`.
  - Consequence: Publishing is automated for releases, can be manually retried without creating a new release, and remains guarded against version/tag mismatches.
