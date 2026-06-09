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

