# Contributing to Kaya Suites

Thanks for your interest in contributing. The whole repository is Apache 2.0 and open to outside contribution.

## Surface area

- `apps/backend/crates/kaya-core/` — core traits, edit primitives, three-agent pipeline
- `apps/backend/crates/kaya-storage/` — SQLite, Postgres, and MySQL adapters
- `apps/backend/crates/kaya-server/` — Axum HTTP routes and SSE chat
- `apps/backend/crates/kaya-auth/` — auth adapter scaffolds
- `apps/backend/crates/kaya-metering/` — token/spend metering
- `apps/backend/bin/kaya-oss/` — self-hosted binary
- `apps/web/` — Next.js 16 frontend
- `packages/` — `@kaya/api-client`, `@kaya/markdown-editor`, `@kaya/markdown-model`, `@kaya/ui`

## Development setup

```bash
# Frontend workspace
pnpm install

# Backend workspace
cd apps/backend && cargo build --workspace
```

### OSS static binary (frontend embedded)

```bash
cd apps/web
NEXT_PUBLIC_KAYA_BUILD=oss pnpm build
cp -r out ../backend/bin/kaya-oss/frontend
cd ../backend
cargo build --release --bin kaya-oss
```

The resulting binary at `apps/backend/target/release/kaya-oss` serves the API and the frontend from a single process.

## Running tests

```bash
# Rust
cd apps/backend && cargo test --workspace

# Frontend
pnpm --filter web lint
pnpm --filter @kaya/markdown-editor test
pnpm --filter @kaya/markdown-model test
```

## Submitting a PR

1. Fork the repo and create a branch from `main`.
2. Run `cargo test --workspace` and `pnpm build` before pushing.
3. Keep PRs focused — one feature or fix per PR.
4. Add tests for new behaviour. For agent tool isolation changes, add or update a `trybuild` compile-fail case in `apps/backend/crates/kaya-core/tests/fail/`.
5. If you changed a backend route or schema, regenerate the API client and commit both `packages/api-client/openapi.json` and `packages/api-client/src/`.

CI must be green before merge.

## Code style

- Rust: `cargo fmt` and `cargo clippy --all-targets` must pass.
- TypeScript: `pnpm --filter web lint` must pass.
- Don't add a comment that just restates what the code does — only the non-obvious "why".

## Licence

By contributing you agree your contribution is licensed under the Apache 2.0 licence.
