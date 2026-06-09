use kaya_core::ProposedEdit;
use serde::{Deserialize, Serialize};

/// An edit waiting for user approval.
///
/// Held in an in-memory `HashMap` as the hot path (no DB round-trip during
/// SSE streaming) and mirrored to `SessionStorage::save_pending_edit` so the
/// approval still works after a server restart.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredEdit {
    pub session_id: uuid::Uuid,
    /// ID of the assistant chat message this proposal belongs to. Used to
    /// persist status updates back into `chat_messages.proposals`.
    pub message_id: String,
    pub edit: ProposedEdit,
    pub doc_title: String,
    pub first_paragraph_id: String,
    pub original_paragraph: String,
    pub proposed_paragraph: String,
}
