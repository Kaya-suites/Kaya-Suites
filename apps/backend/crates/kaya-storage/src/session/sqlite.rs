//! SQLite-backed [`SessionStorage`] implementation.

use async_trait::async_trait;
use chrono::Utc;
use kaya_core::session::{
    EmbeddingModelUsage, MessageRecord, ModelUsage, Session, SessionError, SessionStorage,
    SessionTokenUsage, UsageSummary,
};
use sqlx::{Row, SqlitePool};
use uuid::Uuid;

/// SQLite session storage for the OSS single-user binary.
pub struct SqliteSessionStorage {
    pool: SqlitePool,
}

impl SqliteSessionStorage {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    /// Create (or upgrade) the `chat_sessions` and `chat_messages` tables.
    ///
    /// Idempotent. Handles databases that were created under the old
    /// `sessions`/`messages` table names by renaming them first.
    pub async fn run_migrations(pool: &SqlitePool) -> Result<(), sqlx::Error> {
        // Rename legacy tables if they still exist under the old names.
        let _ = sqlx::query("ALTER TABLE sessions RENAME TO chat_sessions")
            .execute(pool)
            .await;
        let _ = sqlx::query("ALTER TABLE messages RENAME TO chat_messages")
            .execute(pool)
            .await;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS chat_sessions (
                id                  TEXT    PRIMARY KEY,
                title               TEXT    NOT NULL,
                created_at          INTEGER NOT NULL,
                updated_at          INTEGER NOT NULL,
                message_count       INTEGER NOT NULL DEFAULT 0,
                total_input_tokens  INTEGER NOT NULL DEFAULT 0,
                total_output_tokens INTEGER NOT NULL DEFAULT 0,
                pinned              INTEGER NOT NULL DEFAULT 0
            )",
        )
        .execute(pool)
        .await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS chat_messages (
                id            TEXT    PRIMARY KEY,
                session_id    TEXT    NOT NULL,
                role          TEXT    NOT NULL,
                content       TEXT    NOT NULL,
                citations     TEXT    NOT NULL DEFAULT '[]',
                created_at    INTEGER NOT NULL,
                input_tokens  INTEGER NOT NULL DEFAULT 0,
                output_tokens INTEGER NOT NULL DEFAULT 0,
                model         TEXT    NOT NULL DEFAULT ''
            )",
        )
        .execute(pool)
        .await?;

        // Add columns to databases that predate the token/pin features.
        for stmt in [
            "ALTER TABLE chat_sessions ADD COLUMN total_input_tokens INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE chat_sessions ADD COLUMN total_output_tokens INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE chat_sessions ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE chat_messages ADD COLUMN input_tokens INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE chat_messages ADD COLUMN output_tokens INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE chat_messages ADD COLUMN model TEXT NOT NULL DEFAULT ''",
        ] {
            let _ = sqlx::query(stmt).execute(pool).await;
        }

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS embedding_calls (
                id         TEXT    PRIMARY KEY,
                model      TEXT    NOT NULL,
                tokens     INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
            )",
        )
        .execute(pool)
        .await?;

        Ok(())
    }
}

fn box_err<E: std::error::Error + Send + Sync + 'static>(e: E) -> SessionError {
    SessionError::Backend(Box::new(e))
}

#[async_trait]
impl SessionStorage for SqliteSessionStorage {
    async fn list_sessions(&self) -> Result<Vec<Session>, SessionError> {
        let rows = sqlx::query(
            "SELECT id, title, created_at, updated_at, message_count,
                    total_input_tokens, total_output_tokens, pinned
             FROM chat_sessions ORDER BY pinned DESC, updated_at DESC",
        )
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

    async fn create_session(&self, title: Option<String>) -> Result<Session, SessionError> {
        let id = Uuid::new_v4();
        let now = Utc::now().timestamp_millis();
        let title = title.unwrap_or_else(|| "New conversation".to_string());

        sqlx::query(
            "INSERT INTO chat_sessions (id, title, created_at, updated_at, message_count)
             VALUES (?, ?, ?, ?, 0)",
        )
        .bind(id.to_string())
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
            "SELECT id, role, content, citations, created_at, input_tokens, output_tokens, model
             FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC",
        )
        .bind(session_id.to_string())
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
                    output_tokens: row
                        .try_get::<i64, _>("output_tokens")
                        .map_err(box_err)? as u32,
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
            "SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC",
        )
        .bind(session_id.to_string())
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

    async fn save_user_message(
        &self,
        session_id: Uuid,
        id: &str,
        content: &str,
    ) -> Result<(), SessionError> {
        let now = Utc::now().timestamp_millis();
        sqlx::query(
            "INSERT INTO chat_messages (id, session_id, role, content, citations, created_at)
             VALUES (?, ?, 'user', ?, '[]', ?)",
        )
        .bind(id)
        .bind(session_id.to_string())
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
                 (id, session_id, role, content, citations, created_at,
                  input_tokens, output_tokens, model)
             VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?, ?)",
        )
        .bind(id)
        .bind(session_id.to_string())
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
             WHERE id = ?",
        )
        .bind(input_tokens as i64)
        .bind(output_tokens as i64)
        .bind(session_id.to_string())
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
             WHERE id = ?",
        )
        .bind(now)
        .bind(session_id.to_string())
        .execute(&self.pool)
        .await
        .map_err(box_err)?;
        Ok(())
    }

    async fn rename_session(&self, session_id: Uuid, title: String) -> Result<(), SessionError> {
        sqlx::query("UPDATE chat_sessions SET title = ? WHERE id = ?")
            .bind(&title)
            .bind(session_id.to_string())
            .execute(&self.pool)
            .await
            .map_err(box_err)?;
        Ok(())
    }

    async fn delete_session(&self, session_id: Uuid) -> Result<(), SessionError> {
        let id = session_id.to_string();
        sqlx::query("DELETE FROM chat_messages WHERE session_id = ?")
            .bind(&id)
            .execute(&self.pool)
            .await
            .map_err(box_err)?;
        sqlx::query("DELETE FROM chat_sessions WHERE id = ?")
            .bind(&id)
            .execute(&self.pool)
            .await
            .map_err(box_err)?;
        Ok(())
    }

    async fn pin_session(&self, session_id: Uuid, pinned: bool) -> Result<(), SessionError> {
        sqlx::query("UPDATE chat_sessions SET pinned = ? WHERE id = ?")
            .bind(pinned as i64)
            .bind(session_id.to_string())
            .execute(&self.pool)
            .await
            .map_err(box_err)?;
        Ok(())
    }

    async fn save_embedding_call(&self, model: &str, tokens: u32) -> Result<(), SessionError> {
        let now = chrono::Utc::now().timestamp_millis();
        sqlx::query(
            "INSERT INTO embedding_calls (id, model, tokens, created_at) VALUES (?, ?, ?, ?)",
        )
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(model)
        .bind(tokens as i64)
        .bind(now)
        .execute(&self.pool)
        .await
        .map_err(box_err)?;
        Ok(())
    }

    async fn get_usage_summary(&self) -> Result<UsageSummary, SessionError> {
        let model_rows = sqlx::query(
            "SELECT model, SUM(input_tokens) AS total_in, SUM(output_tokens) AS total_out
             FROM chat_messages
             WHERE role = 'assistant' AND model != ''
             GROUP BY model
             ORDER BY total_in DESC",
        )
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
             WHERE total_input_tokens > 0 OR total_output_tokens > 0
             ORDER BY updated_at DESC",
        )
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
             WHERE model != ''
             GROUP BY model
             ORDER BY total_tokens DESC",
        )
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
