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
4. Strict mode is enabled by default; users must opt out (`--no-strict`) for permissive behaviour.
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
4. Bun carries broad test coverage; Node and Deno run shared conformance smoke tests against built output. Cross-runtime confidence exists for core flows while detailed behaviour remains Bun-led.

## CI Expectations and Required Checks

Pull requests are expected to pass all required jobs:

1. `lint-typecheck`
2. `test-bun`
3. `test-node`
4. `test-deno`
5. `compat-smoke-cli`

No merge with failing required checks.

## Publishing

npm publishing is automated via a `publish-npm` GitHub Actions workflow triggered on `release.published`, with manual `workflow_dispatch` support. The workflow uses `NPM_TOKEN`, validates tag/version alignment when a tag is supplied, and publishes with `--access public --provenance`. `package.json` must include a `repository.url` pointing to `https://github.com/intellectronica/mdbasequery` for npm provenance verification to succeed.

## Decision Log Protocol

When implementation decisions affect compatibility, runtime behaviour, performance, or developer workflow:

1. Add an entry to this file under the relevant section.
2. If the decision creates an Obsidian divergence, also add it under `## Compatibility Notes`.

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

- `this` context is deterministic CLI/library metadata (`filePath`, `name`) rather than Obsidian embed-location semantics. Known gap: documented `this` patterns (`this.file.folder`, `file.hasLink(this.file)`) do not work; redesign tracked in #8.
- `file.folder` is supported and resolves to the vault-relative parent directory (`""` for root-level notes).
- `file.backlinks` IS implemented: computed during indexing from resolved `file.links` targets (path, name, basename, and basename-with-`.md` lookups). Known limitation: basename collisions across folders resolve arbitrarily; ambiguity policy tracked in #14.
- CSV serialisation uses the selected/declared column list as the canonical header order.
- View `order` is treated as projected column order; row sorting is driven by `sort`.
- When no explicit columns are configured, projected columns are inferred from matched note frontmatter keys (with `file.name` first).
- `--yaml`/`yaml` accepts inline YAML text only; file paths must use `--base`/`basePath`.
- `random()` is deliberately not implemented (deterministic-output engine); divergence from the Obsidian function list tracked in #24.
- Non-standard extension globals beyond the Obsidian function surface: `sum(values)`, `avg(values)`, `count(values)`, `contains(container, needle)`. Docs example `values.mean()` is not yet supported; tracked in #7.
- Frontmatter date properties are coerced to `Date` at index time when they match `YYYY-MM-DD` or `YYYY-MM-DD[T ]HH:mm(:ss(.SSS)?)(offset)?`. Invalid date-like strings and `YYYY-MM` month-granularity values remain strings.

## Improvement Plan (tracked in GitHub issues)

A full audited improvement plan (verified against main @ e80b674, v0.0.1) is filed as issues #1–#25:

- P0 correctness: #1 (and/or operand semantics), #2 (strict-mode identifiers), #3 (CRLF/EOF frontmatter), #4 (date coercion), #5 (groups raw leak), #6 (Moment format tokens), #7 (values.mean), #8 (`this` semantics), #9 (`.md` string equality), #10 (string escapes), #11 (tags in code blocks), #12 (links vs embeds/external), #13 (sort comparator), #14 (backlinks docs/collisions).
- P1 performance: #15 (expression re-parse + context churn), #16 (sequential I/O), #17 (drop `raw`), #18 (lazy formula evaluation), #19 (benchmark harness).
- P2 usability: #20 (displayName), #21 (CLI polish), #22 (serialisation correctness), #23 (diagnostics/schema warnings), #24 (compat gaps: link coercion, asFile, duration fields, random), #25 (conformance parity + linter).

Each issue's acceptance criteria includes updating these notes when it lands.
