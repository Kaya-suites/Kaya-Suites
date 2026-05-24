//! Staged agent system for Kaya Suites.
//!
//! The current chat flow is orchestrated in stages:
//! 1. The `Orchestrator` classifies the user's intent.
//! 2. The `Researcher` gathers read-only context and synthesizes a summary.
//! 3. The `Editor` optionally proposes write actions grounded in that summary.
//!
//! # Propose-then-approve invariant (FR-15)
//!
//! Tools that mutate storage (`create_document`, `propose_edit`) produce a
//! [`ProposedEdit`] wrapped in [`AgentEvent::ProposedEditEmitted`]. The edit is
//! *not* applied to storage until the caller obtains an [`ApprovalToken`] via
//! [`crate::auth::UserSession::approve_edit`] and calls
//! [`crate::edit::commit_edit`].

pub mod editor;
pub mod log;
pub mod orchestrator;
pub mod researcher;
pub mod summarizer;
pub mod tool;
pub mod tools;

pub use editor::Editor;
pub use log::{InvocationLog, ToolInvocation};
pub use orchestrator::{AgentPlan, OrchestratorContext, orchestrate};
pub use researcher::{ResearchResult, Researcher, RetrievedChunk, StaleRef};
pub use summarizer::ConversationSummarizer;
pub use tool::{ReadTool, Tool, ToolOutput, WriteTool};

// AgentSource and SourcedEvent are defined in this file — no re-export needed.

use std::sync::Arc;

use crate::auth::UserSession;
use crate::edit::ProposedEdit;
use crate::model_router::ModelRouter;
use crate::session::SessionStorage;
use crate::storage::StorageAdapter;

// ── Context ───────────────────────────────────────────────────────────────────

/// Shared context threaded through every tool invocation.
pub struct AgentContext {
    pub storage: Arc<dyn StorageAdapter>,
    pub sessions: Arc<dyn SessionStorage>,
    pub router: Arc<ModelRouter>,
    pub session: UserSession,
    pub conversation_context: Option<String>,
}

// ── Events ────────────────────────────────────────────────────────────────────

/// An event emitted by the agent loop stream.
#[derive(Debug, Clone)]
pub enum AgentEvent {
    /// Incremental reasoning text (emitted if the model streams thinking).
    ThinkingChunk { text: String },
    /// The model decided to call a tool.
    ToolCall {
        name: String,
        input: serde_json::Value,
    },
    /// A tool returned a result (or error).
    ToolResult {
        name: String,
        output: serde_json::Value,
        latency_ms: u64,
    },
    /// A tool produced a pending edit. The edit is *not* applied to storage
    /// until the caller approves it via [`crate::edit::commit_edit`].
    ProposedEditEmitted { edit: ProposedEdit },
    /// The model's final text response — the agent turn is complete.
    FinalMessage { text: String },
    /// Token counts for the completed turn, computed locally from message text.
    Usage {
        input_tokens: u32,
        output_tokens: u32,
        model: String,
    },
}

// ── Source tagging ────────────────────────────────────────────────────────────

/// Which agent produced an event (used for SSE transparency labelling).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentSource {
    Orchestrator,
    Researcher,
    Editor,
}

/// An [`AgentEvent`] annotated with the agent that produced it.
#[derive(Debug, Clone)]
pub struct SourcedEvent {
    pub source: AgentSource,
    pub event: AgentEvent,
}
