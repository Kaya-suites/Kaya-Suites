-- Baseline Postgres schema. Idempotent (IF NOT EXISTS everywhere) so it
-- applies cleanly to existing production databases — first sqlx run records
-- this as applied; every CREATE/ALTER becomes a no-op.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS users (
    id            VARCHAR(36)  NOT NULL,
    email         TEXT         NOT NULL,
    username      TEXT         UNIQUE,
    password_hash TEXT,
    is_superadmin BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (id),
    UNIQUE (email)
);

CREATE TABLE IF NOT EXISTS folders (
    id          VARCHAR(36)  NOT NULL,
    user_id     VARCHAR(36)  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT         NOT NULL,
    parent_id   VARCHAR(36)  REFERENCES folders(id) ON DELETE CASCADE,
    sort_order  INTEGER      NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS folders_user ON folders (user_id, parent_id, sort_order);

CREATE TABLE IF NOT EXISTS documents (
    id            VARCHAR(36)  NOT NULL,
    user_id       VARCHAR(36)  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title         TEXT         NOT NULL,
    owner         TEXT,
    last_reviewed DATE,
    tags          TEXT[]       NOT NULL DEFAULT '{}',
    related_docs  TEXT[]       NOT NULL DEFAULT '{}',
    body          TEXT         NOT NULL DEFAULT '',
    content_hash  TEXT         NOT NULL DEFAULT '',
    folder_id     VARCHAR(36)  REFERENCES folders(id) ON DELETE SET NULL,
    sort_order    INTEGER      NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    deleted_at    TIMESTAMPTZ,
    PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS documents_user_active ON documents (user_id, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS documents_user_folder_order ON documents (user_id, folder_id, sort_order);

-- ADD COLUMN IF NOT EXISTS for pre-existing tables that pre-date these columns.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS folder_id VARCHAR(36) REFERENCES folders(id) ON DELETE SET NULL;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS document_versions (
    id            VARCHAR(36)  NOT NULL,
    document_id   VARCHAR(36)  NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    user_id       VARCHAR(36)  NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
    body_snapshot TEXT         NOT NULL,
    content_hash  TEXT         NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS chunks (
    user_id      VARCHAR(36)  NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
    document_id  VARCHAR(36)  NOT NULL REFERENCES documents(id)  ON DELETE CASCADE,
    paragraph_id TEXT         NOT NULL,
    ordinal      INTEGER      NOT NULL,
    content      TEXT         NOT NULL,
    content_hash TEXT         NOT NULL,
    tsv          TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
    PRIMARY KEY (user_id, document_id, paragraph_id)
);
CREATE INDEX IF NOT EXISTS chunks_tsv ON chunks USING GIN (tsv);

CREATE TABLE IF NOT EXISTS chunk_embeddings (
    user_id      VARCHAR(36)   NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
    document_id  VARCHAR(36)   NOT NULL REFERENCES documents(id)  ON DELETE CASCADE,
    paragraph_id TEXT          NOT NULL,
    vector       VECTOR(1536)  NOT NULL,
    PRIMARY KEY (user_id, document_id, paragraph_id)
);
CREATE INDEX IF NOT EXISTS chunk_embeddings_hnsw ON chunk_embeddings USING hnsw (vector vector_cosine_ops);

CREATE TABLE IF NOT EXISTS chat_sessions (
    id                  VARCHAR(36)  NOT NULL,
    user_id             VARCHAR(36)  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title               TEXT,
    total_input_tokens  INTEGER      NOT NULL DEFAULT 0,
    total_output_tokens INTEGER      NOT NULL DEFAULT 0,
    pinned              BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS chat_sessions_user ON chat_sessions (user_id, updated_at DESC);
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS chat_messages (
    id            VARCHAR(36)  NOT NULL,
    session_id    VARCHAR(36)  NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    user_id       VARCHAR(36)  NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
    role          TEXT         NOT NULL CHECK (role IN ('user','assistant','system','tool')),
    content       TEXT         NOT NULL,
    citations     JSONB        NOT NULL DEFAULT '[]',
    input_tokens  INTEGER      NOT NULL DEFAULT 0,
    output_tokens INTEGER      NOT NULL DEFAULT 0,
    model         TEXT         NOT NULL DEFAULT '',
    proposals     JSONB        NOT NULL DEFAULT '[]',
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (id)
);
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS proposals JSONB NOT NULL DEFAULT '[]';
CREATE INDEX IF NOT EXISTS chat_messages_session ON chat_messages (session_id, user_id, created_at ASC);

CREATE TABLE IF NOT EXISTS user_ui_preferences (
    user_id          VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    preference_key   TEXT        NOT NULL,
    preference_value JSONB       NOT NULL,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, preference_key)
);

CREATE TABLE IF NOT EXISTS tool_invocations (
    id          VARCHAR(36)  NOT NULL,
    session_id  VARCHAR(36)  NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    user_id     VARCHAR(36)  NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
    tool_name   TEXT         NOT NULL,
    input_json  JSONB        NOT NULL,
    output_json JSONB,
    started_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS usage_counters (
    id                VARCHAR(36) NOT NULL,
    user_id           VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    period_start      DATE        NOT NULL,
    tokens_in         BIGINT      NOT NULL DEFAULT 0,
    tokens_out        BIGINT      NOT NULL DEFAULT 0,
    embed_calls       BIGINT      NOT NULL DEFAULT 0,
    agent_invocations BIGINT      NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE (user_id, period_start)
);

CREATE TABLE IF NOT EXISTS usage_events (
    id            VARCHAR(36)      NOT NULL,
    user_id       VARCHAR(36)      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    operation     TEXT             NOT NULL,
    model         TEXT             NOT NULL,
    input_tokens  INTEGER          NOT NULL,
    output_tokens INTEGER          NOT NULL,
    cost_usd      DOUBLE PRECISION NOT NULL,
    recorded_at   TIMESTAMPTZ      NOT NULL DEFAULT now(),
    PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS usage_events_user_period ON usage_events (user_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS usage_events_daily ON usage_events (recorded_at DESC);

CREATE TABLE IF NOT EXISTS rate_limit_windows (
    user_id      VARCHAR(36)  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    window_type  TEXT         NOT NULL CHECK (window_type IN ('hourly','daily')),
    window_start TIMESTAMPTZ  NOT NULL,
    tokens_used  BIGINT       NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, window_type, window_start)
);

CREATE TABLE IF NOT EXISTS system_flags (
    key        TEXT        NOT NULL,
    value      TEXT        NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (key)
);

CREATE TABLE IF NOT EXISTS subscriptions (
    id                 VARCHAR(36)  NOT NULL,
    user_id            VARCHAR(36)  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status             TEXT         NOT NULL DEFAULT 'trialing',
    current_period_end TIMESTAMPTZ,
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (id),
    UNIQUE (user_id)
);

CREATE TABLE IF NOT EXISTS embedding_calls (
    id           VARCHAR(36)  NOT NULL,
    user_id      VARCHAR(36)  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    model        TEXT         NOT NULL,
    tokens       INTEGER      NOT NULL DEFAULT 0,
    task_id      TEXT,
    task_type    TEXT         NOT NULL DEFAULT 'unknown',
    session_id   VARCHAR(36),
    document_id  VARCHAR(36),
    paragraph_id TEXT,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS embedding_calls_user ON embedding_calls (user_id, created_at DESC);
ALTER TABLE embedding_calls ADD COLUMN IF NOT EXISTS task_id TEXT;
ALTER TABLE embedding_calls ADD COLUMN IF NOT EXISTS task_type TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE embedding_calls ADD COLUMN IF NOT EXISTS session_id VARCHAR(36);
ALTER TABLE embedding_calls ADD COLUMN IF NOT EXISTS document_id VARCHAR(36);
ALTER TABLE embedding_calls ADD COLUMN IF NOT EXISTS paragraph_id TEXT;

CREATE TABLE IF NOT EXISTS document_embedding_status (
    user_id         VARCHAR(36)  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_id     VARCHAR(36)  NOT NULL,
    task_id         TEXT,
    status          TEXT         NOT NULL DEFAULT 'pending',
    expected_chunks INTEGER      NOT NULL DEFAULT 0,
    embedded_chunks INTEGER      NOT NULL DEFAULT 0,
    last_error      TEXT,
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    last_indexed_at TIMESTAMPTZ,
    PRIMARY KEY (user_id, document_id)
);

CREATE TABLE IF NOT EXISTS oauth_clients (
    id                              VARCHAR(36)  NOT NULL,
    name                            TEXT         NOT NULL,
    secret_hash                     TEXT,
    redirect_uris                   TEXT         NOT NULL,
    client_type                     VARCHAR(16)  NOT NULL,
    registration_kind               VARCHAR(8)   NOT NULL,
    owner_user_id                   VARCHAR(36)  REFERENCES users(id) ON DELETE CASCADE,
    registration_access_token_hash  VARCHAR(64),
    created_at                      BIGINT       NOT NULL,
    updated_at                      BIGINT       NOT NULL,
    PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS oauth_clients_owner ON oauth_clients (owner_user_id);

CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
    code_hash             VARCHAR(64)  NOT NULL,
    client_id             VARCHAR(36)  NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
    user_id               VARCHAR(36)  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    redirect_uri          TEXT         NOT NULL,
    scope                 TEXT         NOT NULL,
    code_challenge        TEXT         NOT NULL,
    code_challenge_method VARCHAR(8)   NOT NULL,
    expires_at            BIGINT       NOT NULL,
    consumed_at           BIGINT,
    PRIMARY KEY (code_hash)
);

CREATE TABLE IF NOT EXISTS oauth_access_tokens (
    id           VARCHAR(36)  NOT NULL,
    token_hash   VARCHAR(64)  NOT NULL UNIQUE,
    client_id    VARCHAR(36)  NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
    user_id      VARCHAR(36)  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scope        TEXT         NOT NULL,
    kind         VARCHAR(8)   NOT NULL,
    name         TEXT         NOT NULL DEFAULT '',
    created_at   BIGINT       NOT NULL,
    last_used_at BIGINT,
    revoked_at   BIGINT,
    PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS oauth_access_tokens_user ON oauth_access_tokens (user_id);
CREATE INDEX IF NOT EXISTS oauth_access_tokens_client ON oauth_access_tokens (client_id);

CREATE TABLE IF NOT EXISTS pending_edits (
    id          VARCHAR(36) PRIMARY KEY,
    payload     TEXT NOT NULL,
    created_at  BIGINT NOT NULL
);
