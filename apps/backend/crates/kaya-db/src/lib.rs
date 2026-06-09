// Copyright 2024 Kaya Suites. Licensed under the Apache License, Version 2.0.
//!
//! Universal database migrations for Kaya Suites.
//!
//! Provides `run_migrations(pool, dialect)` that creates all tables for
//! Postgres, SQLite, and MySQL using `AnyPool` and portable `?` placeholders.

use anyhow::Context as _;
use sqlx::AnyPool;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Dialect {
    Postgres,
    Sqlite,
    Mysql,
}

impl Dialect {
    /// Detect dialect from a connection URL prefix.
    pub fn from_url(url: &str) -> anyhow::Result<Self> {
        if url.starts_with("postgres://") || url.starts_with("postgresql://") {
            Ok(Self::Postgres)
        } else if url.starts_with("sqlite:") || url.starts_with("sqlite://") {
            Ok(Self::Sqlite)
        } else if url.starts_with("mysql://") || url.starts_with("mariadb://") {
            Ok(Self::Mysql)
        } else {
            // plain path → treat as sqlite file
            println!("Unknown URL: {url}");
            println!("GOING WITH DEFAULT SQLITE DATABASE");
            Ok(Self::Sqlite)
        }
    }
}

pub async fn run_migrations(pool: &AnyPool, dialect: Dialect) -> anyhow::Result<()> {
    match dialect {
        Dialect::Postgres => run_postgres(pool).await,
        Dialect::Sqlite => run_sqlite(pool).await,
        Dialect::Mysql => run_mysql(pool).await,
    }
}

async fn exec(pool: &AnyPool, sql: &str) -> anyhow::Result<()> {
    sqlx::query(sql)
        .execute(pool)
        .await
        .with_context(|| format!("migration failed: {sql}"))?;
    Ok(())
}

async fn run_postgres(pool: &AnyPool) -> anyhow::Result<()> {
    // Enable pgvector
    exec(pool, "CREATE EXTENSION IF NOT EXISTS vector").await?;

    // users — VARCHAR(36) for id so AnyPool string bindings work uniformly
    exec(
        pool,
        "
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
        )
    ",
    )
    .await?;

    // documents
    exec(
        pool,
        "
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
            created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
            updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
            deleted_at    TIMESTAMPTZ,
            PRIMARY KEY (id)
        )
    ",
    )
    .await?;
    exec(pool, "CREATE INDEX IF NOT EXISTS documents_user_active ON documents (user_id, updated_at DESC) WHERE deleted_at IS NULL").await?;

    // folders — referenced by documents.folder_id below
    exec(
        pool,
        "
        CREATE TABLE IF NOT EXISTS folders (
            id          VARCHAR(36)  NOT NULL,
            user_id     VARCHAR(36)  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name        TEXT         NOT NULL,
            parent_id   VARCHAR(36)  REFERENCES folders(id) ON DELETE CASCADE,
            sort_order  INTEGER      NOT NULL DEFAULT 0,
            created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
            updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
            PRIMARY KEY (id)
        )
    ",
    )
    .await?;
    exec(pool, "CREATE INDEX IF NOT EXISTS folders_user ON folders (user_id, parent_id, sort_order)").await?;

    // Backfill columns added after the initial documents schema shipped.
    exec(pool, "ALTER TABLE documents ADD COLUMN IF NOT EXISTS folder_id VARCHAR(36) REFERENCES folders(id) ON DELETE SET NULL").await?;
    exec(pool, "ALTER TABLE documents ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0").await?;
    exec(pool, "CREATE INDEX IF NOT EXISTS documents_user_folder_order ON documents (user_id, folder_id, sort_order)").await?;

    // document_versions
    exec(
        pool,
        "
        CREATE TABLE IF NOT EXISTS document_versions (
            id           VARCHAR(36)  NOT NULL,
            document_id  VARCHAR(36)  NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
            user_id      VARCHAR(36)  NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
            body_snapshot TEXT        NOT NULL,
            content_hash  TEXT        NOT NULL,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (id)
        )
    ",
    )
    .await?;

    // chunks — TSVECTOR generated column for BM25
    exec(
        pool,
        "
        CREATE TABLE IF NOT EXISTS chunks (
            user_id      VARCHAR(36)  NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
            document_id  VARCHAR(36)  NOT NULL REFERENCES documents(id)  ON DELETE CASCADE,
            paragraph_id TEXT         NOT NULL,
            ordinal      INTEGER      NOT NULL,
            content      TEXT         NOT NULL,
            content_hash TEXT         NOT NULL,
            tsv          TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
            PRIMARY KEY (user_id, document_id, paragraph_id)
        )
    ",
    )
    .await?;
    exec(
        pool,
        "CREATE INDEX IF NOT EXISTS chunks_tsv ON chunks USING GIN (tsv)",
    )
    .await?;

    // chunk_embeddings — pgvector HNSW index
    exec(
        pool,
        "
        CREATE TABLE IF NOT EXISTS chunk_embeddings (
            user_id      VARCHAR(36)  NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
            document_id  VARCHAR(36)  NOT NULL REFERENCES documents(id)  ON DELETE CASCADE,
            paragraph_id TEXT         NOT NULL,
            vector       VECTOR(1536) NOT NULL,
            PRIMARY KEY (user_id, document_id, paragraph_id)
        )
    ",
    )
    .await?;
    exec(pool, "CREATE INDEX IF NOT EXISTS chunk_embeddings_hnsw ON chunk_embeddings USING hnsw (vector vector_cosine_ops)").await?;

    // chat_sessions
    exec(
        pool,
        "
        CREATE TABLE IF NOT EXISTS chat_sessions (
            id                  VARCHAR(36)  NOT NULL,
            user_id             VARCHAR(36)  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            title               TEXT,
            total_input_tokens  INTEGER      NOT NULL DEFAULT 0,
            total_output_tokens INTEGER      NOT NULL DEFAULT 0,
            created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
            updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
            PRIMARY KEY (id)
        )
    ",
    )
    .await?;
    exec(
        pool,
        "CREATE INDEX IF NOT EXISTS chat_sessions_user ON chat_sessions (user_id, updated_at DESC)",
    )
    .await?;
    exec(
        pool,
        "ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE",
    )
    .await?;

    // chat_messages
    exec(pool, "
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
        )
    ").await?;
    exec(pool, "ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS proposals JSONB NOT NULL DEFAULT '[]'").await?;
    exec(pool, "CREATE INDEX IF NOT EXISTS chat_messages_session ON chat_messages (session_id, user_id, created_at ASC)").await?;

    exec(pool, "
        CREATE TABLE IF NOT EXISTS user_ui_preferences (
            user_id          VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            preference_key   TEXT        NOT NULL,
            preference_value JSONB       NOT NULL,
            updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (user_id, preference_key)
        )
    ").await?;

    // tool_invocations
    exec(
        pool,
        "
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
        )
    ",
    )
    .await?;

    // usage_counters
    exec(
        pool,
        "
        CREATE TABLE IF NOT EXISTS usage_counters (
            id                 VARCHAR(36) NOT NULL,
            user_id            VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            period_start       DATE        NOT NULL,
            tokens_in          BIGINT      NOT NULL DEFAULT 0,
            tokens_out         BIGINT      NOT NULL DEFAULT 0,
            embed_calls        BIGINT      NOT NULL DEFAULT 0,
            agent_invocations  BIGINT      NOT NULL DEFAULT 0,
            PRIMARY KEY (id),
            UNIQUE (user_id, period_start)
        )
    ",
    )
    .await?;

    // usage_events
    exec(
        pool,
        "
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
        )
    ",
    )
    .await?;
    exec(pool, "CREATE INDEX IF NOT EXISTS usage_events_user_period ON usage_events (user_id, recorded_at DESC)").await?;
    exec(
        pool,
        "CREATE INDEX IF NOT EXISTS usage_events_daily ON usage_events (recorded_at DESC)",
    )
    .await?;

    // rate_limit_windows
    exec(
        pool,
        "
        CREATE TABLE IF NOT EXISTS rate_limit_windows (
            user_id      VARCHAR(36)  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            window_type  TEXT         NOT NULL CHECK (window_type IN ('hourly','daily')),
            window_start TIMESTAMPTZ  NOT NULL,
            tokens_used  BIGINT       NOT NULL DEFAULT 0,
            PRIMARY KEY (user_id, window_type, window_start)
        )
    ",
    )
    .await?;

    // system_flags
    exec(
        pool,
        "
        CREATE TABLE IF NOT EXISTS system_flags (
            key        TEXT        NOT NULL,
            value      TEXT        NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (key)
        )
    ",
    )
    .await?;

    // subscriptions
    exec(
        pool,
        "
        CREATE TABLE IF NOT EXISTS subscriptions (
            id                 VARCHAR(36)  NOT NULL,
            user_id            VARCHAR(36)  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            status             TEXT         NOT NULL DEFAULT 'trialing',
            current_period_end TIMESTAMPTZ,
            created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
            updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
            PRIMARY KEY (id),
            UNIQUE (user_id)
        )
    ",
    )
    .await?;

    // embedding_calls
    exec(
        pool,
        "
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
        )
    ",
    )
    .await?;
    exec(pool, "CREATE INDEX IF NOT EXISTS embedding_calls_user ON embedding_calls (user_id, created_at DESC)").await?;
    for stmt in [
        "ALTER TABLE embedding_calls ADD COLUMN IF NOT EXISTS task_id TEXT",
        "ALTER TABLE embedding_calls ADD COLUMN IF NOT EXISTS task_type TEXT NOT NULL DEFAULT 'unknown'",
        "ALTER TABLE embedding_calls ADD COLUMN IF NOT EXISTS session_id VARCHAR(36)",
        "ALTER TABLE embedding_calls ADD COLUMN IF NOT EXISTS document_id VARCHAR(36)",
        "ALTER TABLE embedding_calls ADD COLUMN IF NOT EXISTS paragraph_id TEXT",
    ] {
        exec(pool, stmt).await?;
    }
    exec(
        pool,
        "
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
        )
    ",
    )
    .await?;

    // oauth_clients — both DCR-issued and admin-registered clients.
    // Note: a former `mcp_tokens` table is migrated and dropped at the end of
    // this dialect block (see `rollover_mcp_tokens_postgres`).
    exec(
        pool,
        "
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
        )
    ",
    )
    .await?;
    exec(pool, "CREATE INDEX IF NOT EXISTS oauth_clients_owner ON oauth_clients (owner_user_id)").await?;

    // oauth_authorization_codes — short-lived, single-use.
    exec(
        pool,
        "
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
        )
    ",
    )
    .await?;

    // oauth_access_tokens — replaces mcp_tokens. Long-lived; revoked_at NULL = active.
    exec(
        pool,
        "
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
        )
    ",
    )
    .await?;
    exec(pool, "CREATE INDEX IF NOT EXISTS oauth_access_tokens_user ON oauth_access_tokens (user_id)").await?;
    exec(pool, "CREATE INDEX IF NOT EXISTS oauth_access_tokens_client ON oauth_access_tokens (client_id)").await?;

    rollover_mcp_tokens_postgres(pool).await?;

    exec(
        pool,
        "
        CREATE TABLE IF NOT EXISTS pending_edits (
            id          VARCHAR(36) PRIMARY KEY,
            payload     TEXT NOT NULL,
            created_at  BIGINT NOT NULL
        )
        ",
    )
    .await?;

    tracing::info!("Postgres migrations applied");
    Ok(())
}

async fn run_sqlite(pool: &AnyPool) -> anyhow::Result<()> {
    exec(
        pool,
        "
        CREATE TABLE IF NOT EXISTS users (
            id            TEXT    NOT NULL PRIMARY KEY,
            email         TEXT    NOT NULL UNIQUE,
            username      TEXT    UNIQUE,
            password_hash TEXT,
            is_superadmin INTEGER NOT NULL DEFAULT 0,
            created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
            updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        )
    ",
    )
    .await?;

    exec(
        pool,
        "
        CREATE TABLE IF NOT EXISTS usage_events (
            id            TEXT    NOT NULL PRIMARY KEY,
            user_id       TEXT    NOT NULL,
            operation     TEXT    NOT NULL,
            model         TEXT    NOT NULL,
            input_tokens  INTEGER NOT NULL,
            output_tokens INTEGER NOT NULL,
            cost_usd      REAL    NOT NULL,
            recorded_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        )
    ",
    )
    .await?;
    exec(pool, "CREATE INDEX IF NOT EXISTS usage_events_user_period ON usage_events (user_id, recorded_at DESC)").await?;
    exec(
        pool,
        "CREATE INDEX IF NOT EXISTS usage_events_daily ON usage_events (recorded_at DESC)",
    )
    .await?;

    exec(
        pool,
        "
        CREATE TABLE IF NOT EXISTS usage_counters (
            id                TEXT    NOT NULL PRIMARY KEY,
            user_id           TEXT    NOT NULL,
            period_start      TEXT    NOT NULL,
            tokens_in         INTEGER NOT NULL DEFAULT 0,
            tokens_out        INTEGER NOT NULL DEFAULT 0,
            embed_calls       INTEGER NOT NULL DEFAULT 0,
            agent_invocations INTEGER NOT NULL DEFAULT 0,
            UNIQUE (user_id, period_start)
        )
    ",
    )
    .await?;

    exec(
        pool,
        "
        CREATE TABLE IF NOT EXISTS rate_limit_windows (
            user_id      TEXT    NOT NULL,
            window_type  TEXT    NOT NULL,
            window_start TEXT    NOT NULL,
            tokens_used  INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (user_id, window_type, window_start)
        )
    ",
    )
    .await?;

    exec(
        pool,
        "
        CREATE TABLE IF NOT EXISTS system_flags (
            key        TEXT NOT NULL PRIMARY KEY,
            value      TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        )
    ",
    )
    .await?;

    exec(
        pool,
        "
        CREATE TABLE IF NOT EXISTS subscriptions (
            id                 TEXT    NOT NULL PRIMARY KEY,
            user_id            TEXT    NOT NULL UNIQUE,
            status             TEXT    NOT NULL DEFAULT 'trialing',
            current_period_end TEXT,
            created_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
            updated_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        )
    ",
    )
    .await?;

    exec(
        pool,
        "
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
            created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        )
    ",
    )
    .await?;
    exec(pool, "CREATE INDEX IF NOT EXISTS embedding_calls_user ON embedding_calls (user_id, created_at DESC)").await?;
    for stmt in [
        "ALTER TABLE embedding_calls ADD COLUMN task_id TEXT",
        "ALTER TABLE embedding_calls ADD COLUMN task_type TEXT NOT NULL DEFAULT 'unknown'",
        "ALTER TABLE embedding_calls ADD COLUMN session_id TEXT",
        "ALTER TABLE embedding_calls ADD COLUMN document_id TEXT",
        "ALTER TABLE embedding_calls ADD COLUMN paragraph_id TEXT",
    ] {
        let _ = exec(pool, stmt).await;
    }
    exec(
        pool,
        "
        CREATE TABLE IF NOT EXISTS document_embedding_status (
            user_id         TEXT    NOT NULL,
            document_id     TEXT    NOT NULL,
            task_id         TEXT,
            status          TEXT    NOT NULL DEFAULT 'pending',
            expected_chunks INTEGER NOT NULL DEFAULT 0,
            embedded_chunks INTEGER NOT NULL DEFAULT 0,
            last_error      TEXT,
            updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
            last_indexed_at TEXT,
            PRIMARY KEY (user_id, document_id)
        )
    ",
    )
    .await?;

    // Note: a former `mcp_tokens` table is migrated and dropped at the end of
    // this dialect block (see `rollover_mcp_tokens_sqlite`).
    exec(
        pool,
        "
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
        )
    ",
    )
    .await?;
    exec(pool, "CREATE INDEX IF NOT EXISTS oauth_clients_owner ON oauth_clients (owner_user_id)").await?;

    exec(
        pool,
        "
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
        )
    ",
    )
    .await?;

    exec(
        pool,
        "
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
        )
    ",
    )
    .await?;
    exec(pool, "CREATE INDEX IF NOT EXISTS oauth_access_tokens_user ON oauth_access_tokens (user_id)").await?;
    exec(pool, "CREATE INDEX IF NOT EXISTS oauth_access_tokens_client ON oauth_access_tokens (client_id)").await?;

    rollover_mcp_tokens_sqlite(pool).await?;

    exec(
        pool,
        "
        CREATE TABLE IF NOT EXISTS pending_edits (
            id          TEXT    PRIMARY KEY,
            payload     TEXT    NOT NULL,
            created_at  INTEGER NOT NULL
        )
        ",
    )
    .await?;

    tracing::info!("SQLite migrations applied");
    Ok(())
}

async fn run_mysql(pool: &AnyPool) -> anyhow::Result<()> {
    exec(
        pool,
        "
        CREATE TABLE IF NOT EXISTS users (
            id            VARCHAR(36)  NOT NULL,
            email         TEXT         NOT NULL,
            username      VARCHAR(255) UNIQUE,
            password_hash TEXT,
            is_superadmin TINYINT(1)   NOT NULL DEFAULT 0,
            created_at    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            PRIMARY KEY (id),
            UNIQUE KEY users_email_uk (email(255))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ",
    )
    .await?;

    exec(
        pool,
        "
        CREATE TABLE IF NOT EXISTS usage_events (
            id            VARCHAR(36)    NOT NULL,
            user_id       VARCHAR(36)    NOT NULL,
            operation     VARCHAR(64)    NOT NULL,
            model         VARCHAR(128)   NOT NULL,
            input_tokens  INT            NOT NULL,
            output_tokens INT            NOT NULL,
            cost_usd      DOUBLE         NOT NULL,
            recorded_at   DATETIME(6)    NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            PRIMARY KEY (id),
            KEY usage_events_user_period (user_id, recorded_at DESC),
            KEY usage_events_daily (recorded_at DESC)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ",
    )
    .await?;

    exec(
        pool,
        "
        CREATE TABLE IF NOT EXISTS usage_counters (
            id                VARCHAR(36) NOT NULL,
            user_id           VARCHAR(36) NOT NULL,
            period_start      DATE        NOT NULL,
            tokens_in         BIGINT      NOT NULL DEFAULT 0,
            tokens_out        BIGINT      NOT NULL DEFAULT 0,
            embed_calls       BIGINT      NOT NULL DEFAULT 0,
            agent_invocations BIGINT      NOT NULL DEFAULT 0,
            PRIMARY KEY (id),
            UNIQUE KEY uc_user_period (user_id, period_start)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ",
    )
    .await?;

    exec(
        pool,
        "
        CREATE TABLE IF NOT EXISTS rate_limit_windows (
            user_id      VARCHAR(36) NOT NULL,
            window_type  VARCHAR(16) NOT NULL,
            window_start DATETIME(6) NOT NULL,
            tokens_used  BIGINT      NOT NULL DEFAULT 0,
            PRIMARY KEY (user_id, window_type, window_start)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ",
    )
    .await?;

    exec(
        pool,
        "
        CREATE TABLE IF NOT EXISTS system_flags (
            `key`      VARCHAR(128) NOT NULL PRIMARY KEY,
            value      TEXT         NOT NULL,
            updated_at DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ",
    )
    .await?;

    exec(
        pool,
        "
        CREATE TABLE IF NOT EXISTS subscriptions (
            id                 VARCHAR(36)  NOT NULL,
            user_id            VARCHAR(36)  NOT NULL,
            status             VARCHAR(32)  NOT NULL DEFAULT 'trialing',
            current_period_end DATETIME(6),
            created_at         DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            updated_at         DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            PRIMARY KEY (id),
            UNIQUE KEY subscriptions_user_uk (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ",
    )
    .await?;

    exec(
        pool,
        "
        CREATE TABLE IF NOT EXISTS embedding_calls (
            id           VARCHAR(36)  NOT NULL,
            user_id      VARCHAR(36)  NOT NULL,
            model        VARCHAR(200) NOT NULL,
            tokens       INT          NOT NULL DEFAULT 0,
            task_id      VARCHAR(64),
            task_type    VARCHAR(64)  NOT NULL DEFAULT 'unknown',
            session_id   VARCHAR(36),
            document_id  VARCHAR(36),
            paragraph_id VARCHAR(255),
            created_at   DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            PRIMARY KEY (id),
            KEY embedding_calls_user (user_id, created_at DESC)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ",
    )
    .await?;
    for stmt in [
        "ALTER TABLE embedding_calls ADD COLUMN task_id VARCHAR(64)",
        "ALTER TABLE embedding_calls ADD COLUMN task_type VARCHAR(64) NOT NULL DEFAULT 'unknown'",
        "ALTER TABLE embedding_calls ADD COLUMN session_id VARCHAR(36)",
        "ALTER TABLE embedding_calls ADD COLUMN document_id VARCHAR(36)",
        "ALTER TABLE embedding_calls ADD COLUMN paragraph_id VARCHAR(255)",
    ] {
        let _ = exec(pool, stmt).await;
    }
    exec(
        pool,
        "
        CREATE TABLE IF NOT EXISTS document_embedding_status (
            user_id         VARCHAR(36)  NOT NULL,
            document_id     VARCHAR(36)  NOT NULL,
            task_id         VARCHAR(64),
            status          VARCHAR(32)  NOT NULL DEFAULT 'pending',
            expected_chunks INT          NOT NULL DEFAULT 0,
            embedded_chunks INT          NOT NULL DEFAULT 0,
            last_error      TEXT,
            updated_at      DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            last_indexed_at DATETIME(6),
            PRIMARY KEY (user_id, document_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ",
    )
    .await?;

    // Note: a former `mcp_tokens` table is migrated and dropped at the end of
    // this dialect block (see `rollover_mcp_tokens_mysql`).
    exec(
        pool,
        "
        CREATE TABLE IF NOT EXISTS oauth_clients (
            id                              VARCHAR(36)  NOT NULL,
            name                            TEXT         NOT NULL,
            secret_hash                     TEXT,
            redirect_uris                   TEXT         NOT NULL,
            client_type                     VARCHAR(16)  NOT NULL,
            registration_kind               VARCHAR(8)   NOT NULL,
            owner_user_id                   VARCHAR(36),
            registration_access_token_hash  VARCHAR(64),
            created_at                      BIGINT       NOT NULL,
            updated_at                      BIGINT       NOT NULL,
            PRIMARY KEY (id),
            INDEX oauth_clients_owner (owner_user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ",
    )
    .await?;

    exec(
        pool,
        "
        CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
            code_hash             VARCHAR(64)  NOT NULL,
            client_id             VARCHAR(36)  NOT NULL,
            user_id               VARCHAR(36)  NOT NULL,
            redirect_uri          TEXT         NOT NULL,
            scope                 TEXT         NOT NULL,
            code_challenge        TEXT         NOT NULL,
            code_challenge_method VARCHAR(8)   NOT NULL,
            expires_at            BIGINT       NOT NULL,
            consumed_at           BIGINT,
            PRIMARY KEY (code_hash)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ",
    )
    .await?;

    exec(
        pool,
        "
        CREATE TABLE IF NOT EXISTS oauth_access_tokens (
            id           VARCHAR(36)  NOT NULL,
            token_hash   VARCHAR(64)  NOT NULL UNIQUE,
            client_id    VARCHAR(36)  NOT NULL,
            user_id      VARCHAR(36)  NOT NULL,
            scope        TEXT         NOT NULL,
            kind         VARCHAR(8)   NOT NULL,
            name         TEXT         NOT NULL DEFAULT '',
            created_at   BIGINT       NOT NULL,
            last_used_at BIGINT,
            revoked_at   BIGINT,
            PRIMARY KEY (id),
            INDEX oauth_access_tokens_user (user_id),
            INDEX oauth_access_tokens_client (client_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ",
    )
    .await?;

    rollover_mcp_tokens_mysql(pool).await?;

    exec(
        pool,
        "
        CREATE TABLE IF NOT EXISTS pending_edits (
            id          VARCHAR(36) NOT NULL,
            payload     LONGTEXT    NOT NULL,
            created_at  BIGINT      NOT NULL,
            PRIMARY KEY (id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        ",
    )
    .await?;

    tracing::info!("MySQL migrations applied");
    Ok(())
}

// ── mcp_tokens → oauth_access_tokens rollover ────────────────────────────────
//
// We replaced the standalone bearer-token system with OAuth-issued access
// tokens. Existing mcp_tokens rows are migrated as PATs owned by the synthetic
// PAT client. The PAT client UUID matches `kaya_oauth::clients::PAT_CLIENT_ID`.
//
// The rollover is idempotent — every step is `IF EXISTS` / `INSERT IGNORE` so
// re-running the migrations on an upgraded database is a no-op.

const PAT_CLIENT_ID_STR: &str = "00000000-0000-0000-0000-0000000a7100";

async fn rollover_mcp_tokens_postgres(pool: &AnyPool) -> anyhow::Result<()> {
    // Bail if mcp_tokens was never created (fresh database after upgrade).
    let exists: (bool,) =
        sqlx::query_as("SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'mcp_tokens')")
            .fetch_one(pool)
            .await?;
    if !exists.0 {
        return Ok(());
    }

    seed_pat_client(pool).await?;

    sqlx::query(
        "INSERT INTO oauth_access_tokens \
         (id, token_hash, client_id, user_id, scope, kind, name, created_at, last_used_at) \
         SELECT mt.id, mt.token_hash, ?, mt.user_id, 'mcp', 'pat', mt.name, \
                mt.created_at, mt.last_used_at \
         FROM mcp_tokens mt \
         WHERE NOT EXISTS ( \
             SELECT 1 FROM oauth_access_tokens t WHERE t.token_hash = mt.token_hash \
         )",
    )
    .bind(PAT_CLIENT_ID_STR)
    .execute(pool)
    .await?;

    exec(pool, "DROP TABLE IF EXISTS mcp_tokens").await?;
    Ok(())
}

async fn rollover_mcp_tokens_sqlite(pool: &AnyPool) -> anyhow::Result<()> {
    let exists: Option<(String,)> =
        sqlx::query_as("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'mcp_tokens'")
            .fetch_optional(pool)
            .await?;
    if exists.is_none() {
        return Ok(());
    }

    seed_pat_client(pool).await?;

    sqlx::query(
        "INSERT INTO oauth_access_tokens \
         (id, token_hash, client_id, user_id, scope, kind, name, created_at, last_used_at) \
         SELECT mt.id, mt.token_hash, ?, mt.user_id, 'mcp', 'pat', mt.name, \
                mt.created_at, mt.last_used_at \
         FROM mcp_tokens mt \
         WHERE NOT EXISTS ( \
             SELECT 1 FROM oauth_access_tokens t WHERE t.token_hash = mt.token_hash \
         )",
    )
    .bind(PAT_CLIENT_ID_STR)
    .execute(pool)
    .await?;

    exec(pool, "DROP TABLE IF EXISTS mcp_tokens").await?;
    Ok(())
}

async fn rollover_mcp_tokens_mysql(pool: &AnyPool) -> anyhow::Result<()> {
    let exists: Option<(String,)> = sqlx::query_as(
        "SELECT table_name FROM information_schema.tables \
         WHERE table_name = 'mcp_tokens' AND table_schema = DATABASE()",
    )
    .fetch_optional(pool)
    .await?;
    if exists.is_none() {
        return Ok(());
    }

    seed_pat_client(pool).await?;

    sqlx::query(
        "INSERT INTO oauth_access_tokens \
         (id, token_hash, client_id, user_id, scope, kind, name, created_at, last_used_at) \
         SELECT mt.id, mt.token_hash, ?, mt.user_id, 'mcp', 'pat', mt.name, \
                mt.created_at, mt.last_used_at \
         FROM mcp_tokens mt \
         WHERE NOT EXISTS ( \
             SELECT 1 FROM oauth_access_tokens t WHERE t.token_hash = mt.token_hash \
         )",
    )
    .bind(PAT_CLIENT_ID_STR)
    .execute(pool)
    .await?;

    exec(pool, "DROP TABLE IF EXISTS mcp_tokens").await?;
    Ok(())
}

/// Insert the singleton PAT client row if missing. Idempotent — uses an
/// existence check rather than dialect-specific `ON CONFLICT` so the same code
/// works across postgres / sqlite / mysql.
async fn seed_pat_client(pool: &AnyPool) -> anyhow::Result<()> {
    let exists: Option<(String,)> =
        sqlx::query_as("SELECT id FROM oauth_clients WHERE id = ?")
            .bind(PAT_CLIENT_ID_STR)
            .fetch_optional(pool)
            .await?;
    if exists.is_some() {
        return Ok(());
    }
    let now = chrono::Utc::now().timestamp_millis();
    sqlx::query(
        "INSERT INTO oauth_clients \
         (id, name, secret_hash, redirect_uris, client_type, registration_kind, \
          owner_user_id, registration_access_token_hash, created_at, updated_at) \
         VALUES (?, ?, NULL, ?, ?, ?, NULL, NULL, ?, ?)",
    )
    .bind(PAT_CLIENT_ID_STR)
    .bind("Personal access tokens")
    .bind(r#"["urn:kaya:pat"]"#)
    .bind("public")
    .bind("manual")
    .bind(now)
    .bind(now)
    .execute(pool)
    .await?;
    Ok(())
}
