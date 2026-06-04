pub mod anthropic;
pub mod gemini;
pub mod openai;

#[cfg(test)]
pub mod mock;

use super::ChatMessage;

/// Split a message list into an optional system preamble and a concatenated
/// user/assistant body for providers that accept a single prompt string.
pub(super) fn messages_to_parts(messages: &[ChatMessage]) -> (Option<String>, String) {
    let system = messages.iter().find_map(|m| {
        if let ChatMessage::System(s) = m {
            Some(s.clone())
        } else {
            None
        }
    });
    let body = messages
        .iter()
        .filter_map(|m| match m {
            ChatMessage::User(s) => Some(format!("User: {s}")),
            ChatMessage::Assistant(s) => Some(format!("Assistant: {s}")),
            ChatMessage::System(_) => None,
        })
        .collect::<Vec<_>>()
        .join("\n");
    (system, body)
}
