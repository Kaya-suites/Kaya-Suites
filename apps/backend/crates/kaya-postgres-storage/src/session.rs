// Copyright 2024 Kaya Suites. Licensed under the Apache License, Version 2.0.
//! Postgres-backed [`SessionStorage`] implementation.
//!
//! UUID columns are VARCHAR(36) in the kaya-db schema; bind/decode as strings.

use async_trait::async_trait;
use kaya_core::session::{MessageRecord, ModelUsage, Session, SessionError, SessionStorage, SessionTokenUsage, UsageSummary};
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
            "SELECT s.id::text,
                    COALESCE(s.title, 'Untitled') AS title,
                    s.created_at,
                    s.updated_at,
                    COUNT(m.id)::int4 AS message_count,
                    s.total_input_tokens,
                    s.total_output_tokens
             FROM chat_sessions s
             LEFT JOIN chat_messages m
               ON m.session_id = s.id AND m.user_id = s.user_id
             WHERE s.user_id = $1
             GROUP BY s.id
             ORDER BY s.updated_at DESC",
        )
        .bind(self.user_id.to_string())
        .fetch_all(&self.pool)
        .await
        .map_err(box_err)?;

        rows.iter()
            .map(|row| -> Result<Session, SessionError> {
                let id_str: String = row.try_get("id").map_err(box_err)?;
                let id = Uuid::parse_str(&id_str).unwrap_or_default();
                let title: String = row.try_get("title").map_err(box_err)?;
                let created_at: chrono::DateTime<chrono::Utc> =
                    row.try_get("created_at").map_err(box_err)?;
                let updated_at: chrono::DateTime<chrono::Utc> =
                    row.try_get("updated_at").map_err(box_err)?;
                let message_count: i32 = row.try_get("message_count").map_err(box_err)?;
                let total_input_tokens: i32 =
                    row.try_get("total_input_tokens").map_err(box_err)?;
                let total_output_tokens: i32 =
                    row.try_get("total_output_tokens").map_err(box_err)?;
                Ok(Session {
                    id,
                    title,
                    created_at: ts_millis(created_at),
                    updated_at: ts_millis(updated_at),
                    message_count: message_count as u32,
                    total_input_tokens: total_input_tokens as u32,
                    total_output_tokens: total_output_tokens as u32,
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
        .bind(id.to_string())
        .bind(self.user_id.to_string())
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
            total_input_tokens: 0,
            total_output_tokens: 0,
        })
    }

    async fn get_messages(&self, session_id: Uuid) -> Result<Vec<MessageRecord>, SessionError> {
        let rows = sqlx::query(
            "SELECT id::text, role, content, citations, created_at, input_tokens, output_tokens, model
             FROM chat_messages
             WHERE session_id = $1 AND user_id = $2
             ORDER BY created_at ASC",
        )
        .bind(session_id.to_string())
        .bind(self.user_id.to_string())
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
                let input_tokens: i32 = row.try_get("input_tokens").map_err(box_err)?;
                let output_tokens: i32 = row.try_get("output_tokens").map_err(box_err)?;
                let model: String = row.try_get("model").map_err(box_err)?;
                Ok(MessageRecord {
                    id,
                    role,
                    content,
                    citations_json: citations.to_string(),
                    created_at: ts_millis(created_at),
                    input_tokens: input_tokens as u32,
                    output_tokens: output_tokens as u32,
                    model,
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
        .bind(session_id.to_string())
        .bind(self.user_id.to_string())
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
        .bind(msg_id.to_string())
        .bind(session_id.to_string())
        .bind(self.user_id.to_string())
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
        input_tokens: u32,
        output_tokens: u32,
        model: &str,
    ) -> Result<(), SessionError> {
        let msg_id = Uuid::parse_str(id).unwrap_or_else(|_| Uuid::new_v4());
        let now = chrono::Utc::now();
        let citations: serde_json::Value =
            serde_json::from_str(citations_json).unwrap_or_else(|_| serde_json::json!([]));
        sqlx::query(
            "INSERT INTO chat_messages
                 (id, session_id, user_id, role, content, citations, created_at,
                  input_tokens, output_tokens, model)
             VALUES ($1, $2, $3, 'assistant', $4, $5, $6, $7, $8, $9)",
        )
        .bind(msg_id.to_string())
        .bind(session_id.to_string())
        .bind(self.user_id.to_string())
        .bind(content)
        .bind(citations)
        .bind(now)
        .bind(input_tokens as i32)
        .bind(output_tokens as i32)
        .bind(model)
        .execute(&self.pool)
        .await
        .map_err(box_err)?;

        sqlx::query(
            "UPDATE chat_sessions
             SET total_input_tokens  = total_input_tokens  + $1,
                 total_output_tokens = total_output_tokens + $2
             WHERE id = $3 AND user_id = $4",
        )
        .bind(input_tokens as i32)
        .bind(output_tokens as i32)
        .bind(session_id.to_string())
        .bind(self.user_id.to_string())
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
        .bind(session_id.to_string())
        .bind(self.user_id.to_string())
        .execute(&self.pool)
        .await
        .map_err(box_err)?;
        Ok(())
    }

    async fn rename_session(&self, session_id: Uuid, title: String) -> Result<(), SessionError> {
        sqlx::query(
            "UPDATE chat_sessions SET title = $1 WHERE id = $2 AND user_id = $3",
        )
        .bind(&title)
        .bind(session_id.to_string())
        .bind(self.user_id.to_string())
        .execute(&self.pool)
        .await
        .map_err(box_err)?;
        Ok(())
    }

    async fn get_usage_summary(&self) -> Result<UsageSummary, SessionError> {
        let model_rows = sqlx::query(
            "SELECT model,
                    SUM(input_tokens)::int4  AS total_in,
                    SUM(output_tokens)::int4 AS total_out
             FROM chat_messages
             WHERE user_id = $1 AND role = 'assistant' AND model != ''
             GROUP BY model
             ORDER BY total_in DESC",
        )
        .bind(self.user_id.to_string())
        .fetch_all(&self.pool)
        .await
        .map_err(box_err)?;

        let by_model: Vec<ModelUsage> = model_rows
            .iter()
            .map(|row| -> Result<ModelUsage, SessionError> {
                let total_in: i32 = row.try_get("total_in").map_err(box_err)?;
                let total_out: i32 = row.try_get("total_out").map_err(box_err)?;
                Ok(ModelUsage {
                    model: row.try_get("model").map_err(box_err)?,
                    input_tokens: total_in as u32,
                    output_tokens: total_out as u32,
                })
            })
            .collect::<Result<_, _>>()?;

        let total_input_tokens: u32 = by_model.iter().map(|m| m.input_tokens).sum();
        let total_output_tokens: u32 = by_model.iter().map(|m| m.output_tokens).sum();

        let session_rows = sqlx::query(
            "SELECT id::text, COALESCE(title, 'Untitled') AS title,
                    total_input_tokens, total_output_tokens, updated_at
             FROM chat_sessions
             WHERE user_id = $1
               AND (total_input_tokens > 0 OR total_output_tokens > 0)
             ORDER BY updated_at DESC",
        )
        .bind(self.user_id.to_string())
        .fetch_all(&self.pool)
        .await
        .map_err(box_err)?;

        let sessions: Vec<SessionTokenUsage> = session_rows
            .iter()
            .map(|row| -> Result<SessionTokenUsage, SessionError> {
                let total_in: i32 = row.try_get("total_input_tokens").map_err(box_err)?;
                let total_out: i32 = row.try_get("total_output_tokens").map_err(box_err)?;
                let updated_at: chrono::DateTime<chrono::Utc> =
                    row.try_get("updated_at").map_err(box_err)?;
                Ok(SessionTokenUsage {
                    session_id: row.try_get("id").map_err(box_err)?,
                    title: row.try_get("title").map_err(box_err)?,
                    input_tokens: total_in as u32,
                    output_tokens: total_out as u32,
                    updated_at: ts_millis(updated_at),
                })
            })
            .collect::<Result<_, _>>()?;

        Ok(UsageSummary { total_input_tokens, total_output_tokens, by_model, sessions })
    }
}
