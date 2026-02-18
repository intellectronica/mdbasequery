# mdbasequery

`mdbasequery` is an Obsidian Bases-compatible query engine for Markdown vaults.

It ships as:

- a CLI (`mdbasequery`) for scripts and terminal workflows,
- a TypeScript library for embedding query execution in applications.

Supported runtimes: Node.js 20+, Bun, and Deno 2.x.

## CLI Manual

### Install and Run

You can run the CLI without installing globally:

```bash
npx mdbasequery --help
bunx mdbasequery --help
```

Or install globally:

```bash
npm install -g mdbasequery
# then
mdbasequery --help
```

### Command Model

Primary form:

```bash
mdbasequery [options]
```

Compatibility alias (also supported):

```bash
mdbasequery query [options]
```

There is one command surface; all behavior is controlled through options.

### Query Input Modes

`mdbasequery` supports three ways to provide the query definition:

1. `.base` file via `--base <path>`
2. YAML via `--yaml <string-or-path>`
3. Flag-built query mode (`--filter`, `--select`, `--sort`, etc.)

If `--base`/`--yaml` are not provided, the query is built from flags.

### Common CLI Examples

Run a `.base` file against a vault:

```bash
mdbasequery \
  --base ./fixtures/queries/basic.base \
  --dir ./fixtures/vaults/basic \
  --format json
```

Use inline YAML (heredoc to avoid shell escaping issues):

```bash
QUERY_YAML=$(cat <<'EOF'
views:
  - type: table
    name: default
    filters: score >= 7
    properties:
      - title
      - score
EOF
)

mdbasequery --yaml "$QUERY_YAML" --dir ./fixtures/vaults/basic --format md
```

Use CLI flags instead of YAML:

```bash
mdbasequery \
  --dir ./fixtures/vaults/basic \
  --filter "score >= 7" \
  --select title \
  --select score \
  --sort score:desc \
  --format csv
```

Select a specific view from a `.base` file and write output to disk:

```bash
mdbasequery \
  --base ./fixtures/queries/grouped.base \
  --view grouped \
  --dir ./fixtures/vaults/basic \
  --format yaml \
  --out ./result.yaml
```

Disable strict symbol/function checking:

```bash
mdbasequery --yaml "views: [{ type: table, name: default }]" --no-strict
```

### CLI Option Reference

| Option | Type | Description |
| --- | --- | --- |
| `--dir <path>` | string | Target directory to scan (default: current directory). |
| `--base <path>` | string | Path to Obsidian-style `.base` YAML file. |
| `--yaml <string-or-path>` | string | Inline YAML text or a path to a YAML file. |
| `--view <name>` | string | View name to run (default: first view). |
| `--format <json|jsonl|yaml|csv|md>` | string | Output format (default: `json`). |
| `--out <path>` | string | Write serialized output to file instead of stdout. |
| `--strict` | flag | Enable strict mode (default behavior). |
| `--no-strict` | flag | Disable strict mode for unknown symbols/functions. |
| `--include <glob>` | repeatable string | Include path glob(s), matched against vault-relative paths. |
| `--exclude <glob>` | repeatable string | Exclude path glob(s), matched against vault-relative paths. |
| `--debug` | flag | Enable debug diagnostics in result metadata. |
| `--filter <expr>` | repeatable string | Add filter expression(s) in flag-built mode. |
| `--select <property>` | repeatable string | Select/project property/column in flag-built mode. |
| `--sort <prop:asc|desc>` | repeatable string | Sort criteria in flag-built mode. |
| `--group-by <property>` | string | Group rows by one property in flag-built mode. |
| `--limit <n>` | number | Limit row count in flag-built mode. |
| `--help`, `-h` | flag | Show CLI help text. |

### Output Formats

- `json`: one structured object with rows, columns, summaries, stats, diagnostics.
- `jsonl`: one JSON object per row.
- `yaml`: YAML representation of the full result object.
- `csv`: projected columns in declared/selected order.
- `md`: Markdown table for quick human review.

### Exit Codes and Diagnostics

- Exit code `0`: successful query execution.
- Exit code `1`: fatal CLI/query error, or row-level diagnostics recorded as errors.

Diagnostics are returned as part of result metadata (and included in structured formats).

### Compatibility and Behavior Notes

- Filters and formulas share the same expression language.
- Effective filter per view is `global filter AND view filter`.
- Formula dependencies are topologically ordered; cycles fail clearly.
- Strict mode is enabled by default.
- Summary formulas evaluate with `values` bound to selected column values.
- Output ordering is deterministic.
- `this` context in CLI/library mode is deterministic metadata (`filePath`, `name`).

## Library Manual

### Installation

```bash
npm install mdbasequery
# or
bun add mdbasequery
```

### Quick Start

```ts
import { queryBase, serializeResult } from "mdbasequery";

const result = await queryBase({
  dir: "./fixtures/vaults/basic",
  yaml: `
views:
  - type: table
    name: default
    filters: score >= 7
    properties:
      - title
      - score
`.trim(),
  strict: true,
});

console.log(result.rows.length);
console.log(serializeResult(result, "json"));
```

### API Overview

Primary exports:

- `queryBase(options): Promise<QueryResult>`
- `parseBaseYaml(input): QuerySpec`
- `compileQuery(spec, options?): CompiledQuery`
- `runCompiledQuery(compiled, source?): Promise<QueryResult>`
- `serializeResult(result, format): string`

Runtime adapters:

- `detectRuntimeAdapter()`
- `nodeAdapter`, `bunAdapter`, `denoAdapter`

### `queryBase` Options

`queryBase` accepts a `QueryBaseOptions` object with:

- `spec?: QuerySpec` - already parsed query spec.
- `basePath?: string` - path to `.base` file.
- `yaml?: string` - inline YAML or YAML path.
- `view?: string` - selected view name.
- `dir?: string` - vault root directory.
- `strict?: boolean` - strict symbol/function behavior (default true).
- `include?: string[]` - include globs.
- `exclude?: string[]` - exclude globs.
- `debug?: boolean` - enable debug diagnostics.
- `adapter?: RuntimeAdapter` - runtime adapter injection.

Provide exactly one query source among `spec`, `basePath`, or `yaml`.

### Compile Once, Run Many

```ts
import { compileQuery, parseBaseYaml, runCompiledQuery } from "mdbasequery";

const spec = parseBaseYaml(`
views:
  - type: table
    name: default
    filters: score >= 7
`.trim());

const compiled = compileQuery(spec, { strict: true });

const first = await runCompiledQuery(compiled, { dir: "./vault-a" });
const second = await runCompiledQuery(compiled, { dir: "./vault-b" });

console.log(first.rows.length, second.rows.length);
```

### Result Shape

`QueryResult` contains:

- `rows`: row contexts with `note`, `file`, `formula`, `this`, and `projected` fields.
- `columns`: projected column order.
- `groups?`: grouped rows when grouping is active.
- `summaries?`: computed summary values.
- `stats`: scan/match timing and counts.
- `diagnostics`: warnings and errors.

### Error Handling

- Schema/YAML issues throw validation errors (for example from `parseBaseYaml`).
- Strict mode rejects unknown identifiers/functions.
- Formula cycles throw explicit cycle errors.
- CLI returns exit code `1` for failures and diagnostic errors.

## Development Manual

### Prerequisites

- Bun (primary dev runtime)
- Node.js 20+
- Deno 2.x

### Setup

```bash
bun install
```

### Build and Test Commands

```bash
bun run build
bun run lint-typecheck
bun run test:bun
bun run test:node
bun run test:deno
bun run ci
```

`bun run ci` runs the required local validation suite:

1. typecheck/lint
2. Bun tests
3. Node conformance tests
4. Deno conformance tests

### CI Jobs

GitHub Actions runs:

- `lint-typecheck`
- `test-bun`
- `test-node`
- `test-deno`
- `compat-smoke-cli` (matrix across Bun/Node/Deno)

### Repository Layout

- `src/core` - schema, expression engine, query engine, serialization, indexing.
- `src/runtime-adapters` - runtime-specific filesystem/path adapters.
- `src/cli.ts` - CLI entrypoint.
- `tests` - Bun test suite (unit/integration/docs smoke).
- `test-runtime` - Node/Deno conformance tests.
- `fixtures` - vault and query fixtures.
- `.github/workflows/ci.yml` - CI workflow definitions.

### Release Checklist

1. Ensure `bun run ci` passes locally.
2. Ensure GitHub Actions checks are green.
3. Build artifacts (`dist`) and package metadata are correct.
4. Publish to npm.
5. Verify `npx mdbasequery --help` and `bunx mdbasequery --help` post-release.
