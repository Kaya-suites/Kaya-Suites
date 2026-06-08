use kaya_core::ProposedEdit;

/// An edit waiting for user approval, stored in memory between the SSE stream
/// and the approve endpoint.
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
