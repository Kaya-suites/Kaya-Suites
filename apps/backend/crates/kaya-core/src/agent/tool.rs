//! [`Tool`] trait and [`ToolOutput`] — the contract every agent tool implements.

use async_trait::async_trait;
use serde_json::Value;

use crate::edit::ProposedEdit;
use crate::error::KayaError;

use super::AgentContext;

/// The return value of a successful tool invocation.
pub struct ToolOutput {
    /// JSON-serialisable result forwarded to the model as the tool result.
    pub content: Value,
    /// A pending edit emitted by tools that propose document changes.
    /// The agent loop surfaces this as [`super::AgentEvent::ProposedEditEmitted`].
    pub proposed_edit: Option<ProposedEdit>,
}

impl ToolOutput {
    pub fn value(content: Value) -> Self {
        Self {
            content,
            proposed_edit: None,
        }
    }

    pub fn with_edit(content: Value, edit: ProposedEdit) -> Self {
        Self {
            content,
            proposed_edit: Some(edit),
        }
    }
}

/// A single callable capability exposed to the agent.
///
/// Tools are stateless — they receive all necessary context via [`AgentContext`]
/// at invocation time. Implementations must be `Send + Sync`.
#[async_trait]
pub trait Tool: Send + Sync {
    /// Stable snake_case identifier. Must match the name in [`schema`].
    fn name(&self) -> &'static str;

    /// One-sentence description used in the model's system prompt.
    fn description(&self) -> &'static str;

    /// JSON Schema for the tool's parameters (passed to the model as the tool
    /// definition). Must be a JSON object schema.
    fn schema(&self) -> Value;

    /// Execute the tool with `input` (already parsed arguments from the model).
    async fn invoke(&self, input: Value, ctx: &AgentContext) -> Result<ToolOutput, KayaError>;
}

/// Marker trait for tools that only read from the knowledge base.
/// Implemented by: `SearchDocuments`, `SearchDirectories`, `ReadDocument`,
/// `ListDocuments`, `FindStaleReferences`.
///
/// `Researcher` accepts only `Vec<Arc<dyn ReadTool>>` — passing a write tool
/// is a compile error.
pub trait ReadTool: Tool {}

/// Marker trait for tools that propose writes to the knowledge base.
/// Implemented by: `CreateDocument`, `CreateFolder`, `ProposeEdit`,
/// `UpdateDocument`, `DeleteDocument`.
///
/// `Editor` accepts only `Vec<Arc<dyn WriteTool>>` — passing a read tool
/// is a compile error.
pub trait WriteTool: Tool {}
