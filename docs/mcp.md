# MCP (Model Context Protocol) integration

Kaya Suites can act as an [MCP](https://modelcontextprotocol.io/) server, exposing its knowledge-base tools to any MCP-aware client. The two clients we test against are **Claude Desktop** and **Claude Code**.

## Architecture

```
                  ┌────────────────────────────────────┐
Claude Desktop ──▶│  kaya-mcp binary (stdio)           │──┐
Claude Code    ──▶│  reads KAYA_API_TOKEN env          │  │
                  └────────────────────────────────────┘  │
                                                          ├──▶ kaya-mcp crate
                  ┌────────────────────────────────────┐  │    (tool registry,
Remote Claude  ──▶│  kaya-oss /mcp HTTP route          │──┘     auth, transport-agnostic)
                  │  Authorization: Bearer <token>     │
                  └────────────────────────────────────┘
                                  │
                                  ▼
                  ┌────────────────────────────────────┐
                  │  Existing agent Tool trait impls    │
                  │  (kaya-core/src/agent/tools/*)      │
                  └────────────────────────────────────┘
                                  │
                                  ▼
                  ┌────────────────────────────────────┐
                  │  StorageAdapter (kaya-core)         │
                  └────────────────────────────────────┘
```

Two transports share one tool registry (`kaya-mcp::build_tool_router`). Authentication is per-user API tokens stored in the `mcp_tokens` table (SHA-256 hashed; raw value is shown once at creation).

## Exposed tools

| Tool name | Kind | Effect |
|---|---|---|
| `search_documents` | read | Vector-similarity search across documents |
| `search_directories` | read | Search folders / directory metadata |
| `read_document` | read | Fetch one document by UUID |
| `list_documents` | read | List all documents |
| `find_stale_references` | read | Find documents likely stale by hint |
| `propose_create_document` | write (proposal) | Stage a new document |
| `propose_update_document` | write (proposal) | Stage a full-body replacement |
| `propose_modify_document` | write (proposal) | Stage paragraph-level hunks |
| `propose_delete_document` | write (proposal) | Stage a delete |
| `propose_create_folder` | write (proposal) | Stage a new folder |
| `commit_edit` | mcp-only | Apply a previously proposed edit by `edit_id` |
| `reject_edit` | mcp-only | Discard a pending proposed edit |

### Propose-then-commit flow

Write tools do not persist directly. They return `{ edit_id, kind, preview }`. The intended sequence is:

1. The model calls a `propose_*` tool.
2. Each tool's description tells the model to **show the preview to the user and wait for explicit confirmation** before continuing.
3. On "yes", the model calls `commit_edit { edit_id }` — the server mints an [`ApprovalToken`](../apps/backend/crates/kaya-core/src/edit.rs) via `UserSession::approve_edit` and calls `kaya_core::edit::commit_edit`.
4. On "no", the model calls `reject_edit { edit_id }` and the proposal is dropped.

`ApprovalToken` is structurally unforgeable (`pub(crate)` constructor; enforced by `trybuild` tests in `kaya-core/tests/`). The MCP path goes through the same approval seam as the in-process agent pipeline — the protocol surface is the only difference.

## Auth — OAuth 2.1

Kaya is an OAuth 2.1 authorization server. Two paths into a usable access token:

### A. Personal access tokens (stdio + scripts)

For local stdio and CLI / curl integration, mint a long-lived **PAT** from the UI.

1. Sign in to the Kaya web UI.
2. Open **Settings → Personal access tokens (MCP)**.
3. Enter a name (e.g. `laptop-claude-desktop`) and click **Mint token**.
4. Copy the raw value immediately. The page will not show it again.

Server-side: `POST /oauth/personal-tokens` inserts an `oauth_access_tokens` row with `kind = 'pat'` owned by the synthetic PAT client (`PAT_CLIENT_ID`) and returns the raw token once. `GET /oauth/personal-tokens` lists; `DELETE /oauth/personal-tokens/{id}` revokes. The raw token is sha256-hashed before storage.

### B. OAuth code flow with PKCE (Claude Desktop remote MCP)

For Claude Desktop's remote MCP integration the auth handshake is automatic. The client:

1. Hits `/mcp` and receives `401 WWW-Authenticate: Bearer resource_metadata="<issuer>/.well-known/oauth-protected-resource"`.
2. Fetches `/.well-known/oauth-protected-resource`, which points at `<issuer>/.well-known/oauth-authorization-server`.
3. Fetches the AS discovery doc and POSTs to `/oauth/register` (Dynamic Client Registration, RFC 7591).
4. Opens the user's browser to `/oauth/authorize?response_type=code&client_id=…&redirect_uri=…&scope=mcp&code_challenge=…&code_challenge_method=S256&state=…`.
5. User signs into Kaya if needed (`/auth/signin?next=…` round-trip), then sees the consent screen at `/oauth/consent/{req_id}`.
6. On Allow, the page navigates the browser back to the client's localhost callback with `?code=…&state=…`.
7. The client POSTs to `/oauth/token` with the code + PKCE verifier and receives `{ access_token, token_type: "Bearer", scope: "mcp" }`.

Manual app registration is available for clients that can't do DCR — superadmins mint a Client ID + Secret pair under **Admin → OAuth clients**.

### Revoking access

- PATs: **Settings → Personal access tokens** → Revoke.
- OAuth clients you authorized via the browser flow: **Settings → Connected apps** → Revoke. This cascades to every token issued for that client.
- DB level: each token has a `revoked_at` column; `kaya_oauth::tokens::resolve` rejects revoked rows.

## Transport 1 — stdio (Claude Desktop / Claude Code)

Best for self-hosted, single-developer setups. Claude spawns the `kaya-mcp` binary as a child process and talks JSON-RPC over its stdio.

### Build the binary

```sh
cd apps/backend
cargo build --release -p kaya-mcp-bin
# Resulting binary: target/release/kaya-mcp
```

### Required env

| Variable         | Purpose |
|---|---|
| `KAYA_API_TOKEN` | OAuth-issued access token (a PAT in practice — mint one in the UI). Same bearer wire format. |
| `DATABASE_URL`   | Connection string for your Kaya backend. Postgres / SQLite / MySQL all work; dialect is detected from the URL scheme (`postgres://`, `sqlite://`, `mysql://`). |
| `KAYA_CONFIG`    | Optional — path to `kaya.yaml` for the LLM router; required by `search_documents` |
| `KAYA_PUBLIC_URL` | Optional (HTTP transport only) — base URL clients see, used in the OAuth discovery docs and the `WWW-Authenticate` resource-metadata URL. Default `http://localhost:{port}`. |

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) — or the equivalent on your platform:

```json
{
  "mcpServers": {
    "kaya": {
      "command": "/absolute/path/to/kaya-mcp",
      "env": {
        "KAYA_API_TOKEN": "kaya_mcp_…",
        "DATABASE_URL": "sqlite:///absolute/path/to/kaya.db",
        "KAYA_CONFIG": "/absolute/path/to/kaya.yaml"
      }
    }
  }
}
```

Restart Claude Desktop. The Kaya tools appear in the tool picker; ask Claude something like *"Search my Kaya knowledge base for X"*.

### Claude Code

```sh
claude mcp add kaya /absolute/path/to/kaya-mcp \
  -e KAYA_API_TOKEN=kaya_mcp_… \
  -e DATABASE_URL=sqlite:///absolute/path/to/kaya.db \
  -e KAYA_CONFIG=/absolute/path/to/kaya.yaml
```

Then `claude` — the server is available in any session.

## Transport 2 — Streamable HTTP (remote / hosted Kaya)

For hosted multi-tenant Kaya. The `kaya-oss` binary mounts `/mcp` whenever a `ModelRouter` is loaded (i.e. `KAYA_CONFIG` points at a valid `kaya.yaml`). Postgres / SQLite / MySQL backends are all supported — the dispatch is shared with the rest of the binary via `kaya_storage::build_user_adapters`. A startup warning is logged when the route is skipped because the router is missing.

### Per-user service cache

`bin/kaya-oss/src/routes/mcp.rs` keeps an `Arc<RwLock<HashMap<Uuid, Arc<StreamableHttpService<…>>>>>`. On first request from a token, it resolves the user, builds a `KayaService` template, wraps it in `rmcp::StreamableHttpService` (with `LocalSessionManager`), and stores it. Subsequent sessions for the same user share `PendingEditStore`, so `propose_*` and `commit_edit` work across reconnects.

### Claude Desktop (remote)

```json
{
  "mcpServers": {
    "kaya-cloud": {
      "url": "https://kaya.example.com/mcp",
      "headers": { "Authorization": "Bearer kaya_mcp_…" }
    }
  }
}
```

## Code map

| Path | Role |
|---|---|
| `apps/backend/crates/kaya-oauth/src/crypto.rs` | PKCE verify, secret hashing (argon2id), token generation |
| `apps/backend/crates/kaya-oauth/src/{model,clients,codes,tokens}.rs` | OAuth domain types + CRUD over `oauth_clients` / `oauth_authorization_codes` / `oauth_access_tokens` |
| `apps/backend/crates/kaya-server/src/routes/oauth/` | OAuth HTTP endpoints — `discovery`, `register` (DCR), `authorize`, `consent`, `token`, `pat` (PAT + connected-apps) |
| `apps/backend/crates/kaya-mcp/src/pending.rs` | `PendingEditStore` (in-memory edit map) |
| `apps/backend/crates/kaya-mcp/src/preview.rs` | `ProposedEdit → { edit_id, kind, preview }` |
| `apps/backend/crates/kaya-mcp/src/registry.rs` | `build_tool_router()` — bridges `kaya_core::agent::Tool` to `rmcp::ToolRoute` |
| `apps/backend/crates/kaya-mcp/src/service.rs` | `KayaService` (`rmcp::ServerHandler`) |
| `apps/backend/bin/kaya-mcp/src/main.rs` | stdio binary (resolves a bearer access token via `kaya_oauth::tokens::resolve`) |
| `apps/backend/bin/kaya-oss/src/routes/mcp.rs` | `/mcp` HTTP route + per-user service cache + `WWW-Authenticate` discovery |
| `apps/backend/bin/kaya-oss/src/routes/admin.rs` | Superadmin-gated `/admin/oauth/clients` for manual registration |
| `apps/backend/crates/kaya-db/src/lib.rs` | `oauth_*` tables + rollover from legacy `mcp_tokens` |
| `apps/web/app/(shared)/settings/page.tsx` | Personal access tokens + Connected apps cards |
| `apps/web/app/(shared)/oauth/consent/[reqId]/page.tsx` | Consent screen (browser handoff target) |
| `apps/web/app/(shared)/admin/oauth-clients/page.tsx` | Admin manual-client registration UI |

## Known limitations

- **Re-indexing after `commit_edit`** is not yet wired on the MCP path. The HTTP route in `routes/edits.rs` spawns a background re-index after approval; the MCP equivalent will pick this up once the helper is factored out of the route into a shared `commit_and_reindex` in `kaya-core`.
- **Search tools require an `LlmProvider`** with embeddings configured — the search request embeds the query. Without `KAYA_CONFIG`, `search_documents` and `find_stale_references` return errors at call time; the other tools still work.
- **Refresh tokens not implemented.** Access tokens are long-lived; revoke via the UI to invalidate. The token endpoint only supports the `authorization_code` grant.
- **Single `mcp` scope.** No split between `mcp.read` and `mcp.write` yet — the consent screen always grants both.
- **No PAR.** Pushed Authorization Requests (RFC 9126) are not implemented; the client sends auth params directly on the redirect URL.
- **Split-origin dev:** in dev with Next.js at port 3000 and `kaya-oss` at port 3001, the relative redirect from `/oauth/authorize` to `/auth/signin` lands on the backend origin. Either run the embedded build (Next.js export served from `kaya-oss`) or set `KAYA_PUBLIC_URL` to your frontend origin.
