# mdbasequery

`mdbasequery` is a TypeScript library and CLI for running Obsidian Bases-style queries against Markdown vaults.

## Features

- Obsidian-style `.base` and YAML query parsing.
- Filter and formula evaluation with strict mode by default.
- Sort, group, limit, and summary execution.
- Deterministic output ordering for testable runs.
- Serializers for `json`, `jsonl`, `yaml`, `csv`, and `md`.
- Runtime adapters for Node, Bun, and Deno.

## CLI

Run a `.base` file:

```bash
mdbasequery query --base ./fixtures/queries/basic.base --dir ./fixtures/vaults/basic --format json
```

Build a query from flags:

```bash
mdbasequery query --dir ./fixtures/vaults/basic --filter "score >= 7" --select title --sort score:desc --format csv
```

## Library usage

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
});

console.log(serializeResult(result, "json"));
```

## Development

Run the full validation suite:

```bash
bun run ci
```

Individual commands:

- `bun run lint-typecheck`
- `bun run test:bun`
- `bun run test:node`
- `bun run test:deno`
