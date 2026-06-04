//! Structured per-turn context for the agent pipeline.
//!
//! Replaces the earlier flat `Option<String>` blob with a typed split between
//! chat-context (summary + recent messages + recent edits) and document-focus
//! (the currently open document in the editor). This separation lets the
//! Orchestrator's intent classifier see only `{doc_id, title}` while the
//! Researcher and Editor still receive the full body, and creates a stable
//! prompt-prefix shape for future prompt caching (see TODO.md).

use uuid::Uuid;

use crate::session::EditHistoryEntry;

/// Top-level per-turn context.
#[derive(Debug, Clone, Default)]
pub struct TurnContext {
    pub chat: Option<ChatContext>,
    pub document: Option<DocumentFocus>,
}

/// Chat-side context: rolling summary plus the freshest messages and edits.
#[derive(Debug, Clone, Default)]
pub struct ChatContext {
    pub summary: Option<String>,
    /// Most recent `(role, content)` pairs in chronological order.
    pub recent_messages: Vec<(String, String)>,
    pub recent_edits: Vec<EditHistoryEntry>,
}

/// The document currently open in the editor.
#[derive(Debug, Clone)]
pub struct DocumentFocus {
    pub doc_id: Uuid,
    pub title: String,
    pub body: String,
    pub tags: Vec<String>,
}

impl TurnContext {
    /// Render the chat-side block for prompt injection. Returns `None` when
    /// there is nothing to render so callers can omit the section cleanly.
    pub fn format_chat_block(&self) -> Option<String> {
        let chat = self.chat.as_ref()?;
        let mut sections: Vec<String> = Vec::new();

        if let Some(summary) = chat.summary.as_deref().filter(|s| !s.trim().is_empty()) {
            sections.push(format!("Chat summary:\n{summary}"));
        }

        if !chat.recent_messages.is_empty() {
            let rendered = chat
                .recent_messages
                .iter()
                .map(|(role, content)| format!("{role}: {content}"))
                .collect::<Vec<_>>()
                .join("\n\n");
            sections.push(format!(
                "Recent messages (last {}):\n{rendered}",
                chat.recent_messages.len()
            ));
        }

        if !chat.recent_edits.is_empty() {
            let rendered = chat
                .recent_edits
                .iter()
                .map(|entry| format!("- [{}] {}", entry.status, entry.summary))
                .collect::<Vec<_>>()
                .join("\n");
            sections.push(format!(
                "Recent edits (last {}):\n{rendered}",
                chat.recent_edits.len()
            ));
        }

        if sections.is_empty() {
            None
        } else {
            Some(sections.join("\n\n"))
        }
    }

    /// Render the full document block — body included — for prompt injection
    /// in the Researcher and Editor. Returns `None` when no document is open.
    ///
    /// The format is stable so a future prompt-cache breakpoint can sit at the
    /// boundary between this block and the variable chat tail.
    pub fn format_document_block(&self) -> Option<String> {
        let doc = self.document.as_ref()?;
        let tags = if doc.tags.is_empty() {
            "(none)".to_string()
        } else {
            doc.tags.join(", ")
        };
        Some(format!(
            "Open document: \"{title}\" (id={id})\nTags: {tags}\n\n```markdown\n{body}\n```",
            title = doc.title,
            id = doc.doc_id,
            tags = tags,
            body = doc.body,
        ))
    }

    /// Render a body-free one-liner for the Orchestrator classifier.
    pub fn format_document_handle(&self) -> Option<String> {
        let doc = self.document.as_ref()?;
        Some(format!(
            "Open document: \"{}\" (id={})",
            doc.title, doc.doc_id
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_turn_renders_nothing() {
        let turn = TurnContext::default();
        assert!(turn.format_chat_block().is_none());
        assert!(turn.format_document_block().is_none());
        assert!(turn.format_document_handle().is_none());
    }

    #[test]
    fn document_only_renders_document_blocks() {
        let turn = TurnContext {
            chat: None,
            document: Some(DocumentFocus {
                doc_id: Uuid::nil(),
                title: "Spec".to_string(),
                body: "Hello world.".to_string(),
                tags: vec!["draft".to_string()],
            }),
        };
        assert!(turn.format_chat_block().is_none());
        let block = turn.format_document_block().unwrap();
        assert!(block.contains("Hello world."));
        assert!(block.contains("Spec"));
        assert!(block.contains("draft"));

        let handle = turn.format_document_handle().unwrap();
        assert!(handle.contains("Spec"));
        assert!(!handle.contains("Hello world."));
    }

    #[test]
    fn chat_only_renders_chat_block() {
        let turn = TurnContext {
            chat: Some(ChatContext {
                summary: Some("Older messages were about X.".to_string()),
                recent_messages: vec![
                    ("user".to_string(), "hi".to_string()),
                    ("assistant".to_string(), "hello".to_string()),
                ],
                recent_edits: vec![],
            }),
            document: None,
        };
        assert!(turn.format_document_block().is_none());
        let chat_block = turn.format_chat_block().unwrap();
        assert!(chat_block.contains("Older messages were about X."));
        assert!(chat_block.contains("user: hi"));
        assert!(chat_block.contains("Recent messages (last 2)"));
    }

    #[test]
    fn empty_chat_context_renders_nothing() {
        let turn = TurnContext {
            chat: Some(ChatContext::default()),
            document: None,
        };
        assert!(turn.format_chat_block().is_none());
    }
}
