// Copyright 2024 Kaya Suites. Licensed under the Apache License, Version 2.0.
//! Postgres-backed [`SessionStorage`] implementation.
//!
//! UUID columns are VARCHAR(36) in the kaya-db schema; bind/decode as strings.

use async_trait::async_trait;
use kaya_core::session::{
    ChatHistorySummary, DocumentEmbeddingStatus, EditHistoryEntry, EmbeddingCall,
    EmbeddingModelUsage, FolderSidebarState, MessageRecord, ModelUsage, Session, SessionError,
    SessionStorage, SessionTokenUsage, UsageSummary,
};
use sqlx::{PgPool, Row};
use uuid::Uuid;

/// Postgres session storage scoped to a single user.
pub struct PostgresSessionStorage {
    pool: PgPool,
    user_id: Uuid,
}

const FOLDER_SIDEBAR_STATE_KEY: &str = "folder_sidebar_state";
const EDIT_HISTORY_LIMIT: usize = 5;

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

fn chat_summary_key(session_id: Uuid) -> String {
    format!("chat_summary:{session_id}")
}

fn edit_history_key(session_id: Uuid) -> String {
    format!("edit_history:{session_id}")
}

async fn get_pref_json<T>(pool: &PgPool, user_id: Uuid, key: &str) -> Result<Option<T>, SessionError>
where
    T: serde::de::DeserializeOwned,
{
    let row = sqlx::query(
        "SELECT preference_value
         FROM user_ui_preferences
         WHERE user_id = $1 AND preference_key = $2",
    )
    .bind(user_id.to_string())
    .bind(key)
    .fetch_optional(pool)
    .await
    .map_err(box_err)?;

    let Some(row) = row else {
        return Ok(None);
    };

    let value: serde_json::Value = row.try_get("preference_value").map_err(box_err)?;
    let parsed = serde_json::from_value(value).map_err(box_err)?;
    Ok(Some(parsed))
}

async fn set_pref_json<T>(
    pool: &PgPool,
    user_id: Uuid,
    key: &str,
    value: &T,
) -> Result<(), SessionError>
where
    T: serde::Serialize,
{
    let value = serde_json::to_value(value).map_err(box_err)?;

    sqlx::query(
        "INSERT INTO user_ui_preferences
             (user_id, preference_key, preference_value, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (user_id, preference_key) DO UPDATE SET
             preference_value = EXCLUDED.preference_value,
             updated_at = EXCLUDED.updated_at",
    )
    .bind(user_id.to_string())
    .bind(key)
    .bind(value)
    .execute(pool)
    .await
    .map_err(box_err)?;

    Ok(())
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
                    s.total_output_tokens,
                    s.pinned
             FROM chat_sessions s
             LEFT JOIN chat_messages m
               ON m.session_id = s.id AND m.user_id = s.user_id
             WHERE s.user_id = $1
             GROUP BY s.id
             ORDER BY s.pinned DESC, s.updated_at DESC",
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
                let total_input_tokens: i32 = row.try_get("total_input_tokens").map_err(box_err)?;
                let total_output_tokens: i32 =
                    row.try_get("total_output_tokens").map_err(box_err)?;
                let pinned: bool = row.try_get("pinned").map_err(box_err)?;
                Ok(Session {
                    id,
                    title,
                    created_at: ts_millis(created_at),
                    updated_at: ts_millis(updated_at),
                    message_count: message_count as u32,
                    total_input_tokens: total_input_tokens as u32,
                    total_output_tokens: total_output_tokens as u32,
                    pinned,
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
            pinned: false,
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
                let citations: serde_json::Value = row.try_get("citations").map_err(box_err)?;
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

    async fn get_chat_summary(
        &self,
        session_id: Uuid,
    ) -> Result<Option<ChatHistorySummary>, SessionError> {
        get_pref_json(&self.pool, self.user_id, &chat_summary_key(session_id)).await
    }

    async fn save_chat_summary(
        &self,
        session_id: Uuid,
        summary: &ChatHistorySummary,
    ) -> Result<(), SessionError> {
        set_pref_json(&self.pool, self.user_id, &chat_summary_key(session_id), summary).await
    }

    async fn get_recent_edit_history(
        &self,
        session_id: Uuid,
        limit: usize,
    ) -> Result<Vec<EditHistoryEntry>, SessionError> {
        let mut entries: Vec<EditHistoryEntry> =
            get_pref_json(&self.pool, self.user_id, &edit_history_key(session_id))
                .await?
                .unwrap_or_default();
        entries.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        entries.truncate(limit.min(EDIT_HISTORY_LIMIT));
        Ok(entries)
    }

    async fn upsert_edit_history_entry(
        &self,
        session_id: Uuid,
        entry: &EditHistoryEntry,
    ) -> Result<(), SessionError> {
        let key = edit_history_key(session_id);
        let mut entries: Vec<EditHistoryEntry> = get_pref_json(&self.pool, self.user_id, &key)
            .await?
            .unwrap_or_default();

        if let Some(existing) = entries.iter_mut().find(|e| e.edit_id == entry.edit_id) {
            *existing = entry.clone();
        } else {
            entries.push(entry.clone());
        }

        entries.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        entries.truncate(EDIT_HISTORY_LIMIT);
        set_pref_json(&self.pool, self.user_id, &key, &entries).await
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
        sqlx::query("UPDATE chat_sessions SET updated_at = $1 WHERE id = $2 AND user_id = $3")
            .bind(now)
            .bind(session_id.to_string())
            .bind(self.user_id.to_string())
            .execute(&self.pool)
            .await
            .map_err(box_err)?;
        Ok(())
    }

    async fn rename_session(&self, session_id: Uuid, title: String) -> Result<(), SessionError> {
        sqlx::query("UPDATE chat_sessions SET title = $1 WHERE id = $2 AND user_id = $3")
            .bind(&title)
            .bind(session_id.to_string())
            .bind(self.user_id.to_string())
            .execute(&self.pool)
            .await
            .map_err(box_err)?;
        Ok(())
    }

    async fn delete_session(&self, session_id: Uuid) -> Result<(), SessionError> {
        let id = session_id.to_string();
        let uid = self.user_id.to_string();
        sqlx::query("DELETE FROM chat_messages WHERE session_id = $1 AND user_id = $2")
            .bind(&id)
            .bind(&uid)
            .execute(&self.pool)
            .await
            .map_err(box_err)?;
        sqlx::query(
            "DELETE FROM user_ui_preferences
             WHERE user_id = $1 AND preference_key = ANY($2)",
        )
        .bind(&uid)
        .bind(vec![chat_summary_key(session_id), edit_history_key(session_id)])
        .execute(&self.pool)
        .await
        .map_err(box_err)?;
        sqlx::query("DELETE FROM chat_sessions WHERE id = $1 AND user_id = $2")
            .bind(&id)
            .bind(&uid)
            .execute(&self.pool)
            .await
            .map_err(box_err)?;
        Ok(())
    }

    async fn pin_session(&self, session_id: Uuid, pinned: bool) -> Result<(), SessionError> {
        sqlx::query("UPDATE chat_sessions SET pinned = $1 WHERE id = $2 AND user_id = $3")
            .bind(pinned)
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

        let emb_rows = sqlx::query(
            "SELECT model, SUM(tokens)::int4 AS total_tokens
             FROM embedding_calls
             WHERE user_id = $1 AND model != ''
             GROUP BY model
             ORDER BY total_tokens DESC",
        )
        .bind(self.user_id.to_string())
        .fetch_all(&self.pool)
        .await
        .map_err(box_err)?;

        let by_embedding_model: Vec<EmbeddingModelUsage> = emb_rows
            .iter()
            .map(|row| -> Result<EmbeddingModelUsage, SessionError> {
                let total: i32 = row.try_get("total_tokens").map_err(box_err)?;
                Ok(EmbeddingModelUsage {
                    model: row.try_get("model").map_err(box_err)?,
                    tokens: total as u32,
                })
            })
            .collect::<Result<_, _>>()?;

        let total_embedding_tokens: u32 = by_embedding_model.iter().map(|m| m.tokens).sum();

        Ok(UsageSummary {
            total_input_tokens,
            total_output_tokens,
            by_model,
            sessions,
            total_embedding_tokens,
            by_embedding_model,
        })
    }

    async fn save_embedding_call(&self, call: &EmbeddingCall) -> Result<(), SessionError> {
        sqlx::query(
            "INSERT INTO embedding_calls
                 (id, user_id, model, tokens, task_id, task_type, session_id, document_id, paragraph_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
        )
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(self.user_id.to_string())
        .bind(&call.model)
        .bind(call.tokens as i32)
        .bind(call.task_id.as_deref())
        .bind(&call.task_type)
        .bind(call.session_id.map(|id| id.to_string()))
        .bind(call.document_id.map(|id| id.to_string()))
        .bind(call.paragraph_id.as_deref())
        .execute(&self.pool)
        .await
        .map_err(box_err)?;
        Ok(())
    }

    async fn upsert_document_embedding_status(
        &self,
        status: &DocumentEmbeddingStatus,
    ) -> Result<(), SessionError> {
        let updated_at = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(status.updated_at)
            .unwrap_or_else(chrono::Utc::now);
        let last_indexed_at = status
            .last_indexed_at
            .and_then(chrono::DateTime::<chrono::Utc>::from_timestamp_millis);

        sqlx::query(
            "INSERT INTO document_embedding_status
                 (user_id, document_id, task_id, status, expected_chunks, embedded_chunks, last_error, updated_at, last_indexed_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (user_id, document_id) DO UPDATE SET
                 task_id = EXCLUDED.task_id,
                 status = EXCLUDED.status,
                 expected_chunks = EXCLUDED.expected_chunks,
                 embedded_chunks = EXCLUDED.embedded_chunks,
                 last_error = EXCLUDED.last_error,
                 updated_at = EXCLUDED.updated_at,
                 last_indexed_at = EXCLUDED.last_indexed_at",
        )
        .bind(self.user_id.to_string())
        .bind(status.document_id.to_string())
        .bind(status.task_id.as_deref())
        .bind(&status.status)
        .bind(status.expected_chunks as i32)
        .bind(status.embedded_chunks as i32)
        .bind(status.last_error.as_deref())
        .bind(updated_at)
        .bind(last_indexed_at)
        .execute(&self.pool)
        .await
        .map_err(box_err)?;
        Ok(())
    }

    async fn get_folder_sidebar_state(&self) -> Result<Option<FolderSidebarState>, SessionError> {
        get_pref_json(&self.pool, self.user_id, FOLDER_SIDEBAR_STATE_KEY).await
    }

    async fn save_folder_sidebar_state(
        &self,
        state: &FolderSidebarState,
    ) -> Result<(), SessionError> {
        set_pref_json(&self.pool, self.user_id, FOLDER_SIDEBAR_STATE_KEY, state).await
    }
}
