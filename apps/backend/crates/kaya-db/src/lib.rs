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

    // ── PRIMARY KEY rebuild for tables whose PK changed shape ────────────────
    //
    // Adding `user_id` via ALTER TABLE doesn't update the PRIMARY KEY, so
    // `ON CONFLICT(user_id, …)` upserts fail on these tables. Rebuild them
    // when the PK still matches the legacy shape.

    rebuild_if_pk_legacy(
        pool,
        "ui_preferences",
        &["user_id", "key"],
        "CREATE TABLE ui_preferences_new (
            user_id    TEXT    NOT NULL,
            key        TEXT    NOT NULL,
            value      TEXT    NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (user_id, key)
        )",
        "INSERT INTO ui_preferences_new (user_id, key, value, updated_at)
            SELECT user_id, key, value, updated_at FROM ui_preferences",
    )
    .await?;

    rebuild_if_pk_legacy(
        pool,
        "document_embedding_status",
        &["user_id", "document_id"],
        "CREATE TABLE document_embedding_status_new (
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
        )",
        "INSERT INTO document_embedding_status_new
            (user_id, document_id, task_id, status, expected_chunks,
             embedded_chunks, last_error, updated_at, last_indexed_at)
            SELECT user_id, document_id, task_id, status, expected_chunks,
                   embedded_chunks, last_error, updated_at, last_indexed_at
            FROM document_embedding_status",
    )
    .await?;

    rebuild_if_pk_legacy(
        pool,
        "chunks",
        &["user_id", "document_id", "paragraph_id"],
        "CREATE TABLE chunks_new (
            user_id      TEXT    NOT NULL,
            document_id  TEXT    NOT NULL,
            paragraph_id TEXT    NOT NULL,
            ordinal      INTEGER NOT NULL,
            content      TEXT    NOT NULL,
            content_hash TEXT    NOT NULL,
            PRIMARY KEY (user_id, document_id, paragraph_id)
        )",
        "INSERT INTO chunks_new (user_id, document_id, paragraph_id, ordinal, content, content_hash)
            SELECT user_id, document_id, paragraph_id, ordinal, content, content_hash
            FROM chunks",
    )
    .await?;

    rebuild_if_pk_legacy(
        pool,
        "chunk_embeddings",
        &["user_id", "document_id", "paragraph_id"],
        "CREATE TABLE chunk_embeddings_new (
            user_id      TEXT NOT NULL,
            document_id  TEXT NOT NULL,
            paragraph_id TEXT NOT NULL,
            vector       BLOB NOT NULL,
            PRIMARY KEY (user_id, document_id, paragraph_id)
        )",
        "INSERT INTO chunk_embeddings_new (user_id, document_id, paragraph_id, vector)
            SELECT user_id, document_id, paragraph_id, vector FROM chunk_embeddings",
    )
    .await?;

    Ok(())
}

/// Read the column names that make up the PRIMARY KEY of `table`, in PK order.
async fn primary_key_columns(
    pool: &AnyPool,
    table: &str,
) -> anyhow::Result<Vec<String>> {
    // pragma_table_info: pk = 0 for non-key cols, 1..N for the position within
    // a composite PK. Order by pk to recover the declared key order.
    let rows: Vec<(String, i64)> = sqlx::query_as(&format!(
        "SELECT name, pk FROM pragma_table_info('{table}') WHERE pk > 0 ORDER BY pk"
    ))
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|(name, _)| name).collect())
}

/// If `table` exists and its PRIMARY KEY does not match `expected_pk`, rebuild
/// it via the standard SQLite recipe (create staging, copy, drop, rename).
/// No-op when the table already has the right PK, or when the table doesn't
/// exist yet.
///
/// Defensive against partial prior runs: drops any leftover `*_new` staging
/// table at the start, and wraps the rebuild in a transaction so a mid-way
/// failure leaves the original table intact.
async fn rebuild_if_pk_legacy(
    pool: &AnyPool,
    table: &str,
    expected_pk: &[&str],
    create_new: &str,
    insert_copy: &str,
) -> anyhow::Result<()> {
    let exists: Option<(String,)> = sqlx::query_as(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    )
    .bind(table)
    .fetch_optional(pool)
    .await?;
    if exists.is_none() {
        return Ok(());
    }

    let current_pk = primary_key_columns(pool, table).await?;
    let current_pk_refs: Vec<&str> = current_pk.iter().map(|s| s.as_str()).collect();
    if current_pk_refs == expected_pk {
        return Ok(());
    }

    let staging = format!("{table}_new");

    // Defensive cleanup: any leftover staging table or stray index/view that
    // happens to share the target name (from a crashed previous attempt).
    // Each statement is best-effort because most will be no-ops.
    let _ = sqlx::query(&format!("DROP TABLE IF EXISTS {staging}"))
        .execute(pool).await;
    let _ = sqlx::query(&format!("DROP INDEX IF EXISTS {table}"))
        .execute(pool).await;
    let _ = sqlx::query(&format!("DROP VIEW IF EXISTS {table}"))
        .execute(pool).await;

    tracing::info!(
        table,
        current_pk = ?current_pk,
        expected_pk = ?expected_pk,
        "rebuilding SQLite table with new PRIMARY KEY",
    );

    let mut tx = pool.begin().await?;
    sqlx::query(create_new)
        .execute(&mut *tx)
        .await
        .with_context(|| format!("rebuilding {table}: CREATE staging"))?;
    sqlx::query(insert_copy)
        .execute(&mut *tx)
        .await
        .with_context(|| format!("rebuilding {table}: INSERT copy"))?;
    sqlx::query(&format!("DROP TABLE {table}"))
        .execute(&mut *tx)
        .await
        .with_context(|| format!("rebuilding {table}: DROP original"))?;
    sqlx::query(&format!("ALTER TABLE {staging} RENAME TO {table}"))
        .execute(&mut *tx)
        .await
        .with_context(|| format!("rebuilding {table}: RENAME staging"))?;
    tx.commit().await.with_context(|| format!("rebuilding {table}: COMMIT"))?;
    Ok(())
}

