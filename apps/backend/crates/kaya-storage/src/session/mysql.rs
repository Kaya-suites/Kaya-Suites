//! MySQL-backed [`SessionStorage`] implementation.

use async_trait::async_trait;
use chrono::Utc;
use kaya_core::session::{
    ChatHistorySummary, DocumentEmbeddingStatus, EditHistoryEntry, EmbeddingCall,
    EmbeddingModelUsage, FolderSidebarState, MessageRecord, ModelUsage, Session, SessionError,
    SessionStorage, SessionTokenUsage, UsageSummary,
};
use sqlx::{MySqlPool, Row};
use uuid::Uuid;

/// MySQL session storage scoped to a single user.
pub struct MySqlSessionStorage {
    pool: MySqlPool,
    user_id: Uuid,
}

const FOLDER_SIDEBAR_STATE_KEY: &str = "folder_sidebar_state";
const EDIT_HISTORY_LIMIT: usize = 5;

impl MySqlSessionStorage {
    pub fn new(pool: MySqlPool, user_id: Uuid) -> Self {
        Self { pool, user_id }
    }

    /// Create the `chat_sessions` and `chat_messages` tables if they do not exist.
    pub async fn run_migrations(pool: &MySqlPool) -> Result<(), sqlx::Error> {
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS chat_sessions (
                id                  VARCHAR(36)  NOT NULL,
                user_id             VARCHAR(36)  NOT NULL,
                title               TEXT         NOT NULL,
                created_at          BIGINT       NOT NULL,
                updated_at          BIGINT       NOT NULL,
                message_count       INT          NOT NULL DEFAULT 0,
                total_input_tokens  INT          NOT NULL DEFAULT 0,
                total_output_tokens INT          NOT NULL DEFAULT 0,
                pinned              TINYINT(1)   NOT NULL DEFAULT 0,
                PRIMARY KEY (id),
                KEY idx_chat_sessions_user (user_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        )
        .execute(pool)
        .await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS chat_messages (
                id            VARCHAR(36)  NOT NULL,
                session_id    VARCHAR(36)  NOT NULL,
                user_id       VARCHAR(36)  NOT NULL,
                role          VARCHAR(20)  NOT NULL,
                content       MEDIUMTEXT   NOT NULL,
                citations     JSON         NOT NULL,
                created_at    BIGINT       NOT NULL,
                input_tokens  INT          NOT NULL DEFAULT 0,
                output_tokens INT          NOT NULL DEFAULT 0,
                model         VARCHAR(200) NOT NULL DEFAULT '',
                PRIMARY KEY (id),
                KEY idx_chat_messages_session (session_id, user_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        )
        .execute(pool)
        .await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS embedding_calls (
                id           VARCHAR(36)  NOT NULL,
                user_id      VARCHAR(36)  NOT NULL,
                model        VARCHAR(200) NOT NULL,
                tokens       INT          NOT NULL DEFAULT 0,
                task_id      VARCHAR(64),
                task_type    VARCHAR(64)  NOT NULL DEFAULT 'unknown',
                session_id   VARCHAR(36),
                document_id  VARCHAR(36),
                paragraph_id VARCHAR(255),
                created_at   BIGINT       NOT NULL,
                PRIMARY KEY (id),
                KEY idx_embedding_calls_user (user_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        )
        .execute(pool)
        .await?;

        for stmt in [
            "ALTER TABLE embedding_calls ADD COLUMN task_id VARCHAR(64)",
            "ALTER TABLE embedding_calls ADD COLUMN task_type VARCHAR(64) NOT NULL DEFAULT 'unknown'",
            "ALTER TABLE embedding_calls ADD COLUMN session_id VARCHAR(36)",
            "ALTER TABLE embedding_calls ADD COLUMN document_id VARCHAR(36)",
            "ALTER TABLE embedding_calls ADD COLUMN paragraph_id VARCHAR(255)",
        ] {
            let _ = sqlx::query(stmt).execute(pool).await;
        }

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS document_embedding_status (
                user_id         VARCHAR(36)  NOT NULL,
                document_id     VARCHAR(36)  NOT NULL,
                task_id         VARCHAR(64),
                status          VARCHAR(32)  NOT NULL DEFAULT 'pending',
                expected_chunks INT          NOT NULL DEFAULT 0,
                embedded_chunks INT          NOT NULL DEFAULT 0,
                last_error      TEXT,
                updated_at      BIGINT       NOT NULL,
                last_indexed_at BIGINT,
                PRIMARY KEY (user_id, document_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        )
        .execute(pool)
        .await?;

        for stmt in [
            "ALTER TABLE document_embedding_status ADD COLUMN task_id VARCHAR(64)",
            "ALTER TABLE document_embedding_status ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'pending'",
            "ALTER TABLE document_embedding_status ADD COLUMN expected_chunks INT NOT NULL DEFAULT 0",
            "ALTER TABLE document_embedding_status ADD COLUMN embedded_chunks INT NOT NULL DEFAULT 0",
            "ALTER TABLE document_embedding_status ADD COLUMN last_error TEXT",
            "ALTER TABLE document_embedding_status ADD COLUMN updated_at BIGINT NOT NULL DEFAULT 0",
            "ALTER TABLE document_embedding_status ADD COLUMN last_indexed_at BIGINT",
        ] {
            let _ = sqlx::query(stmt).execute(pool).await;
        }

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS user_ui_preferences (
                user_id          VARCHAR(36)  NOT NULL,
                preference_key   VARCHAR(120) NOT NULL,
                preference_value LONGTEXT     NOT NULL,
                updated_at       BIGINT       NOT NULL,
                PRIMARY KEY (user_id, preference_key)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        )
        .execute(pool)
        .await?;

        Ok(())
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

async fn get_pref_json<T>(
    pool: &MySqlPool,
    user_id: Uuid,
    key: &str,
) -> Result<Option<T>, SessionError>
where
    T: serde::de::DeserializeOwned,
{
    let row = sqlx::query(
        "SELECT preference_value
         FROM user_ui_preferences
         WHERE user_id = ? AND preference_key = ?",
    )
    .bind(user_id.to_string())
    .bind(key)
    .fetch_optional(pool)
    .await
    .map_err(box_err)?;

    let Some(row) = row else {
        return Ok(None);
    };

    let value: String = row.try_get("preference_value").map_err(box_err)?;
    let parsed = serde_json::from_str(&value).map_err(box_err)?;
    Ok(Some(parsed))
}

async fn set_pref_json<T>(
    pool: &MySqlPool,
    user_id: Uuid,
    key: &str,
    value: &T,
) -> Result<(), SessionError>
where
    T: serde::Serialize,
{
    let now = Utc::now().timestamp_millis();
    let value = serde_json::to_string(value).map_err(box_err)?;

    sqlx::query(
        "INSERT INTO user_ui_preferences
             (user_id, preference_key, preference_value, updated_at)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
             preference_value = VALUES(preference_value),
             updated_at = VALUES(updated_at)",
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
impl SessionStorage for MySqlSessionStorage {
    async fn list_sessions(&self) -> Result<Vec<Session>, SessionError> {
        let rows = sqlx::query(
            "SELECT s.id, COALESCE(s.title, 'Untitled') AS title,
                    s.created_at, s.updated_at,
                    COUNT(m.id) AS message_count,
                    s.total_input_tokens, s.total_output_tokens, s.pinned
             FROM chat_sessions s
             LEFT JOIN chat_messages m
               ON m.session_id = s.id AND m.user_id = s.user_id
             WHERE s.user_id = ?
             GROUP BY s.id
             ORDER BY s.pinned DESC, s.updated_at DESC",
        )
        .bind(self.user_id.to_string())
        .fetch_all(&self.pool)
        .await
        .map_err(box_err)?;

        rows.into_iter()
            .map(|row| -> Result<Session, SessionError> {
                let id_str: String = row.try_get("id").map_err(box_err)?;
                let id =
                    Uuid::parse_str(&id_str).map_err(|e| SessionError::Backend(Box::new(e)))?;
                let message_count: i64 = row.try_get("message_count").map_err(box_err)?;
                let total_input: i32 = row.try_get("total_input_tokens").map_err(box_err)?;
                let total_output: i32 = row.try_get("total_output_tokens").map_err(box_err)?;
                let pinned: i8 = row.try_get("pinned").map_err(box_err)?;
                Ok(Session {
                    id,
                    title: row.try_get("title").map_err(box_err)?,
                    created_at: row.try_get("created_at").map_err(box_err)?,
                    updated_at: row.try_get("updated_at").map_err(box_err)?,
                    message_count: message_count as u32,
                    total_input_tokens: total_input as u32,
                    total_output_tokens: total_output as u32,
                    pinned: pinned != 0,
                })
            })
            .collect()
    }

    async fn create_session(&self, title: Option<String>) -> Result<Session, SessionError> {
        let id = Uuid::new_v4();
        let title = title.unwrap_or_else(|| "New conversation".to_string());
        let now = Utc::now().timestamp_millis();

        sqlx::query(
            "INSERT INTO chat_sessions
                 (id, user_id, title, created_at, updated_at, message_count)
             VALUES (?, ?, ?, ?, ?, 0)",
        )
        .bind(id.to_string())
        .bind(self.user_id.to_string())
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
            "SELECT id, role, content, citations, created_at,
                    input_tokens, output_tokens, model
             FROM chat_messages
             WHERE session_id = ? AND user_id = ?
             ORDER BY created_at ASC",
        )
        .bind(session_id.to_string())
        .bind(self.user_id.to_string())
        .fetch_all(&self.pool)
        .await
        .map_err(box_err)?;

        rows.into_iter()
            .map(|row| -> Result<MessageRecord, SessionError> {
                let input: i32 = row.try_get("input_tokens").map_err(box_err)?;
                let output: i32 = row.try_get("output_tokens").map_err(box_err)?;
                let citations: serde_json::Value = row.try_get("citations").map_err(box_err)?;
                Ok(MessageRecord {
                    id: row.try_get("id").map_err(box_err)?,
                    role: row.try_get("role").map_err(box_err)?,
                    content: row.try_get("content").map_err(box_err)?,
                    citations_json: citations.to_string(),
                    created_at: row.try_get("created_at").map_err(box_err)?,
                    input_tokens: input as u32,
                    output_tokens: output as u32,
                    model: row.try_get("model").map_err(box_err)?,
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
             WHERE session_id = ? AND user_id = ?
             ORDER BY created_at ASC",
        )
        .bind(session_id.to_string())
        .bind(self.user_id.to_string())
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
        let now = Utc::now().timestamp_millis();
        sqlx::query(
            "INSERT INTO chat_messages
                 (id, session_id, user_id, role, content, citations, created_at)
             VALUES (?, ?, ?, 'user', ?, JSON_ARRAY(), ?)",
        )
        .bind(id)
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
        let now = Utc::now().timestamp_millis();
        let citations: serde_json::Value =
            serde_json::from_str(citations_json).unwrap_or_else(|_| serde_json::json!([]));

        sqlx::query(
            "INSERT INTO chat_messages
                 (id, session_id, user_id, role, content, citations, created_at,
                  input_tokens, output_tokens, model)
             VALUES (?, ?, ?, 'assistant', ?, ?, ?, ?, ?, ?)",
        )
        .bind(id)
        .bind(session_id.to_string())
        .bind(self.user_id.to_string())
        .bind(content)
        .bind(&citations)
        .bind(now)
        .bind(input_tokens as i32)
        .bind(output_tokens as i32)
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
        let now = Utc::now().timestamp_millis();
        sqlx::query(
            "UPDATE chat_sessions
             SET message_count = message_count + 1, updated_at = ?
             WHERE id = ? AND user_id = ?",
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
        sqlx::query("UPDATE chat_sessions SET title = ? WHERE id = ? AND user_id = ?")
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
        sqlx::query("DELETE FROM chat_messages WHERE session_id = ? AND user_id = ?")
            .bind(&id)
            .bind(&uid)
            .execute(&self.pool)
            .await
            .map_err(box_err)?;
        sqlx::query(
            "DELETE FROM user_ui_preferences
             WHERE user_id = ? AND preference_key IN (?, ?)",
        )
        .bind(&uid)
        .bind(chat_summary_key(session_id))
        .bind(edit_history_key(session_id))
        .execute(&self.pool)
        .await
        .map_err(box_err)?;
        sqlx::query("DELETE FROM chat_sessions WHERE id = ? AND user_id = ?")
            .bind(&id)
            .bind(&uid)
            .execute(&self.pool)
            .await
            .map_err(box_err)?;
        Ok(())
    }

    async fn pin_session(&self, session_id: Uuid, pinned: bool) -> Result<(), SessionError> {
        sqlx::query("UPDATE chat_sessions SET pinned = ? WHERE id = ? AND user_id = ?")
            .bind(pinned as i8)
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
                    SUM(input_tokens)  AS total_in,
                    SUM(output_tokens) AS total_out
             FROM chat_messages
             WHERE user_id = ? AND role = 'assistant' AND model != ''
             GROUP BY model
             ORDER BY total_in DESC",
        )
        .bind(self.user_id.to_string())
        .fetch_all(&self.pool)
        .await
        .map_err(box_err)?;

        let by_model: Vec<ModelUsage> = model_rows
            .into_iter()
            .map(|row| -> Result<ModelUsage, SessionError> {
                let total_in: i64 = row.try_get("total_in").map_err(box_err)?;
                let total_out: i64 = row.try_get("total_out").map_err(box_err)?;
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
            "SELECT id, COALESCE(title, 'Untitled') AS title,
                    total_input_tokens, total_output_tokens, updated_at
             FROM chat_sessions
             WHERE user_id = ?
               AND (total_input_tokens > 0 OR total_output_tokens > 0)
             ORDER BY updated_at DESC",
        )
        .bind(self.user_id.to_string())
        .fetch_all(&self.pool)
        .await
        .map_err(box_err)?;

        let sessions: Vec<SessionTokenUsage> = session_rows
            .into_iter()
            .map(|row| -> Result<SessionTokenUsage, SessionError> {
                let total_in: i32 = row.try_get("total_input_tokens").map_err(box_err)?;
                let total_out: i32 = row.try_get("total_output_tokens").map_err(box_err)?;
                Ok(SessionTokenUsage {
                    session_id: row.try_get("id").map_err(box_err)?,
                    title: row.try_get("title").map_err(box_err)?,
                    input_tokens: total_in as u32,
                    output_tokens: total_out as u32,
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
        .bind(self.user_id.to_string())
        .fetch_all(&self.pool)
        .await
        .map_err(box_err)?;

        let by_embedding_model: Vec<EmbeddingModelUsage> = emb_rows
            .into_iter()
            .map(|row| -> Result<EmbeddingModelUsage, SessionError> {
                let total: i64 = row.try_get("total_tokens").map_err(box_err)?;
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
        let now = Utc::now().timestamp_millis();
        sqlx::query(
            "INSERT INTO embedding_calls
                 (id, user_id, model, tokens, task_id, task_type, session_id, document_id, paragraph_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
             ON DUPLICATE KEY UPDATE
                 task_id = VALUES(task_id),
                 status = VALUES(status),
                 expected_chunks = VALUES(expected_chunks),
                 embedded_chunks = VALUES(embedded_chunks),
                 last_error = VALUES(last_error),
                 updated_at = VALUES(updated_at),
                 last_indexed_at = VALUES(last_indexed_at)",
        )
        .bind(self.user_id.to_string())
        .bind(status.document_id.to_string())
        .bind(status.task_id.as_deref())
        .bind(&status.status)
        .bind(status.expected_chunks as i32)
        .bind(status.embedded_chunks as i32)
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
}
