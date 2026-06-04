//! Conversation summarizer used to compress older chat history into a rolling
//! session summary for later prompt context.

use crate::error::KayaError;
use crate::model_router::{ChatMessage, ModelRouter, OperationType};

pub struct ConversationSummarizer;

impl ConversationSummarizer {
    pub fn new() -> Self {
        Self
    }

    pub async fn summarize(
        &self,
        router: &ModelRouter,
        messages: &[(String, String)],
    ) -> Result<String, KayaError> {
        if messages.is_empty() {
            return Ok(String::new());
        }

        let transcript = messages
            .iter()
            .map(|(role, content)| format!("{role}: {content}"))
            .collect::<Vec<_>>()
            .join("\n\n");

        let chat_messages = vec![
            ChatMessage::system(
                "Summarize the following Kaya chat history for future agent turns. \
                 Focus on user goals, confirmed facts, document decisions, unresolved questions, \
                 and any instructions that should remain in force. \
                 Keep it concise, accurate, and grounded only in the chat. \
                 Return plain text only.",
            ),
            ChatMessage::user(format!("Chat history:\n{transcript}")),
        ];

        let response = router.complete(OperationType::ResearchSynthesis, chat_messages).await?;
        Ok(response.content.trim().to_string())
    }
}
