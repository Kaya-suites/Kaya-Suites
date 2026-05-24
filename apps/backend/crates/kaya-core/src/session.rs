//! SessionStorage trait and domain types for chat sessions and messages.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A chat session.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: Uuid,
    pub title: String,
    /// Unix epoch milliseconds.
    pub created_at: i64,
    /// Unix epoch milliseconds.
    pub updated_at: i64,
    pub message_count: u32,
    pub total_input_tokens: u32,
    pub total_output_tokens: u32,
    pub pinned: bool,
}

/// A persisted chat message.
#[derive(Debug, Clone)]
pub struct MessageRecord {
    pub id: String,
    pub role: String,
    pub content: String,
    /// JSON array string of citation objects.
    pub citations_json: String,
    /// Unix epoch milliseconds.
    pub created_at: i64,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub model: String,
}

/// A persisted summary of older chat history for a session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatHistorySummary {
    pub summary: String,
    pub covered_message_count: u32,
    pub updated_at: i64,
}

/// A persisted edit-history entry for a session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditHistoryEntry {
    pub edit_id: String,
    pub kind: String,
    pub status: String,
    pub summary: String,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Token usage aggregated across all sessions.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSummary {
    pub total_input_tokens: u32,
    pub total_output_tokens: u32,
    pub by_model: Vec<ModelUsage>,
    pub sessions: Vec<SessionTokenUsage>,
    pub total_embedding_tokens: u32,
    pub by_embedding_model: Vec<EmbeddingModelUsage>,
}

/// Per-model token breakdown.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsage {
    pub model: String,
    pub input_tokens: u32,
    pub output_tokens: u32,
}

/// Per-embedding-model token breakdown.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingModelUsage {
    pub model: String,
    pub tokens: u32,
}

/// Metadata recorded for a single embedding API call.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingCall {
    pub model: String,
    pub tokens: u32,
    pub task_id: Option<String>,
    pub task_type: String,
    pub session_id: Option<Uuid>,
    pub document_id: Option<Uuid>,
    pub paragraph_id: Option<String>,
}

/// Current embedding/indexing state for a document.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentEmbeddingStatus {
    pub document_id: Uuid,
    pub task_id: Option<String>,
    pub status: String,
    pub expected_chunks: u32,
    pub embedded_chunks: u32,
    pub last_error: Option<String>,
    pub updated_at: i64,
    pub last_indexed_at: Option<i64>,
}

/// Persisted UI state for the folder sidebar.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderSidebarState {
    pub expanded_folder_ids: Vec<String>,
}

/// Per-session token totals (for the usage table).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTokenUsage {
    pub session_id: String,
    pub title: String,
    pub input_tokens: u32,
    pub output_tokens: u32,
    /// Unix epoch milliseconds.
    pub updated_at: i64,
}

/// Error type for session storage operations.
#[derive(Debug, thiserror::Error)]
pub enum SessionError {
    #[error("session not found: {0}")]
    NotFound(Uuid),
    #[error("backend error: {0}")]
    Backend(#[from] Box<dyn std::error::Error + Send + Sync>),
}

/// Abstracts over SQLite (OSS) and Postgres (cloud) session backends.
#[async_trait]
pub trait SessionStorage: Send + Sync {
    async fn list_sessions(&self) -> Result<Vec<Session>, SessionError>;
    async fn create_session(&self, title: Option<String>) -> Result<Session, SessionError>;
    async fn get_messages(&self, session_id: Uuid) -> Result<Vec<MessageRecord>, SessionError>;
    /// Return (role, content) pairs ordered oldest-first for LLM context.
    async fn get_prior_messages(
        &self,
        session_id: Uuid,
    ) -> Result<Vec<(String, String)>, SessionError>;
    /// Return the rolling summary of older messages for prompt context.
    async fn get_chat_summary(
        &self,
        _session_id: Uuid,
    ) -> Result<Option<ChatHistorySummary>, SessionError> {
        Ok(None)
    }
    /// Persist the rolling summary of older messages for prompt context.
    async fn save_chat_summary(
        &self,
        _session_id: Uuid,
        _summary: &ChatHistorySummary,
    ) -> Result<(), SessionError> {
        Ok(())
    }
    /// Return the most recent edit-history entries for prompt context.
    async fn get_recent_edit_history(
        &self,
        _session_id: Uuid,
        _limit: usize,
    ) -> Result<Vec<EditHistoryEntry>, SessionError> {
        Ok(vec![])
    }
    /// Persist or update an edit-history entry for prompt context.
    async fn upsert_edit_history_entry(
        &self,
        _session_id: Uuid,
        _entry: &EditHistoryEntry,
    ) -> Result<(), SessionError> {
        Ok(())
    }
    async fn save_user_message(
        &self,
        session_id: Uuid,
        id: &str,
        content: &str,
    ) -> Result<(), SessionError>;
    async fn save_assistant_message(
        &self,
        session_id: Uuid,
        id: &str,
        content: &str,
        citations_json: &str,
        input_tokens: u32,
        output_tokens: u32,
        model: &str,
    ) -> Result<(), SessionError>;
    async fn get_usage_summary(&self) -> Result<UsageSummary, SessionError>;
    /// Record a single embedding API call (tokens used, model name).
    async fn save_embedding_call(&self, call: &EmbeddingCall) -> Result<(), SessionError>;
    /// Update the current indexing/embedding status for a document.
    async fn upsert_document_embedding_status(
        &self,
        status: &DocumentEmbeddingStatus,
    ) -> Result<(), SessionError>;
    /// Load the user's folder sidebar expansion state.
    async fn get_folder_sidebar_state(&self) -> Result<Option<FolderSidebarState>, SessionError> {
        Ok(None)
    }
    /// Persist the user's folder sidebar expansion state.
    async fn save_folder_sidebar_state(
        &self,
        _state: &FolderSidebarState,
    ) -> Result<(), SessionError> {
        Ok(())
    }
    /// Update the session's `updated_at` timestamp (and `message_count` where tracked).
    async fn touch_session(&self, session_id: Uuid) -> Result<(), SessionError>;
    /// Rename the session, replacing its current title.
    async fn rename_session(&self, session_id: Uuid, title: String) -> Result<(), SessionError>;
    /// Delete the session and all its messages.
    async fn delete_session(&self, session_id: Uuid) -> Result<(), SessionError>;
    /// Set the pinned flag on a session.
    async fn pin_session(&self, session_id: Uuid, pinned: bool) -> Result<(), SessionError>;
}
