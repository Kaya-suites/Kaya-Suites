// Copyright 2024 Kaya Suites. Licensed under the Apache License, Version 2.0.
//!
//! Universal database migrations for Kaya Suites.
//!
//! Provides `run_migrations(pool, dialect)` that creates all tables for
//! Postgres, SQLite, and MySQL using `AnyPool` and portable `?` placeholders.

use anyhow::Context as _;
use sqlx::AnyPool;
use sqlx::migrate::Migrator;

/// Canonical schemas applied via `sqlx::Migrator` at startup. Files live in
/// `crates/kaya-db/migrations/{dialect}/` and are versioned/idempotent
/// (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`).
///
/// First sqlx run against an existing database records all migrations as
/// applied; every DDL statement becomes a no-op against tables that already
/// match. Future schema changes land as new numbered files per dialect.
pub static POSTGRES_MIGRATOR: Migrator = sqlx::migrate!("./migrations/postgres");
pub static SQLITE_MIGRATOR: Migrator = sqlx::migrate!("./migrations/sqlite");
pub static MYSQL_MIGRATOR: Migrator = sqlx::migrate!("./migrations/mysql");

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
    // SQLite's pre-multi-user databases lack the `user_id` columns that the
    // baseline migration's indexes reference. SQLite has no
    // `ADD COLUMN IF NOT EXISTS`, so we can't express the upgrade as pure SQL
    // inside the .sql file. Do the legacy-schema upgrade here, ignoring
    // "duplicate column" errors (which mean the column was already added on a
    // previous run or in a fresh-DB scenario).
    if dialect == Dialect::Sqlite {
        prepare_sqlite_legacy(pool).await?;
    }

    let migrator = match dialect {
        Dialect::Postgres => &POSTGRES_MIGRATOR,
        Dialect::Sqlite => &SQLITE_MIGRATOR,
        Dialect::Mysql => &MYSQL_MIGRATOR,
    };
    migrator
        .run(pool)
        .await
        .with_context(|| format!("{dialect:?} migrations failed"))?;
    tracing::info!(?dialect, "migrations applied");
    Ok(())
}

/// Adds `user_id` columns to any pre-existing SQLite tables that pre-date
/// multi-user. Each `ALTER TABLE` is best-effort — a `duplicate column`
/// failure means the column was already added and we move on.
///
/// Rows added before multi-user are attributed to the sentinel "local" user
/// (`00000000-0000-0000-0000-000000000001`), preserving the data.
async fn prepare_sqlite_legacy(pool: &AnyPool) -> anyhow::Result<()> {
    const SENTINEL: &str = "00000000-0000-0000-0000-000000000001";
    const TABLES: &[&str] = &[
        "documents",
        "folders",
        "chunks",
        "chunk_embeddings",
        "chat_sessions",
        "chat_messages",
        "embedding_calls",
        "document_embedding_status",
        "ui_preferences",
    ];

    for table in TABLES {
        // Skip tables that don't exist yet — fresh DBs hit this path too, and
        // ALTER TABLE on a non-existent table is a hard error in SQLite.
        let exists: Option<(String,)> = sqlx::query_as(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .bind(table)
        .fetch_optional(pool)
        .await?;
        if exists.is_none() {
            continue;
        }

        let sql = format!(
            "ALTER TABLE {table} ADD COLUMN user_id TEXT NOT NULL DEFAULT '{SENTINEL}'"
        );
        // Ignore duplicate-column errors (column already present).
        match sqlx::query(&sql).execute(pool).await {
            Ok(_) => tracing::info!(table, "added user_id column to legacy SQLite table"),
            Err(e) => {
                let msg = e.to_string().to_lowercase();
                if msg.contains("duplicate column") || msg.contains("already exists") {
                    // expected on subsequent runs
                } else {
                    return Err(anyhow::Error::from(e)
                        .context(format!("ALTER TABLE {table} ADD COLUMN user_id")));
                }
            }
        }
    }

    Ok(())
}

