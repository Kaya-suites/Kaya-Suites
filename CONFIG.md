# Configuration Reference

This document covers the configuration surfaces a self-hosted Kaya deployment can tune. The backend reads `apps/backend/kaya.yaml` at startup and looks up provider credentials and runtime knobs from environment variables.

---

## Environment variables

| Variable | Default | Used by |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001` | Frontend — backend base URL |
| `NEXT_PUBLIC_KAYA_BUILD` | (unset) | Frontend — set to `oss` to enable Next.js `output: "export"` for the embedded-static-binary path |
| `OPENAI_API_KEY` | — | OpenAI provider |
| `ANTHROPIC_API_KEY` | — | Anthropic provider |
| `GEMINI_API_KEY` | — | Gemini provider |
| `DATABASE_URL` | sqlite default | Storage adapter — selects backend (see below) |

Additional variables may be referenced by individual crates; the canonical list lives next to each adapter.

---

## Storage backend

`kaya-storage` ships three implementations of `StorageAdapter`: SQLite, Postgres, and MySQL. The active backend is selected at startup from `DATABASE_URL`:

| Scheme | Backend |
|---|---|
| `sqlite://…` (or unset) | SQLite + sqlite-vec — recommended for single-node self-host |
| `postgres://…` | Postgres + pgvector — recommended for multi-user deployments |
| `mysql://…` | MySQL — experimental |

See [docs/storage-adapter.md](docs/storage-adapter.md) for the trait surface and per-backend trade-offs.

---

## LLM routing (`kaya.yaml`)

`kaya.yaml` maps each logical `OperationType` to a `(provider, model)` pair. All seven operation types must be present at startup; missing or unknown providers are caught with a descriptive error.

```yaml
routing:
  retrieval_classification: { provider: openai,    model: gpt-4o-mini }
  document_generation:      { provider: anthropic, model: claude-opus-4-6 }
  edit_proposal:            { provider: anthropic, model: claude-opus-4-6 }
  stale_detection:          { provider: openai,    model: gpt-4o-mini }
  embedding:                { provider: openai,    model: text-embedding-3-small }
  intent_classification:    { provider: openai,    model: gpt-4o-mini }
  research_synthesis:       { provider: anthropic, model: claude-opus-4-6 }

providers:
  openai:    { api_key_env: OPENAI_API_KEY }
  anthropic: { api_key_env: ANTHROPIC_API_KEY }
  gemini:    { api_key_env: GEMINI_API_KEY }
```

The defaults above follow the documented cost split (cheap classifier model + strong write model + embedding model). The committed `apps/backend/kaya.yaml` currently overrides every routing slot to a single OpenAI model — that override is convenient for local dev with one API key, but is not the recommended production setup.

See [docs/llm-provider.md](docs/llm-provider.md) for the full provider contract.

---

## Metering

`kaya-metering` records per-user token and spend totals and exposes hooks for rate limits and circuit breakers. It is not wired into the agent loop by default — the wiring points are documented in `MeteringService`. See the crate source for the full surface.
