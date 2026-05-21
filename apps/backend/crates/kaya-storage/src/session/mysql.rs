//! MySQL-backed [`SessionStorage`] implementation.

use async_trait::async_trait;
use chrono::Utc;
use kaya_core::session::{
    EmbeddingModelUsage, MessageRecord, ModelUsage, Session, SessionError, SessionStorage,
    SessionTokenUsage, UsageSummary,
};
use sqlx::{MySqlPool, Row};
use uuid::Uuid;

/// MySQL session storage scoped to a single user.
pub struct MySqlSessionStorage {
    pool: MySqlPool,
    user_id: Uuid,
}

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
                id         VARCHAR(36)  NOT NULL,
                user_id    VARCHAR(36)  NOT NULL,
                model      VARCHAR(200) NOT NULL,
                tokens     INT          NOT NULL DEFAULT 0,
                created_at BIGINT       NOT NULL,
                PRIMARY KEY (id),
                KEY idx_embedding_calls_user (user_id)
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
                let id = Uuid::parse_str(&id_str).map_err(|e| SessionError::Backend(Box::new(e)))?;
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
        sqlx::query(
            "UPDATE chat_sessions SET title = ? WHERE id = ? AND user_id = ?",
        )
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
        sqlx::query("DELETE FROM chat_sessions WHERE id = ? AND user_id = ?")
            .bind(&id)
            .bind(&uid)
            .execute(&self.pool)
            .await
            .map_err(box_err)?;
        Ok(())
    }

    async fn pin_session(&self, session_id: Uuid, pinned: bool) -> Result<(), SessionError> {
        sqlx::query(
            "UPDATE chat_sessions SET pinned = ? WHERE id = ? AND user_id = ?",
        )
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

    async fn save_embedding_call(&self, model: &str, tokens: u32) -> Result<(), SessionError> {
        let now = Utc::now().timestamp_millis();
        sqlx::query(
            "INSERT INTO embedding_calls (id, user_id, model, tokens, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(self.user_id.to_string())
        .bind(model)
        .bind(tokens as i32)
        .bind(now)
        .execute(&self.pool)
        .await
        .map_err(box_err)?;
        Ok(())
    }
}
