// Copyright 2024 Kaya Suites. All rights reserved. — BSL 1.1
//! Postgres-backed [`SessionStorage`] implementation.

use async_trait::async_trait;
use kaya_core::session::{MessageRecord, Session, SessionError, SessionStorage};
use sqlx::{PgPool, Row};
use uuid::Uuid;

/// Postgres session storage scoped to a single user.
pub struct PostgresSessionStorage {
    pool: PgPool,
    user_id: Uuid,
}

impl PostgresSessionStorage {
    pub fn new(pool: PgPool, user_id: Uuid) -> Self {
        Self { pool, user_id }
    }
}

fn box_err<E: std::error::Error + Send + Sync + 'static>(e: E) -> SessionError {
    SessionError::Backend(Box::new(e))
}

fn ts_millis(ts: chrono::DateTime<chrono::Utc>) -> i64 {
    ts.timestamp_millis()
}

#[async_trait]
impl SessionStorage for PostgresSessionStorage {
    async fn list_sessions(&self) -> Result<Vec<Session>, SessionError> {
        let rows = sqlx::query(
            "SELECT s.id,
                    COALESCE(s.title, 'Untitled') AS title,
                    s.created_at,
                    s.updated_at,
                    COUNT(m.id)::int4 AS message_count
             FROM chat_sessions s
             LEFT JOIN chat_messages m
               ON m.session_id = s.id AND m.user_id = s.user_id
             WHERE s.user_id = $1
             GROUP BY s.id
             ORDER BY s.updated_at DESC",
        )
        .bind(self.user_id)
        .fetch_all(&self.pool)
        .await
        .map_err(box_err)?;

        rows.iter()
            .map(|row| -> Result<Session, SessionError> {
                let id: Uuid = row.try_get("id").map_err(box_err)?;
                let title: String = row.try_get("title").map_err(box_err)?;
                let created_at: chrono::DateTime<chrono::Utc> =
                    row.try_get("created_at").map_err(box_err)?;
                let updated_at: chrono::DateTime<chrono::Utc> =
                    row.try_get("updated_at").map_err(box_err)?;
                let message_count: i32 = row.try_get("message_count").map_err(box_err)?;
                Ok(Session {
                    id,
                    title,
                    created_at: ts_millis(created_at),
                    updated_at: ts_millis(updated_at),
                    message_count: message_count as u32,
                })
            })
            .collect()
    }

    async fn create_session(&self, title: Option<String>) -> Result<Session, SessionError> {
        let id = Uuid::new_v4();
        let title = title.unwrap_or_else(|| "New conversation".to_string());
        let now = chrono::Utc::now();

        sqlx::query(
            "INSERT INTO chat_sessions (id, user_id, title, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $4)",
        )
        .bind(id)
        .bind(self.user_id)
        .bind(&title)
        .bind(now)
        .execute(&self.pool)
        .await
        .map_err(box_err)?;

        Ok(Session {
            id,
            title,
            created_at: ts_millis(now),
            updated_at: ts_millis(now),
            message_count: 0,
        })
    }

    async fn get_messages(&self, session_id: Uuid) -> Result<Vec<MessageRecord>, SessionError> {
        let rows = sqlx::query(
            "SELECT id::text, role, content, citations, created_at
             FROM chat_messages
             WHERE session_id = $1 AND user_id = $2
             ORDER BY created_at ASC",
        )
        .bind(session_id)
        .bind(self.user_id)
        .fetch_all(&self.pool)
        .await
        .map_err(box_err)?;

        rows.iter()
            .map(|row| -> Result<MessageRecord, SessionError> {
                let id: String = row.try_get("id").map_err(box_err)?;
                let role: String = row.try_get("role").map_err(box_err)?;
                let content: String = row.try_get("content").map_err(box_err)?;
                let citations: serde_json::Value =
                    row.try_get("citations").map_err(box_err)?;
                let created_at: chrono::DateTime<chrono::Utc> =
                    row.try_get("created_at").map_err(box_err)?;
                Ok(MessageRecord {
                    id,
                    role,
                    content,
                    citations_json: citations.to_string(),
                    created_at: ts_millis(created_at),
                })
            })
            .collect()
    }

    async fn get_prior_messages(
        &self,
        session_id: Uuid,
    ) -> Result<Vec<(String, String)>, SessionError> {
        let rows = sqlx::query(
            "SELECT role, content FROM chat_messages
             WHERE session_id = $1 AND user_id = $2
             ORDER BY created_at ASC",
        )
        .bind(session_id)
        .bind(self.user_id)
        .fetch_all(&self.pool)
        .await
        .map_err(box_err)?;

        rows.iter()
            .map(|row| -> Result<(String, String), SessionError> {
                Ok((
                    row.try_get("role").map_err(box_err)?,
                    row.try_get("content").map_err(box_err)?,
                ))
            })
            .collect()
    }

    async fn save_user_message(
        &self,
        session_id: Uuid,
        id: &str,
        content: &str,
    ) -> Result<(), SessionError> {
        let msg_id = Uuid::parse_str(id).unwrap_or_else(|_| Uuid::new_v4());
        let now = chrono::Utc::now();
        sqlx::query(
            "INSERT INTO chat_messages
                 (id, session_id, user_id, role, content, citations, created_at)
             VALUES ($1, $2, $3, 'user', $4, '[]', $5)",
        )
        .bind(msg_id)
        .bind(session_id)
        .bind(self.user_id)
        .bind(content)
        .bind(now)
        .execute(&self.pool)
        .await
        .map_err(box_err)?;
        Ok(())
    }

    async fn save_assistant_message(
        &self,
        session_id: Uuid,
        id: &str,
        content: &str,
        citations_json: &str,
    ) -> Result<(), SessionError> {
        let msg_id = Uuid::parse_str(id).unwrap_or_else(|_| Uuid::new_v4());
        let now = chrono::Utc::now();
        let citations: serde_json::Value =
            serde_json::from_str(citations_json).unwrap_or_else(|_| serde_json::json!([]));
        sqlx::query(
            "INSERT INTO chat_messages
                 (id, session_id, user_id, role, content, citations, created_at)
             VALUES ($1, $2, $3, 'assistant', $4, $5, $6)",
        )
        .bind(msg_id)
        .bind(session_id)
        .bind(self.user_id)
        .bind(content)
        .bind(citations)
        .bind(now)
        .execute(&self.pool)
        .await
        .map_err(box_err)?;
        Ok(())
    }

    async fn touch_session(&self, session_id: Uuid) -> Result<(), SessionError> {
        let now = chrono::Utc::now();
        sqlx::query(
            "UPDATE chat_sessions SET updated_at = $1 WHERE id = $2 AND user_id = $3",
        )
        .bind(now)
        .bind(session_id)
        .bind(self.user_id)
        .execute(&self.pool)
        .await
        .map_err(box_err)?;
        Ok(())
    }
}
