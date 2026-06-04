# Kaya Suites

An AI-native knowledge base where an agent actively maintains documents as a living source of truth.

The project ships as a single Apache 2.0 distribution: a Rust backend (Axum + Cargo workspace) and a Next.js 16 frontend, glued by a generated TypeScript OpenAPI client.

## Highlights

- **Three-agent pipeline.** An orchestrator classifies each chat turn, a read-only researcher gathers evidence, and a write-only editor proposes edits. Read/write isolation is enforced at compile time via `trybuild` tests.
- **Propose-then-approve edits.** No agent can mutate storage directly. Edits become `ProposedEdit` events streamed over SSE; only an explicit user approval mints an `ApprovalToken` that `commit_edit` will accept.
- **Pluggable storage.** A single `StorageAdapter` trait drives three backends in-tree: SQLite (default), Postgres, and MySQL.
- **Pluggable LLM provider.** `LlmProvider` + `ModelRouter` abstract over OpenAI, Anthropic, Gemini, and a `MockProvider` for tests. Routing is config-driven via `kaya.yaml`.
- **Notion-style block editor.** Shipped as a workspace package (`@kaya/markdown-editor`) built on a typed Markdown block model (`@kaya/markdown-model`).

## Repository layout

```
apps/
  web/                Next.js 16 frontend (pnpm)
  backend/            Rust backend, Cargo workspace root
    crates/
      kaya-core/      Traits, agent pipeline, edit primitives
      kaya-storage/   SQLite + Postgres + MySQL adapters
      kaya-server/    Axum HTTP routes + SSE chat
      kaya-auth/      AuthAdapter scaffolds (magic link, password)
      kaya-metering/  Token + spend metering, rate limits
      kaya-db/        Shared DB utilities
    bin/
      kaya-oss/       Self-hosted binary; can embed the frontend
packages/
  api-client/         Generated TypeScript client (from OpenAPI schema)
  markdown-editor/    Notion-like block editor (@kaya/markdown-editor)
  markdown-model/     Markdown block model + parser (@kaya/markdown-model)
  ui/                 Shared React primitives
scripts/
docs/                 Apache 2.0 documentation
```

The Rust workspace root is `apps/backend/Cargo.toml`. There is **no** `Cargo.toml` at the repo root and `apps/web/` is not part of the Cargo workspace.

## Getting started

### Prerequisites

- Rust (stable, edition 2024)
- Node.js ≥ 20 and pnpm ≥ 9
- A SQLite system library (default storage)

### Run the backend

```bash
cd apps/backend
cargo build --workspace
cargo run --bin kaya-oss
```

The OSS binary serves the HTTP API on `http://localhost:3001` by default.

### Run the frontend

```bash
pnpm install          # from repo root
pnpm dev              # runs all workspace dev scripts in parallel
```

Open <http://localhost:3000>. The web app proxies API calls to `NEXT_PUBLIC_API_URL` (default `http://localhost:3001`).

### Regenerate the API client

After changing a backend route or schema:

```bash
cd apps/backend
cargo run --bin kaya-oss -- --schema > ../../packages/api-client/openapi.json
cd ../../
pnpm generate
```

Both `openapi.json` and the updated `packages/api-client/src/` should be committed together.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001` | Backend base URL used by the frontend |
| `OPENAI_API_KEY` | — | Required by the OpenAI provider |
| `ANTHROPIC_API_KEY` | — | Required by the Anthropic provider |
| `GEMINI_API_KEY` | — | Required by the Gemini provider |

LLM routing is configured in `apps/backend/kaya.yaml`. See [docs/llm-provider.md](docs/llm-provider.md) and [CONFIG.md](CONFIG.md).

## Documentation

| Document | Description |
|---|---|
| [Architecture](docs/architecture.md) | System overview, crates, two-build-system layout |
| [Agent architecture](docs/agent/architecture.md) | Orchestrator / Researcher / Editor pipeline and SSE contract |
| [Storage adapter](docs/storage-adapter.md) | `StorageAdapter` trait, SQLite/Postgres/MySQL backends |
| [Auth adapter](docs/auth-adapter.md) | `AuthAdapter` trait and current scaffolds |
| [LLM provider](docs/llm-provider.md) | `LlmProvider`, `ModelRouter`, routing config |
| [API codegen](docs/api-codegen.md) | OpenAPI schema → TypeScript client pipeline |
| [Packages](docs/packages.md) | Frontend workspace packages |
| [Building](docs/building.md) | Builds, test commands, OSS static binary |
| [Configuration](CONFIG.md) | Routing config, env vars, storage backend selection |

## License

Apache 2.0 for everything in this repository. See [LICENSE](LICENSE) and [CONTRIBUTING.md](CONTRIBUTING.md).
