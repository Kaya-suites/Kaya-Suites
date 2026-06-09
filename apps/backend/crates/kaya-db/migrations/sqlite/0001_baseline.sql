-- Baseline SQLite schema. Multi-user — every row carries user_id, just like
-- Postgres and MySQL. Idempotent so it applies cleanly to existing databases.

CREATE TABLE IF NOT EXISTS users (
    id            TEXT    NOT NULL PRIMARY KEY,
    email         TEXT    NOT NULL UNIQUE,
    username      TEXT    UNIQUE,
    password_hash TEXT,
    is_superadmin INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- ── Storage layer (folders, documents, chunks, embeddings) ────────────────────
-- Schema matches Postgres in shape; the sqlite type vocabulary differs.

CREATE TABLE IF NOT EXISTS folders (
    id         TEXT    NOT NULL PRIMARY KEY,
    user_id    TEXT    NOT NULL,
    name       TEXT    NOT NULL,
    parent_id  TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL,
    updated_at TEXT    NOT NULL,
    FOREIGN KEY (parent_id) REFERENCES folders(id)
);
CREATE INDEX IF NOT EXISTS folders_user_parent_sort_idx
    ON folders (user_id, parent_id, sort_order);

CREATE TABLE IF NOT EXISTS documents (
    id               TEXT    NOT NULL PRIMARY KEY,
    user_id          TEXT    NOT NULL,
    title            TEXT    NOT NULL,
    frontmatter_json TEXT    NOT NULL,
    content_hash     TEXT    NOT NULL,
    updated_at       TEXT    NOT NULL,
    deleted_at       TEXT,
    body             TEXT    NOT NULL DEFAULT '',
    folder_id        TEXT,
    sort_order       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS documents_user_folder_sort_idx
    ON documents (user_id, folder_id, sort_order);

CREATE TABLE IF NOT EXISTS chunks (
    user_id      TEXT    NOT NULL,
    document_id  TEXT    NOT NULL,
    paragraph_id TEXT    NOT NULL,
    ordinal      INTEGER NOT NULL,
    content      TEXT    NOT NULL,
    content_hash TEXT    NOT NULL,
    PRIMARY KEY (user_id, document_id, paragraph_id)
);

-- FTS5 stays user-id-less; isolation comes from JOINs against `chunks` /
-- `documents` which both carry user_id.
CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(
    content,
    document_id  UNINDEXED,
    paragraph_id UNINDEXED,
    ordinal      UNINDEXED,
    tokenize     = 'unicode61'
);

CREATE TABLE IF NOT EXISTS chunk_embeddings (
    user_id      TEXT NOT NULL,
    document_id  TEXT NOT NULL,
    paragraph_id TEXT NOT NULL,
    vector       BLOB NOT NULL,
    PRIMARY KEY (user_id, document_id, paragraph_id)
);

-- ── Session layer (chat, embeddings status, UI prefs) ─────────────────────────

CREATE TABLE IF NOT EXISTS chat_sessions (
    id                  TEXT    PRIMARY KEY,
    user_id             TEXT    NOT NULL,
    title               TEXT    NOT NULL,
    created_at          INTEGER NOT NULL,
    updated_at          INTEGER NOT NULL,
    message_count       INTEGER NOT NULL DEFAULT 0,
    total_input_tokens  INTEGER NOT NULL DEFAULT 0,
    total_output_tokens INTEGER NOT NULL DEFAULT 0,
    pinned              INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS chat_messages (
    id            TEXT    PRIMARY KEY,
    session_id    TEXT    NOT NULL,
    user_id       TEXT    NOT NULL,
    role          TEXT    NOT NULL,
    content       TEXT    NOT NULL,
    citations     TEXT    NOT NULL DEFAULT '[]',
    created_at    INTEGER NOT NULL,
    input_tokens  INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    model         TEXT    NOT NULL DEFAULT '',
    proposals     TEXT    NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS document_embedding_status (
    user_id          TEXT    NOT NULL,
    document_id      TEXT    NOT NULL,
    task_id          TEXT,
    status           TEXT    NOT NULL DEFAULT 'pending',
    expected_chunks  INTEGER NOT NULL DEFAULT 0,
    embedded_chunks  INTEGER NOT NULL DEFAULT 0,
    last_error       TEXT,
    updated_at       INTEGER NOT NULL,
    last_indexed_at  INTEGER,
    PRIMARY KEY (user_id, document_id)
);

CREATE TABLE IF NOT EXISTS ui_preferences (
    user_id    TEXT    NOT NULL,
    key        TEXT    NOT NULL,
    value      TEXT    NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, key)
);

-- ── Usage / metering / rate limiting ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS usage_events (
    id            TEXT    NOT NULL PRIMARY KEY,
    user_id       TEXT    NOT NULL,
    operation     TEXT    NOT NULL,
    model         TEXT    NOT NULL,
    input_tokens  INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    cost_usd      REAL    NOT NULL,
    recorded_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS usage_events_user_period ON usage_events (user_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS usage_events_daily       ON usage_events (recorded_at DESC);

CREATE TABLE IF NOT EXISTS usage_counters (
    id                TEXT    NOT NULL PRIMARY KEY,
    user_id           TEXT    NOT NULL,
    period_start      TEXT    NOT NULL,
    tokens_in         INTEGER NOT NULL DEFAULT 0,
    tokens_out        INTEGER NOT NULL DEFAULT 0,
    embed_calls       INTEGER NOT NULL DEFAULT 0,
    agent_invocations INTEGER NOT NULL DEFAULT 0,
    UNIQUE (user_id, period_start)
);

CREATE TABLE IF NOT EXISTS rate_limit_windows (
    user_id      TEXT    NOT NULL,
    window_type  TEXT    NOT NULL,
    window_start TEXT    NOT NULL,
    tokens_used  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, window_type, window_start)
);

CREATE TABLE IF NOT EXISTS system_flags (
    key        TEXT NOT NULL PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS subscriptions (
    id                 TEXT    NOT NULL PRIMARY KEY,
    user_id            TEXT    NOT NULL UNIQUE,
    status             TEXT    NOT NULL DEFAULT 'trialing',
    current_period_end TEXT,
    created_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS embedding_calls (
    id           TEXT    NOT NULL PRIMARY KEY,
    user_id      TEXT    NOT NULL,
    model        TEXT    NOT NULL,
    tokens       INTEGER NOT NULL DEFAULT 0,
    task_id      TEXT,
    task_type    TEXT    NOT NULL DEFAULT 'unknown',
    session_id   TEXT,
    document_id  TEXT,
    paragraph_id TEXT,
    created_at   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS embedding_calls_user ON embedding_calls (user_id, created_at DESC);

-- ── OAuth ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS oauth_clients (
    id                              TEXT    NOT NULL PRIMARY KEY,
    name                            TEXT    NOT NULL,
    secret_hash                     TEXT,
    redirect_uris                   TEXT    NOT NULL,
    client_type                     TEXT    NOT NULL,
    registration_kind               TEXT    NOT NULL,
    owner_user_id                   TEXT,
    registration_access_token_hash  TEXT,
    created_at                      INTEGER NOT NULL,
    updated_at                      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS oauth_clients_owner ON oauth_clients (owner_user_id);

CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
    code_hash             TEXT    NOT NULL PRIMARY KEY,
    client_id             TEXT    NOT NULL,
    user_id               TEXT    NOT NULL,
    redirect_uri          TEXT    NOT NULL,
    scope                 TEXT    NOT NULL,
    code_challenge        TEXT    NOT NULL,
    code_challenge_method TEXT    NOT NULL,
    expires_at            INTEGER NOT NULL,
    consumed_at           INTEGER
);

CREATE TABLE IF NOT EXISTS oauth_access_tokens (
    id           TEXT    NOT NULL PRIMARY KEY,
    token_hash   TEXT    NOT NULL UNIQUE,
    client_id    TEXT    NOT NULL,
    user_id      TEXT    NOT NULL,
    scope        TEXT    NOT NULL,
    kind         TEXT    NOT NULL,
    name         TEXT    NOT NULL DEFAULT '',
    created_at   INTEGER NOT NULL,
    last_used_at INTEGER,
    revoked_at   INTEGER
);
CREATE INDEX IF NOT EXISTS oauth_access_tokens_user   ON oauth_access_tokens (user_id);
CREATE INDEX IF NOT EXISTS oauth_access_tokens_client ON oauth_access_tokens (client_id);

CREATE TABLE IF NOT EXISTS pending_edits (
    id          TEXT    PRIMARY KEY,
    payload     TEXT    NOT NULL,
    created_at  INTEGER NOT NULL
);
