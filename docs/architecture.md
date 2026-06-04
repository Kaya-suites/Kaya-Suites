# Architecture

## Overview

Kaya Suites is an AI-native knowledge base where an agent actively maintains documents as a living source of truth. It ships as a Rust backend (Axum, Cargo workspace) plus a Next.js 16 frontend, connected through a generated TypeScript OpenAPI client.

The whole repository is Apache 2.0.

## Repository layout

```
apps/
  web/                  Next.js 16 frontend (pnpm)
  backend/              Rust backend, Cargo workspace root
packages/
  api-client/           Generated TypeScript client (from OpenAPI schema)
  markdown-editor/      Notion-style block editor (@kaya/markdown-editor)
  markdown-model/       Markdown block model + parser (@kaya/markdown-model)
  ui/                   Shared React primitives (@kaya/ui)
docs/                   This directory
scripts/                Build and release helpers
```

## Two independent build systems

The frontend and backend are kept fully independent:

- `apps/web/` — Next.js 16, managed by **pnpm**. Not added to the Cargo workspace.
- `apps/backend/` — Rust, managed by **Cargo**. Not added to `pnpm-workspace.yaml`.

The only shared surface is `packages/api-client/`, a generated TypeScript client consumed by Next.js. See [API codegen](api-codegen.md).

## Backend crate map

The Cargo workspace root is `apps/backend/Cargo.toml`. There is no `Cargo.toml` at the repo root.

| Crate | Purpose |
|---|---|
| `kaya-core` | Domain types, `StorageAdapter`/`AuthAdapter`/`LlmProvider` traits, edit primitives (`ProposedEdit`, `ApprovalToken`, `commit_edit`), agent pipeline (`Orchestrator`, `Researcher`, `Editor`), tool registration |
| `kaya-storage` | `StorageAdapter` implementations for SQLite, Postgres, and MySQL |
| `kaya-server` | Axum HTTP routes, SSE chat handler, session store |
| `kaya-auth` | `AuthAdapter` scaffolds (magic-link, password) — not yet wired into the server |
| `kaya-metering` | Token / spend accounting, rate limits, circuit breaker primitives |
| `kaya-db` | Shared DB helpers used across adapters |
| `bin/kaya-oss` | Self-hosted binary — can embed the static frontend |

`kaya-core` owns the traits because `commit_edit` lives there and takes `Arc<dyn StorageAdapter>`; placing the trait in `kaya-storage` would have created a circular dependency.

## Key architectural seams

Four enforced seams allow the surface area to grow without changing business logic:

1. **[StorageAdapter](storage-adapter.md)** — swap between SQLite, Postgres, and MySQL without touching agent or HTTP code.
2. **[AuthAdapter](auth-adapter.md)** — abstract over single-user, magic-link, or password auth.
3. **[LlmProvider](llm-provider.md)** — vendor-agnostic interface; no SDK import outside provider files.
4. **Propose-then-approve** — `ApprovalToken` has a `pub(crate)` constructor; only `UserSession::approve_edit` can produce one. Enforced by `trybuild` compile-fail tests in `apps/backend/crates/kaya-core/tests/`.

## Agent pipeline

Chat turns flow through a three-agent pipeline implemented in `kaya-core/src/agent/`: an `Orchestrator` classifies intent, a read-only `Researcher` gathers evidence, and a write-only `Editor` proposes edits. Read/write tool isolation is checked at compile time. See [Agent architecture](agent/architecture.md) for the full event flow and SSE contract.

## Next.js frontend layout

```
apps/web/app/
  (shared)/             App routes — chat, documents, admin, settings, auth, billing
  api/                  Server routes that proxy / wrap backend calls
apps/web/components/    Shared UI components (consume @kaya/ui, @kaya/markdown-editor)
```

`NEXT_PUBLIC_API_URL` controls the backend base URL (default `http://localhost:3001`).

The Notion-style document editor is shipped as `@kaya/markdown-editor`, backed by the block model in `@kaya/markdown-model`. See [Packages](packages.md).
