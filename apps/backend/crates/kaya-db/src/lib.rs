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
            Ok(Self::Sqlite)
        }
    }
}

pub async fn run_migrations(pool: &AnyPool, dialect: Dialect) -> anyhow::Result<()> {
    match dialect {
        Dialect::Postgres => run_postgres(pool).await,
        Dialect::Sqlite   => run_sqlite(pool).await,
        Dialect::Mysql    => run_mysql(pool).await,
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
    exec(pool, "
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
    ").await?;

    // documents
    exec(pool, "
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
    ").await?;
    exec(pool, "CREATE INDEX IF NOT EXISTS documents_user_active ON documents (user_id, updated_at DESC) WHERE deleted_at IS NULL").await?;

    // document_versions
    exec(pool, "
        CREATE TABLE IF NOT EXISTS document_versions (
            id           VARCHAR(36)  NOT NULL,
            document_id  VARCHAR(36)  NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
            user_id      VARCHAR(36)  NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
            body_snapshot TEXT        NOT NULL,
            content_hash  TEXT        NOT NULL,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (id)
        )
    ").await?;

    // chunks — TSVECTOR generated column for BM25
    exec(pool, "
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
    ").await?;
    exec(pool, "CREATE INDEX IF NOT EXISTS chunks_tsv ON chunks USING GIN (tsv)").await?;

    // chunk_embeddings — pgvector HNSW index
    exec(pool, "
        CREATE TABLE IF NOT EXISTS chunk_embeddings (
            user_id      VARCHAR(36)  NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
            document_id  VARCHAR(36)  NOT NULL REFERENCES documents(id)  ON DELETE CASCADE,
            paragraph_id TEXT         NOT NULL,
            vector       VECTOR(1536) NOT NULL,
            PRIMARY KEY (user_id, document_id, paragraph_id)
        )
    ").await?;
    exec(pool, "CREATE INDEX IF NOT EXISTS chunk_embeddings_hnsw ON chunk_embeddings USING hnsw (vector vector_cosine_ops)").await?;

    // chat_sessions
    exec(pool, "
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
    ").await?;
    exec(pool, "CREATE INDEX IF NOT EXISTS chat_sessions_user ON chat_sessions (user_id, updated_at DESC)").await?;

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
            created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
            PRIMARY KEY (id)
        )
    ").await?;
    exec(pool, "CREATE INDEX IF NOT EXISTS chat_messages_session ON chat_messages (session_id, user_id, created_at ASC)").await?;

    // tool_invocations
    exec(pool, "
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
    ").await?;

    // usage_counters
    exec(pool, "
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
    ").await?;

    // usage_events
    exec(pool, "
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
    ").await?;
    exec(pool, "CREATE INDEX IF NOT EXISTS usage_events_user_period ON usage_events (user_id, recorded_at DESC)").await?;
    exec(pool, "CREATE INDEX IF NOT EXISTS usage_events_daily ON usage_events (recorded_at DESC)").await?;

    // rate_limit_windows
    exec(pool, "
        CREATE TABLE IF NOT EXISTS rate_limit_windows (
            user_id      VARCHAR(36)  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            window_type  TEXT         NOT NULL CHECK (window_type IN ('hourly','daily')),
            window_start TIMESTAMPTZ  NOT NULL,
            tokens_used  BIGINT       NOT NULL DEFAULT 0,
            PRIMARY KEY (user_id, window_type, window_start)
        )
    ").await?;

    // system_flags
    exec(pool, "
        CREATE TABLE IF NOT EXISTS system_flags (
            key        TEXT        NOT NULL,
            value      TEXT        NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (key)
        )
    ").await?;

    // subscriptions
    exec(pool, "
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
    ").await?;

    tracing::info!("Postgres migrations applied");
    Ok(())
}

async fn run_sqlite(pool: &AnyPool) -> anyhow::Result<()> {
    exec(pool, "
        CREATE TABLE IF NOT EXISTS users (
            id            TEXT    NOT NULL PRIMARY KEY,
            email         TEXT    NOT NULL UNIQUE,
            username      TEXT    UNIQUE,
            password_hash TEXT,
            is_superadmin INTEGER NOT NULL DEFAULT 0,
            created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
            updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        )
    ").await?;

    exec(pool, "
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
    ").await?;
    exec(pool, "CREATE INDEX IF NOT EXISTS usage_events_user_period ON usage_events (user_id, recorded_at DESC)").await?;
    exec(pool, "CREATE INDEX IF NOT EXISTS usage_events_daily ON usage_events (recorded_at DESC)").await?;

    exec(pool, "
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
    ").await?;

    exec(pool, "
        CREATE TABLE IF NOT EXISTS rate_limit_windows (
            user_id      TEXT    NOT NULL,
            window_type  TEXT    NOT NULL,
            window_start TEXT    NOT NULL,
            tokens_used  INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (user_id, window_type, window_start)
        )
    ").await?;

    exec(pool, "
        CREATE TABLE IF NOT EXISTS system_flags (
            key        TEXT NOT NULL PRIMARY KEY,
            value      TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        )
    ").await?;

    exec(pool, "
        CREATE TABLE IF NOT EXISTS subscriptions (
            id                 TEXT    NOT NULL PRIMARY KEY,
            user_id            TEXT    NOT NULL UNIQUE,
            status             TEXT    NOT NULL DEFAULT 'trialing',
            current_period_end TEXT,
            created_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
            updated_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        )
    ").await?;

    tracing::info!("SQLite migrations applied");
    Ok(())
}

async fn run_mysql(pool: &AnyPool) -> anyhow::Result<()> {
    exec(pool, "
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
    ").await?;

    exec(pool, "
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
    ").await?;

    exec(pool, "
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
    ").await?;

    exec(pool, "
        CREATE TABLE IF NOT EXISTS rate_limit_windows (
            user_id      VARCHAR(36) NOT NULL,
            window_type  VARCHAR(16) NOT NULL,
            window_start DATETIME(6) NOT NULL,
            tokens_used  BIGINT      NOT NULL DEFAULT 0,
            PRIMARY KEY (user_id, window_type, window_start)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ").await?;

    exec(pool, "
        CREATE TABLE IF NOT EXISTS system_flags (
            `key`      VARCHAR(128) NOT NULL PRIMARY KEY,
            value      TEXT         NOT NULL,
            updated_at DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ").await?;

    exec(pool, "
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
    ").await?;

    tracing::info!("MySQL migrations applied");
    Ok(())
}
