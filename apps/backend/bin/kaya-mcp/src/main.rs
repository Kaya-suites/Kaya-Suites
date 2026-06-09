// Copyright 2024 Kaya Suites. Licensed under the Apache License, Version 2.0.
//! kaya-mcp — stdio MCP server exposing the Kaya knowledge base.
//!
//! Required env:
//!   KAYA_API_TOKEN — OAuth-issued access token. Mint one in the Kaya UI under
//!                    Settings → Personal access tokens (MCP).
//!   DATABASE_URL   — connection string. Postgres / SQLite / MySQL all work;
//!                    the dialect is detected from the URL scheme.
//! Optional env:
//!   KAYA_CONFIG    — path to kaya.yaml (default `kaya.yaml`); search tools
//!                    require a working ModelRouter.

use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{Context as _, Result};
use kaya_core::{UserContext, auth::UserSession, model_router::ModelRouter};
use kaya_db::Dialect;
use kaya_mcp::KayaService;
use kaya_oauth::tokens as oauth_tokens;
use kaya_storage::{
    DbBackend, MySqlAdapter, MySqlSessionStorage, SqliteAdapter, SqliteSessionStorage,
    build_user_adapters,
};
use sqlx::AnyPool;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::{MySqlPool, PgPool};

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .init();
    dotenvy::dotenv().ok();

    let token = std::env::var("KAYA_API_TOKEN").context("KAYA_API_TOKEN is required")?;
    let database_url = std::env::var("DATABASE_URL").context("DATABASE_URL is required")?;
    let config_path = std::env::var("KAYA_CONFIG")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("kaya.yaml"));

    sqlx::any::install_default_drivers();
    let dialect = Dialect::from_url(&database_url)?;

    // Run universal migrations (idempotent — creates the oauth_* tables).
    let any_pool = AnyPool::connect(&database_url)
        .await
        .context("connect to database")?;
    kaya_db::run_migrations(&any_pool, dialect)
        .await
        .context("run migrations")?;

    // Resolve token → user.
    let access = oauth_tokens::resolve(&any_pool, &token)
        .await
        .context("resolve mcp token")?;
    tracing::info!(user_id = %access.user_id, dialect = ?dialect, "authenticated");

    // Build the dialect-specific backend and run any per-backend migrations.
    let db_backend = match dialect {
        Dialect::Sqlite => {
            let db_file = database_url
                .strip_prefix("sqlite://")
                .or_else(|| database_url.strip_prefix("sqlite:"))
                .unwrap_or(&database_url);
            let opts = SqliteConnectOptions::new()
                .filename(db_file)
                .create_if_missing(true)
                .journal_mode(SqliteJournalMode::Wal);
            let sqlite = SqlitePoolOptions::new().connect_with(opts).await?;
            // Per-adapter migrations folded into the unified kaya_db baseline
            // applied above.
            DbBackend::Sqlite(sqlite)
        }
        Dialect::Postgres => {
            let pg = PgPool::connect(&database_url).await?;
            DbBackend::Postgres(pg)
        }
        Dialect::Mysql => {
            let mysql = MySqlPool::connect(&database_url).await?;
            DbBackend::Mysql(mysql)
        }
    };

    let user_ctx = UserContext {
        user_id: access.user_id,
        tenant_id: access.user_id,
    };
    let (storage, sessions) = build_user_adapters(&db_backend, user_ctx)
        .await
        .context("build user adapters")?;

    // ModelRouter — required for search tools.
    let router = Arc::new(
        ModelRouter::from_yaml(&config_path)
            .with_context(|| format!("load model router from {}", config_path.display()))?,
    );

    let session = UserSession { user_id: access.user_id };
    let service = KayaService::new(storage, sessions, router, session);

    tracing::info!("kaya-mcp ready; serving stdio");
    let (stdin, stdout) = rmcp::transport::stdio();
    let running = rmcp::service::serve_server(service, (stdin, stdout))
        .await
        .context("serve_server")?;
    running.waiting().await.context("server loop")?;
    Ok(())
}
