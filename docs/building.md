# Building

## Prerequisites

- Rust (stable toolchain, edition 2024)
- Node.js ≥ 20 and pnpm ≥ 9
- `sqlite3` system library (default storage backend)

## Frontend

```bash
# Install dependencies (from repo root)
pnpm install

# Start the dev server
pnpm dev

# Production build (workspace-wide)
pnpm build
```

The frontend reads its backend base URL from `NEXT_PUBLIC_API_URL` (default `http://localhost:3001`).

## Backend

```bash
cd apps/backend

cargo build --workspace
cargo test --workspace

# Run the OSS binary
cargo run --bin kaya-oss
```

## OSS static binary (frontend embedded)

The `kaya-oss` binary can serve the frontend directly without a separate Node.js process. Recommended for self-hosted deployments.

```bash
# 1. Build the frontend in OSS mode (static export)
cd apps/web
NEXT_PUBLIC_KAYA_BUILD=oss pnpm build

# 2. Copy the static output into the binary's asset directory
cp -r out ../backend/bin/kaya-oss/frontend

# 3. Build the release binary
cd ../backend
cargo build --release --bin kaya-oss
```

The resulting binary at `apps/backend/target/release/kaya-oss` is fully self-contained.

## Code quality

```bash
# Rust
cd apps/backend
cargo fmt
cargo clippy --all-targets

# TypeScript / Next.js
pnpm --filter web lint
```

Both must pass before a PR can be merged.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001` | Backend base URL used by the frontend |
| `NEXT_PUBLIC_KAYA_BUILD` | (unset) | Set to `oss` to enable Next.js `output: "export"` for the embedded-binary path |
| `DATABASE_URL` | sqlite default | Selects the storage backend (sqlite / postgres / mysql) |
| `OPENAI_API_KEY` | — | Required by the OpenAI provider |
| `ANTHROPIC_API_KEY` | — | Required by the Anthropic provider |
| `GEMINI_API_KEY` | — | Required by the Gemini provider |

Provider API keys are resolved through the env-var names declared in `kaya.yaml` — see [LLM provider](llm-provider.md) and [Configuration](../CONFIG.md).
