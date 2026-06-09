//! SQLite-backed [`SessionStorage`] implementation.

use async_trait::async_trait;
use chrono::Utc;
use kaya_core::session::{
    ChatHistorySummary, DocumentEmbeddingStatus, EditHistoryEntry, EmbeddingCall,
    EmbeddingModelUsage, FolderSidebarState, MessageRecord, ModelUsage, Session, SessionError,
    SessionStorage, SessionTokenUsage, UsageSummary,
};
use sqlx::{Row, SqlitePool};
use uuid::Uuid;

/// SQLite session storage. Scoped to a single `user_id` per instance, the same
/// way [`crate::PostgresSessionStorage`] and [`crate::MySqlSessionStorage`] are.
pub struct SqliteSessionStorage {
    pool: SqlitePool,
    user_id: Uuid,
}

const FOLDER_SIDEBAR_STATE_KEY: &str = "folder_sidebar_state";
const EDIT_HISTORY_LIMIT: usize = 5;

impl SqliteSessionStorage {
    pub fn new(pool: SqlitePool, user_id: Uuid) -> Self {
        Self { pool, user_id }
    }

    fn user_id_str(&self) -> String {
        self.user_id.to_string()
    }

}

fn box_err<E: std::error::Error + Send + Sync + 'static>(e: E) -> SessionError {
    SessionError::Backend(Box::new(e))
}

fn chat_summary_key(session_id: Uuid) -> String {
    format!("chat_summary:{session_id}")
}

fn edit_history_key(session_id: Uuid) -> String {
    format!("edit_history:{session_id}")
}

async fn get_pref_json<T>(pool: &SqlitePool, user_id: Uuid, key: &str) -> Result<Option<T>, SessionError>
where
    T: serde::de::DeserializeOwned,
{
    let row = sqlx::query("SELECT value FROM ui_preferences WHERE user_id = ? AND key = ?")
        .bind(user_id.to_string())
        .bind(key)
        .fetch_optional(pool)
        .await
        .map_err(box_err)?;

    let Some(row) = row else {
        return Ok(None);
    };

    let value: String = row.try_get("value").map_err(box_err)?;
    let parsed = serde_json::from_str(&value).map_err(box_err)?;
    Ok(Some(parsed))
}

async fn set_pref_json<T>(pool: &SqlitePool, user_id: Uuid, key: &str, value: &T) -> Result<(), SessionError>
where
    T: serde::Serialize,
{
    let now = Utc::now().timestamp_millis();
    let value = serde_json::to_string(value).map_err(box_err)?;

    sqlx::query(
        "INSERT INTO ui_preferences (user_id, key, value, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, key) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at",
    )
    .bind(user_id.to_string())
    .bind(key)
    .bind(value)
    .bind(now)
    .execute(pool)
    .await
    .map_err(box_err)?;

    Ok(())
}

#[async_trait]
impl SessionStorage for SqliteSessionStorage {
    async fn list_sessions(&self) -> Result<Vec<Session>, SessionError> {
        let rows = sqlx::query(
            "SELECT id, title, created_at, updated_at, message_count,
                    total_input_tokens, total_output_tokens, pinned
             FROM chat_sessions WHERE user_id = ? ORDER BY pinned DESC, updated_at DESC",
        )
        .bind(self.user_id_str())
        .fetch_all(&self.pool)
        .await
        .map_err(box_err)?;

        rows.into_iter()
            .map(|row| -> Result<Session, SessionError> {
                Ok(Session {
                    id: Uuid::parse_str(row.try_get::<&str, _>("id").map_err(box_err)?)
                        .map_err(|e| SessionError::Backend(Box::new(e)))?,
                    title: row.try_get("title").map_err(box_err)?,
                    created_at: row.try_get("created_at").map_err(box_err)?,
                    updated_at: row.try_get("updated_at").map_err(box_err)?,
                    message_count: row.try_get::<i64, _>("message_count").map_err(box_err)? as u32,
                    total_input_tokens: row
                        .try_get::<i64, _>("total_input_tokens")
                        .map_err(box_err)? as u32,
                    total_output_tokens: row
                        .try_get::<i64, _>("total_output_tokens")
                        .map_err(box_err)? as u32,
                    pinned: row.try_get::<i64, _>("pinned").map_err(box_err)? != 0,
                })
            })
            .collect()
    }

    async fn create_session(
        &self,
        id: Option<Uuid>,
        title: Option<String>,
    ) -> Result<Session, SessionError> {
        let id = id.unwrap_or_else(Uuid::new_v4);
        let now = Utc::now().timestamp_millis();
        let title = title.unwrap_or_else(|| "New conversation".to_string());

        sqlx::query(
            "INSERT INTO chat_sessions (id, user_id, title, created_at, updated_at, message_count)
             VALUES (?, ?, ?, ?, ?, 0)",
        )
        .bind(id.to_string())
        .bind(self.user_id_str())
        .bind(&title)
        .bind(now)
        .bind(now)
        .execute(&self.pool)
        .await
        .map_err(box_err)?;

        Ok(Session {
            id,
            title,
            created_at: now,
            updated_at: now,
            message_count: 0,
            total_input_tokens: 0,
            total_output_tokens: 0,
            pinned: false,
        })
    }

    async fn get_messages(&self, session_id: Uuid) -> Result<Vec<MessageRecord>, SessionError> {
        let rows = sqlx::query(
            "SELECT id, role, content, citations, created_at, input_tokens, output_tokens, model, proposals
             FROM chat_messages WHERE session_id = ? AND user_id = ? ORDER BY created_at ASC",
        )
        .bind(session_id.to_string())
        .bind(self.user_id_str())
        .fetch_all(&self.pool)
        .await
        .map_err(box_err)?;

        rows.into_iter()
            .map(|row| -> Result<MessageRecord, SessionError> {
                Ok(MessageRecord {
                    id: row.try_get("id").map_err(box_err)?,
                    role: row.try_get("role").map_err(box_err)?,
                    content: row.try_get("content").map_err(box_err)?,
                    citations_json: row.try_get("citations").map_err(box_err)?,
                    created_at: row.try_get("created_at").map_err(box_err)?,
                    input_tokens: row.try_get::<i64, _>("input_tokens").map_err(box_err)? as u32,
                    output_tokens: row.try_get::<i64, _>("output_tokens").map_err(box_err)? as u32,
                    model: row.try_get("model").map_err(box_err)?,
                    proposals_json: row.try_get("proposals").map_err(box_err)?,
                })
            })
            .collect()
    }

    async fn get_prior_messages(
        &self,
        session_id: Uuid,
    ) -> Result<Vec<(String, String)>, SessionError> {
        let rows = sqlx::query(
            "SELECT role, content FROM chat_messages WHERE session_id = ? AND user_id = ? ORDER BY created_at ASC",
        )
        .bind(session_id.to_string())
        .bind(self.user_id_str())
        .fetch_all(&self.pool)
        .await
        .map_err(box_err)?;

        rows.into_iter()
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
        let mut entries: Vec<EditHistoryEntry> =
            get_pref_json(&self.pool, self.user_id, &key).await?.unwrap_or_default();

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
        let now = Utc::now().timestamp_millis();
        sqlx::query(
            "INSERT INTO chat_messages (id, session_id, user_id, role, content, citations, created_at)
             VALUES (?, ?, ?, 'user', ?, '[]', ?)",
        )
        .bind(id)
        .bind(session_id.to_string())
        .bind(self.user_id_str())
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
        let now = Utc::now().timestamp_millis();
        sqlx::query(
            "INSERT INTO chat_messages
                 (id, session_id, user_id, role, content, citations, created_at,
                  input_tokens, output_tokens, model)
             VALUES (?, ?, ?, 'assistant', ?, ?, ?, ?, ?, ?)",
        )
        .bind(id)
        .bind(session_id.to_string())
        .bind(self.user_id_str())
        .bind(content)
        .bind(citations_json)
        .bind(now)
        .bind(input_tokens as i64)
        .bind(output_tokens as i64)
        .bind(model)
        .execute(&self.pool)
        .await
        .map_err(box_err)?;

        sqlx::query(
            "UPDATE chat_sessions
             SET total_input_tokens  = total_input_tokens  + ?,
                 total_output_tokens = total_output_tokens + ?
             WHERE id = ? AND user_id = ?",
        )
        .bind(input_tokens as i64)
        .bind(output_tokens as i64)
        .bind(session_id.to_string())
        .bind(self.user_id_str())
        .execute(&self.pool)
        .await
        .map_err(box_err)?;

        Ok(())
    }

    async fn update_message_proposals(
        &self,
        message_id: &str,
        proposals_json: &str,
    ) -> Result<(), SessionError> {
        sqlx::query("UPDATE chat_messages SET proposals = ? WHERE id = ? AND user_id = ?")
            .bind(proposals_json)
            .bind(message_id)
            .bind(self.user_id_str())
            .execute(&self.pool)
            .await
            .map_err(box_err)?;
        Ok(())
    }

    async fn save_pending_edit(
        &self,
        edit_id: Uuid,
        payload_json: &str,
    ) -> Result<(), SessionError> {
        let now = chrono::Utc::now().timestamp_millis();
        sqlx::query(
            "INSERT INTO pending_edits (id, payload, created_at) VALUES (?, ?, ?) \
             ON CONFLICT(id) DO UPDATE SET payload = excluded.payload",
        )
        .bind(edit_id.to_string())
        .bind(payload_json)
        .bind(now)
        .execute(&self.pool)
        .await
        .map_err(box_err)?;
        Ok(())
    }

    async fn take_pending_edit(
        &self,
        edit_id: Uuid,
    ) -> Result<Option<String>, SessionError> {
        let key = edit_id.to_string();
        let row = sqlx::query("SELECT payload FROM pending_edits WHERE id = ?")
            .bind(&key)
            .fetch_optional(&self.pool)
            .await
            .map_err(box_err)?;
        let Some(row) = row else { return Ok(None) };
        let payload: String = row.try_get("payload").map_err(box_err)?;
        sqlx::query("DELETE FROM pending_edits WHERE id = ?")
            .bind(&key)
            .execute(&self.pool)
            .await
            .map_err(box_err)?;
        Ok(Some(payload))
    }

    async fn find_proposal_by_edit_id(
        &self,
        edit_id: Uuid,
    ) -> Result<Option<kaya_core::ProposalLookup>, SessionError> {
        let needle = format!("%\"id\":\"{}\"%", edit_id);
        let rows: Vec<(String, String, String)> = sqlx::query_as(
            "SELECT id, session_id, proposals FROM chat_messages WHERE user_id = ? AND proposals LIKE ? LIMIT 5",
        )
        .bind(self.user_id_str())
        .bind(&needle)
        .fetch_all(&self.pool)
        .await
        .map_err(box_err)?;
        Ok(crate::session::extract_proposal_lookup(rows, edit_id))
    }

    async fn update_proposal_status(
        &self,
        message_id: &str,
        edit_id: Uuid,
        status: &str,
    ) -> Result<(), SessionError> {
        let row = sqlx::query("SELECT proposals FROM chat_messages WHERE id = ? AND user_id = ?")
            .bind(message_id)
            .bind(self.user_id_str())
            .fetch_optional(&self.pool)
            .await
            .map_err(box_err)?;
        let Some(row) = row else { return Ok(()) };
        let json: String = row.try_get("proposals").map_err(box_err)?;
        let mut arr: Vec<serde_json::Value> = serde_json::from_str(&json).unwrap_or_default();
        let target = edit_id.to_string();
        let mut changed = false;
        for item in arr.iter_mut() {
            if item.get("id").and_then(|v| v.as_str()) == Some(target.as_str()) {
                item["status"] = serde_json::Value::String(status.to_string());
                changed = true;
                break;
            }
        }
        if !changed {
            return Ok(());
        }
        let new_json = serde_json::to_string(&arr).map_err(box_err)?;
        sqlx::query("UPDATE chat_messages SET proposals = ? WHERE id = ? AND user_id = ?")
            .bind(new_json)
            .bind(message_id)
            .bind(self.user_id_str())
            .execute(&self.pool)
            .await
            .map_err(box_err)?;
        Ok(())
    }

    async fn touch_session(&self, session_id: Uuid) -> Result<(), SessionError> {
        let now = Utc::now().timestamp_millis();
        sqlx::query(
            "UPDATE chat_sessions
             SET message_count = message_count + 1, updated_at = ?
             WHERE id = ? AND user_id = ?",
        )
        .bind(now)
        .bind(session_id.to_string())
        .bind(self.user_id_str())
        .execute(&self.pool)
        .await
        .map_err(box_err)?;
        Ok(())
    }

    async fn rename_session(&self, session_id: Uuid, title: String) -> Result<(), SessionError> {
        sqlx::query("UPDATE chat_sessions SET title = ? WHERE id = ? AND user_id = ?")
            .bind(&title)
            .bind(session_id.to_string())
            .bind(self.user_id_str())
            .execute(&self.pool)
            .await
            .map_err(box_err)?;
        Ok(())
    }

    async fn delete_session(&self, session_id: Uuid) -> Result<(), SessionError> {
        let id = session_id.to_string();
        let user_id_str = self.user_id_str();
        sqlx::query("DELETE FROM chat_messages WHERE session_id = ? AND user_id = ?")
            .bind(&id)
            .bind(&user_id_str)
            .execute(&self.pool)
            .await
            .map_err(box_err)?;
        sqlx::query("DELETE FROM ui_preferences WHERE user_id = ? AND key IN (?, ?)")
            .bind(&user_id_str)
            .bind(chat_summary_key(session_id))
            .bind(edit_history_key(session_id))
            .execute(&self.pool)
            .await
            .map_err(box_err)?;
        sqlx::query("DELETE FROM chat_sessions WHERE id = ? AND user_id = ?")
            .bind(&id)
            .bind(&user_id_str)
            .execute(&self.pool)
            .await
            .map_err(box_err)?;
        Ok(())
    }

    async fn pin_session(&self, session_id: Uuid, pinned: bool) -> Result<(), SessionError> {
        sqlx::query("UPDATE chat_sessions SET pinned = ? WHERE id = ? AND user_id = ?")
            .bind(pinned as i64)
            .bind(session_id.to_string())
            .bind(self.user_id_str())
            .execute(&self.pool)
            .await
            .map_err(box_err)?;
        Ok(())
    }

    async fn save_embedding_call(&self, call: &EmbeddingCall) -> Result<(), SessionError> {
        let now = chrono::Utc::now().timestamp_millis();
        sqlx::query(
            "INSERT INTO embedding_calls
                 (id, user_id, model, tokens, task_id, task_type, session_id, document_id, paragraph_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(self.user_id_str())
        .bind(&call.model)
        .bind(call.tokens as i64)
        .bind(call.task_id.as_deref())
        .bind(&call.task_type)
        .bind(call.session_id.map(|id| id.to_string()))
        .bind(call.document_id.map(|id| id.to_string()))
        .bind(call.paragraph_id.as_deref())
        .bind(now)
        .execute(&self.pool)
        .await
        .map_err(box_err)?;
        Ok(())
    }

    async fn upsert_document_embedding_status(
        &self,
        status: &DocumentEmbeddingStatus,
    ) -> Result<(), SessionError> {
        sqlx::query(
            "INSERT INTO document_embedding_status
                 (user_id, document_id, task_id, status, expected_chunks, embedded_chunks, last_error, updated_at, last_indexed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(user_id, document_id) DO UPDATE SET
                 task_id = excluded.task_id,
                 status = excluded.status,
                 expected_chunks = excluded.expected_chunks,
                 embedded_chunks = excluded.embedded_chunks,
                 last_error = excluded.last_error,
                 updated_at = excluded.updated_at,
                 last_indexed_at = excluded.last_indexed_at",
        )
        .bind(self.user_id_str())
        .bind(status.document_id.to_string())
        .bind(status.task_id.as_deref())
        .bind(&status.status)
        .bind(status.expected_chunks as i64)
        .bind(status.embedded_chunks as i64)
        .bind(status.last_error.as_deref())
        .bind(status.updated_at)
        .bind(status.last_indexed_at)
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

    async fn get_usage_summary(&self) -> Result<UsageSummary, SessionError> {
        let model_rows = sqlx::query(
            "SELECT model, SUM(input_tokens) AS total_in, SUM(output_tokens) AS total_out
             FROM chat_messages
             WHERE user_id = ? AND role = 'assistant' AND model != ''
             GROUP BY model
             ORDER BY total_in DESC",
        )
        .bind(self.user_id_str())
        .fetch_all(&self.pool)
        .await
        .map_err(box_err)?;

        let by_model: Vec<ModelUsage> = model_rows
            .into_iter()
            .map(|row| -> Result<ModelUsage, SessionError> {
                Ok(ModelUsage {
                    model: row.try_get("model").map_err(box_err)?,
                    input_tokens: row.try_get::<i64, _>("total_in").map_err(box_err)? as u32,
                    output_tokens: row.try_get::<i64, _>("total_out").map_err(box_err)? as u32,
                })
            })
            .collect::<Result<_, _>>()?;

        let total_input_tokens: u32 = by_model.iter().map(|m| m.input_tokens).sum();
        let total_output_tokens: u32 = by_model.iter().map(|m| m.output_tokens).sum();

        let session_rows = sqlx::query(
            "SELECT id, title, total_input_tokens, total_output_tokens, updated_at
             FROM chat_sessions
             WHERE user_id = ? AND (total_input_tokens > 0 OR total_output_tokens > 0)
             ORDER BY updated_at DESC",
        )
        .bind(self.user_id_str())
        .fetch_all(&self.pool)
        .await
        .map_err(box_err)?;

        let sessions: Vec<SessionTokenUsage> = session_rows
            .into_iter()
            .map(|row| -> Result<SessionTokenUsage, SessionError> {
                Ok(SessionTokenUsage {
                    session_id: row.try_get::<&str, _>("id").map_err(box_err)?.to_owned(),
                    title: row.try_get("title").map_err(box_err)?,
                    input_tokens: row
                        .try_get::<i64, _>("total_input_tokens")
                        .map_err(box_err)? as u32,
                    output_tokens: row
                        .try_get::<i64, _>("total_output_tokens")
                        .map_err(box_err)? as u32,
                    updated_at: row.try_get("updated_at").map_err(box_err)?,
                })
            })
            .collect::<Result<_, _>>()?;

        let emb_rows = sqlx::query(
            "SELECT model, SUM(tokens) AS total_tokens
             FROM embedding_calls
             WHERE user_id = ? AND model != ''
             GROUP BY model
             ORDER BY total_tokens DESC",
        )
        .bind(self.user_id_str())
        .fetch_all(&self.pool)
        .await
        .map_err(box_err)?;

        let by_embedding_model: Vec<EmbeddingModelUsage> = emb_rows
            .into_iter()
            .map(|row| -> Result<EmbeddingModelUsage, SessionError> {
                Ok(EmbeddingModelUsage {
                    model: row.try_get("model").map_err(box_err)?,
                    tokens: row.try_get::<i64, _>("total_tokens").map_err(box_err)? as u32,
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
}
