// Copyright 2024 Kaya Suites. Licensed under the Apache License, Version 2.0.
//!
//! MySQL-backed tower_sessions `SessionStore` implementation.

use async_trait::async_trait;
use rmp_serde;
use sqlx::{MySqlPool, Row};
use tower_sessions::{
    SessionStore,
    session::{Id, Record},
    session_store,
};

#[derive(Clone, Debug)]
pub struct MysqlSessionStore {
    pool: MySqlPool,
}

impl MysqlSessionStore {
    pub fn new(pool: MySqlPool) -> Self {
        Self { pool }
    }

    pub async fn migrate(&self) -> Result<(), sqlx::Error> {
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS tower_sessions (
                id          VARCHAR(36)  NOT NULL PRIMARY KEY,
                data        LONGBLOB     NOT NULL,
                expiry_date BIGINT       NOT NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

#[async_trait]
impl SessionStore for MysqlSessionStore {
    async fn create(
        &self,
        record: &mut Record,
    ) -> Result<(), session_store::Error> {
        let data = rmp_serde::to_vec(record)
            .map_err(|e| session_store::Error::Encode(e.to_string()))?;
        let expiry = record.expiry_date.unix_timestamp();
        sqlx::query(
            "INSERT INTO tower_sessions (id, data, expiry_date) VALUES (?, ?, ?)",
        )
        .bind(record.id.to_string())
        .bind(&data)
        .bind(expiry)
        .execute(&self.pool)
        .await
        .map_err(|e| session_store::Error::Backend(e.to_string()))?;
        Ok(())
    }

    async fn save(&self, record: &Record) -> Result<(), session_store::Error> {
        let data = rmp_serde::to_vec(record)
            .map_err(|e| session_store::Error::Encode(e.to_string()))?;
        let expiry = record.expiry_date.unix_timestamp();
        sqlx::query(
            "INSERT INTO tower_sessions (id, data, expiry_date) VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE data = VALUES(data), expiry_date = VALUES(expiry_date)",
        )
        .bind(record.id.to_string())
        .bind(&data)
        .bind(expiry)
        .execute(&self.pool)
        .await
        .map_err(|e| session_store::Error::Backend(e.to_string()))?;
        Ok(())
    }

    async fn load(
        &self,
        session_id: &Id,
    ) -> Result<Option<Record>, session_store::Error> {
        let row = sqlx::query("SELECT data FROM tower_sessions WHERE id = ? AND expiry_date > ?")
            .bind(session_id.to_string())
            .bind(chrono::Utc::now().timestamp())
            .fetch_optional(&self.pool)
            .await
            .map_err(|e| session_store::Error::Backend(e.to_string()))?;

        let Some(row) = row else {
            return Ok(None);
        };

        let data: Vec<u8> = row
            .try_get("data")
            .map_err(|e| session_store::Error::Backend(e.to_string()))?;

        let record = rmp_serde::from_slice(&data)
            .map_err(|e| session_store::Error::Decode(e.to_string()))?;

        Ok(Some(record))
    }

    async fn delete(&self, session_id: &Id) -> Result<(), session_store::Error> {
        sqlx::query("DELETE FROM tower_sessions WHERE id = ?")
            .bind(session_id.to_string())
            .execute(&self.pool)
            .await
            .map_err(|e| session_store::Error::Backend(e.to_string()))?;
        Ok(())
    }
}
