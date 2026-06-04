# Workspace Packages

The `packages/` directory contains the pnpm workspace packages consumed by `apps/web`. All packages are private (`"private": true`) but published into the workspace under the `@kaya/*` scope.

## `@kaya/api-client`

**Path:** `packages/api-client/`

The generated TypeScript client for the Rust backend's OpenAPI schema. The pipeline is:

1. `cargo run --bin kaya-oss -- --schema` emits `openapi.json`.
2. `pnpm generate` runs `@hey-api/openapi-ts` and writes the TypeScript output to `src/`.

Both the schema and the generated source are committed to the repo so consumers don't have to run the pipeline. See [API codegen](api-codegen.md).

```ts
import { DocumentsService } from "@kaya/api-client";

const docs = await DocumentsService.listDocuments();
```

## `@kaya/markdown-model`

**Path:** `packages/markdown-model/`

A typed block model for Markdown documents. Defines the block shapes (paragraph, heading, list, code, table, etc.), a parser that turns raw Markdown into a block tree, and a serializer that round-trips back. Has no React or DOM dependencies — it can be used in tests, server code, and the editor alike.

Used by:

- `@kaya/markdown-editor` as its document model.
- `apps/web` server routes that need to inspect or transform Markdown.

Run the unit tests with `pnpm --filter @kaya/markdown-model test`.

## `@kaya/markdown-editor`

**Path:** `packages/markdown-editor/`

A Notion-style block editor built on `@kaya/markdown-model`. Renders a document as a stack of interactive blocks, supports inline formatting, code blocks with Prism highlighting, Mermaid diagrams, and proposal overlays for the agent's edit suggestions.

Peer dependencies: React 19 and Next.js 16 (consumed via `apps/web`).

Run the unit tests with `pnpm --filter @kaya/markdown-editor test`.

## `@kaya/ui`

**Path:** `packages/ui/`

Shared React primitives used across the web app — small, presentational components without business logic. Peer-depends on React 19.

## Frontend dependency graph

```
apps/web
  ├── @kaya/api-client          (HTTP client → Rust backend)
  ├── @kaya/markdown-editor     (document editor)
  │     └── @kaya/markdown-model
  └── @kaya/ui                  (shared UI primitives)
```
