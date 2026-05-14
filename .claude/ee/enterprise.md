# Enterprise Edition — Architectural Commitments

This file extends `.claude/CLAUDE.md` with BSL 1.1 context. It is stripped from the OSS mirror.

## Additional license boundary detail

- `bin/kaya-cloud/Cargo.toml` is the **only** place BSL crates are pulled in.
- BSL crates live under `crates/ee/`: `kaya-postgres-storage`, `kaya-billing`, `kaya-metering`, `kaya-tenant`.
- Frontend BSL routes: `app/(ee)/` (route group — no `/ee/` URL prefix). Components: `components/ee/`.

## StorageAdapter — EE implementation

- `PostgresAdapter` — `crates/ee/kaya-postgres-storage/`, BSL 1.1
  - Scoped per `UserContext`; no static query methods (multi-tenancy seam).
  - Delegates `search_embeddings` to pgvector for server-side ANN.

## AuthAdapter — EE implementation

- `CloudAuthAdapter` (BSL) — reads session cookie, validates against database. Used by `bin/kaya-cloud`.

## Multi-tenancy seam

The `PostgresAdapter` constructor takes a `UserContext`. All query methods are on the scoped instance. No static query methods.

## kaya-cloud binary (`bin/kaya-cloud/`, BSL 1.1)

- Requires environment variables documented in `bin/kaya-cloud/.env.example`.
- Pricing config at `bin/kaya-cloud/config/pricing.yaml` (overridable via `PRICING_CONFIG_PATH`).
- Dockerfile at `bin/kaya-cloud/Dockerfile`; build context is the repo root.

## What has NOT been implemented yet (EE)

- Metering not yet wired into the agent loop
- No multi-tenant Postgres adapter
- Resend spend-alert and circuit-breaker emails are TODO stubs
