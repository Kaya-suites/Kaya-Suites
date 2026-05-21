// Copyright 2024 Kaya Suites. Licensed under the Apache License, Version 2.0.
//!
//! Session store abstraction that dispatches to Postgres, SQLite, or MySQL.

use async_trait::async_trait;
use tower_sessions::{
    SessionStore,
    session::{Id, Record},
    session_store,
};
use tower_sessions_sqlx_store::{MySqlStore, PostgresStore, SqliteStore};

/// Enum that dispatches `SessionStore` methods to the appropriate backend.
#[derive(Clone, Debug)]
pub enum AnySessionStore {
    Postgres(PostgresStore),
    Sqlite(SqliteStore),
    Mysql(MySqlStore),
}

#[async_trait]
impl SessionStore for AnySessionStore {
    async fn create(&self, record: &mut Record) -> Result<(), session_store::Error> {
        match self {
            Self::Postgres(s) => s.create(record).await,
            Self::Sqlite(s)   => s.create(record).await,
            Self::Mysql(s)    => s.create(record).await,
        }
    }

    async fn save(&self, record: &Record) -> Result<(), session_store::Error> {
        match self {
            Self::Postgres(s) => s.save(record).await,
            Self::Sqlite(s)   => s.save(record).await,
            Self::Mysql(s)    => s.save(record).await,
        }
    }

    async fn load(&self, session_id: &Id) -> Result<Option<Record>, session_store::Error> {
        match self {
            Self::Postgres(s) => s.load(session_id).await,
            Self::Sqlite(s)   => s.load(session_id).await,
            Self::Mysql(s)    => s.load(session_id).await,
        }
    }

    async fn delete(&self, session_id: &Id) -> Result<(), session_store::Error> {
        match self {
            Self::Postgres(s) => s.delete(session_id).await,
            Self::Sqlite(s)   => s.delete(session_id).await,
            Self::Mysql(s)    => s.delete(session_id).await,
        }
    }
}
