# @kaya/web

The Kaya Suites Next.js 16 frontend. Provides the chat UI, document browser, Notion-style editor, admin pages, and settings.

This package is part of the pnpm workspace at the repo root. It is **not** part of the Cargo workspace — the Rust backend in `apps/backend/` builds independently.

## Develop

```bash
# From the repo root
pnpm install
pnpm dev           # runs the Next.js dev server on :3000
```

The dev server expects the Rust backend to be running on `NEXT_PUBLIC_API_URL` (default `http://localhost:3001`). Start it with:

```bash
cd apps/backend
cargo run --bin kaya-oss
```

## Build

```bash
# Standard build (talks to a separate backend at runtime)
pnpm --filter web build

# OSS build — static export, embeds into the kaya-oss binary
NEXT_PUBLIC_KAYA_BUILD=oss pnpm --filter web build
```

The OSS build emits `apps/web/out/`; copy it into `apps/backend/bin/kaya-oss/frontend/` before running `cargo build --release --bin kaya-oss`. See [docs/building.md](../../docs/building.md).

## Test and lint

```bash
pnpm --filter web lint
pnpm --filter web test
```

## Layout

```
app/
  (shared)/        App routes — chat, documents, admin, settings, auth, billing
  api/             Next.js route handlers that proxy / wrap backend calls
components/        Page-level and shared UI components
hooks/             Custom React hooks
lib/               Pure helpers, shared with packages where possible
types/             TS types — including SSE / chat contracts mirrored from the backend
```

## Conventions

- App Router only — no pages router.
- React 19, Next.js 16. **Read `AGENTS.md`** before changing anything Next.js-specific: this version of Next.js has breaking changes from earlier releases.
- Document editing goes through `@kaya/markdown-editor`; do not introduce a second editor.
- All backend calls go through `@kaya/api-client` (generated). Do not call the Rust backend with hand-rolled `fetch` if a generated client method already exists.
