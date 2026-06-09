// Copyright 2024 Kaya Suites. Licensed under the Apache License, Version 2.0.
//! Shared per-user adapter construction.
//!
//! Both the `kaya-oss` HTTP server and the `kaya-mcp` stdio binary need to
//! turn `(dialect-specific pool, user_id)` into
//! `(Arc<dyn StorageAdapter>, Arc<dyn SessionStorage>)`. The dispatch lives
//! here so every entry point picks up new backends automatically.

use std::sync::Arc;

use kaya_core::{SessionStorage, StorageAdapter, StorageError, UserContext};
use sqlx::{MySqlPool, SqlitePool};

#[cfg(feature = "postgres")]
use sqlx::PgPool;

use crate::{
    MySqlAdapter, MySqlSessionStorage, SqliteAdapter, SqliteSessionStorage,
};

#[cfg(feature = "postgres")]
use crate::{PostgresAdapter, PostgresSessionStorage};

/// Which underlying DB pool is backing this instance.
///
/// Constructed once at startup and cloned into each handler that needs to
/// build a per-user storage layer.
#[derive(Clone)]
pub enum DbBackend {
    #[cfg(feature = "postgres")]
    Postgres(PgPool),
    Sqlite(SqlitePool),
    Mysql(MySqlPool),
}

/// Build the per-user `StorageAdapter` + `SessionStorage` pair.
pub async fn build_user_adapters(
    backend: &DbBackend,
    user_ctx: UserContext,
) -> Result<(Arc<dyn StorageAdapter>, Arc<dyn SessionStorage>), StorageError> {
    match backend {
        #[cfg(feature = "postgres")]
        DbBackend::Postgres(pg) => Ok((
            Arc::new(PostgresAdapter::new(pg.clone(), user_ctx.clone())),
            Arc::new(PostgresSessionStorage::new(pg.clone(), user_ctx.user_id)),
        )),
        DbBackend::Sqlite(sqlite) => {
            let adapter = SqliteAdapter::from_pool(sqlite.clone(), user_ctx.clone());
            let sess = SqliteSessionStorage::new(sqlite.clone(), user_ctx.user_id);
            Ok((Arc::new(adapter), Arc::new(sess)))
        }
        DbBackend::Mysql(mysql) => Ok((
            Arc::new(MySqlAdapter::new(mysql.clone(), user_ctx.clone())),
            Arc::new(MySqlSessionStorage::new(mysql.clone(), user_ctx.user_id)),
        )),
    }
}
