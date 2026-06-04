//! Researcher agent — RAG pipeline that produces a [`ResearchResult`].
//!
//! The Researcher runs a single hybrid retrieval pass (vector + BM25 → RRF)
//! via [`crate::retrieval::retrieve`], then makes one synthesis LLM call to
//! produce a grounded summary. The summary is passed verbatim to the Editor
//! as its system-prompt context.
//!
//! This replaces the earlier multi-turn tool-call loop with a deterministic,
//! single-step pipeline: embed query → retrieve top-K chunks → synthesise.

use std::sync::Arc;
use std::time::Instant;

use chrono::Utc;
use futures::SinkExt;
use futures::channel::mpsc;
use serde_json::json;
use uuid::Uuid;

use crate::agent::log::{InvocationLog, ToolInvocation};
use crate::agent::tool::Tool;
use crate::agent::tools::SearchDirectories;
use crate::agent::turn_context::TurnContext;
use crate::agent::{AgentContext, AgentEvent};
use crate::error::KayaError;
use crate::model_router::{ChatMessage, OperationType};
use crate::retrieval::{self, EmbeddingTaskContext, RetrievalResult};

use super::orchestrator::AgentPlan;

// ── Result types ──────────────────────────────────────────────────────────────

/// A single chunk retrieved by the Researcher's RAG pass.
#[derive(Debug, Clone)]
pub struct RetrievedChunk {
    pub doc_id: Uuid,
    pub paragraph_id: String,
    pub excerpt: String,
}

/// A stale reference found during research (reserved for future use).
#[derive(Debug, Clone)]
pub struct StaleRef {
    pub doc_id: Uuid,
    pub reference_text: String,
}

/// Output of a completed Researcher run. Passed directly to the Editor.
///
/// `summary_context` is injected verbatim into the Editor's system prompt as
/// grounding context. The other fields are available for future tooling.
#[derive(Debug, Clone)]
pub struct ResearchResult {
    pub chunks: Vec<RetrievedChunk>,
    pub cited_doc_ids: Vec<Uuid>,
    pub stale_refs: Vec<StaleRef>,
    /// Structured folder search output passed through to the Editor verbatim.
    pub directory_context: serde_json::Value,
    /// The Researcher's synthesised answer — injected into the Editor's prompt.
    pub summary_context: String,
}

// ── Agent ─────────────────────────────────────────────────────────────────────

pub struct Researcher {
    top_k: usize,
}

impl Researcher {
    /// Construct a Researcher. Fetches `top_k` chunks from the hybrid index
    /// (default 10). No write-capable tools are involved.
    pub fn new() -> Self {
        Self { top_k: 10 }
    }

    pub fn with_top_k(mut self, k: usize) -> Self {
        self.top_k = k;
        self
    }

    /// Run the RAG pipeline for `plan`, emitting [`AgentEvent`]s to `tx`.
    ///
    /// Steps:
    /// 1. Emit a synthetic `ToolCall` so the SSE stream shows the search.
    /// 2. Call `retrieval::retrieve` (vector + BM25 + RRF).
    /// 3. Emit a `ToolResult` with the ranked chunks.
    /// 4. Make one `ResearchSynthesis` LLM call to produce a grounded summary.
    /// 5. Emit `Usage` + `FinalMessage`, then return [`ResearchResult`].
    pub async fn research(
        &self,
        plan: &AgentPlan,
        ctx: Arc<AgentContext>,
        log: Arc<InvocationLog>,
        mut tx: mpsc::Sender<Result<AgentEvent, KayaError>>,
    ) -> Result<ResearchResult, KayaError> {
        let query = match plan {
            AgentPlan::ResearchOnly { query } => query.as_str(),
            AgentPlan::ResearchThenEdit { query, .. } => query.as_str(),
        };

        let search_input = json!({ "query": query, "limit": self.top_k });

        let _ = tx
            .send(Ok(AgentEvent::ToolCall {
                name: "search_documents".into(),
                input: search_input.clone(),
            }))
            .await;

        let turn_id = Uuid::new_v4();
        let started_at = Utc::now();
        let t0 = Instant::now();

        let directory_input = json!({ "query": query, "limit": self.top_k });
        let _ = tx
            .send(Ok(AgentEvent::ToolCall {
                name: "search_directories".into(),
                input: directory_input.clone(),
            }))
            .await;

        let directory_started_at = Utc::now();
        let directory_t0 = Instant::now();
        let directory_output = SearchDirectories
            .invoke(directory_input.clone(), ctx.as_ref())
            .await
            .unwrap_or_else(|e| {
                crate::agent::tool::ToolOutput::value(json!({
                    "error": e.to_string(),
                    "query": query,
                    "folders": [],
                }))
            });
        let directory_latency_ms = directory_t0.elapsed().as_millis() as u64;

        log.record(ToolInvocation {
            id: Uuid::new_v4(),
            turn_id,
            tool_name: "search_directories".into(),
            input: directory_input,
            output: Ok(directory_output.content.clone()),
            latency_ms: directory_latency_ms,
            started_at: directory_started_at,
        });

        let _ = tx
            .send(Ok(AgentEvent::ToolResult {
                name: "search_directories".into(),
                output: directory_output.content.clone(),
                latency_ms: directory_latency_ms,
            }))
            .await;

        let hits: Vec<RetrievalResult> = retrieval::retrieve(
            query,
            self.top_k,
            &ctx.storage,
            &ctx.router,
            Some(ctx.sessions.as_ref()),
            Some(&EmbeddingTaskContext {
                task_id: Some(turn_id.to_string()),
                task_type: "agent_research".to_string(),
                session_id: None,
                document_id: None,
            }),
        )
        .await
        .unwrap_or_default();

        let latency_ms = t0.elapsed().as_millis() as u64;

        // Build chunk list and output JSON for the log + ToolResult event.
        let mut chunks: Vec<RetrievedChunk> = Vec::new();
        let results_json: Vec<serde_json::Value> = hits
            .iter()
            .map(|h| {
                chunks.push(RetrievedChunk {
                    doc_id: h.document_id,
                    paragraph_id: h.paragraph_id.clone(),
                    excerpt: h.content.clone(),
                });
                json!({
                    "doc_id": h.document_id,
                    "paragraph_id": h.paragraph_id,
                    "content": h.content,
                    "score": h.score,
                })
            })
            .collect();

        let output_json = json!({ "documents": results_json });

        log.record(ToolInvocation {
            id: Uuid::new_v4(),
            turn_id,
            tool_name: "search_documents".into(),
            input: search_input,
            output: Ok(output_json.clone()),
            latency_ms,
            started_at,
        });

        let _ = tx
            .send(Ok(AgentEvent::ToolResult {
                name: "search_documents".into(),
                output: output_json,
                latency_ms,
            }))
            .await;

        // Single synthesis call — grounded on retrieved chunks.
        let synthesis_messages =
            build_synthesis_messages(query, &hits, &directory_output.content, &ctx.turn);

        let synthesis_resp = match ctx
            .router
            .complete(OperationType::ResearchSynthesis, synthesis_messages)
            .await
        {
            Ok(r) => r,
            Err(e) => {
                let _ = tx.send(Err(e)).await;
                return Err(KayaError::Internal("researcher synthesis failed".into()));
            }
        };

        let summary_context = if synthesis_resp.content.trim().is_empty() {
            if hits.is_empty() {
                "No relevant documents found in the knowledge base.".to_owned()
            } else {
                format!("Found {} relevant chunks.", hits.len())
            }
        } else {
            synthesis_resp.content.clone()
        };

        let _ = tx
            .send(Ok(AgentEvent::Usage {
                input_tokens: synthesis_resp.usage.input_tokens,
                output_tokens: synthesis_resp.usage.output_tokens,
                model: synthesis_resp.usage.model.clone(),
            }))
            .await;

        let _ = tx
            .send(Ok(AgentEvent::FinalMessage {
                text: summary_context.clone(),
            }))
            .await;

        let cited_doc_ids: Vec<Uuid> = chunks
            .iter()
            .map(|c| c.doc_id)
            .collect::<std::collections::HashSet<_>>()
            .into_iter()
            .collect();

        Ok(ResearchResult {
            chunks,
            cited_doc_ids,
            stale_refs: vec![],
            directory_context: directory_output.content,
            summary_context,
        })
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn build_synthesis_messages(
    query: &str,
    hits: &[RetrievalResult],
    directories: &serde_json::Value,
    turn: &TurnContext,
) -> Vec<ChatMessage> {
    let directory_text = serde_json::to_string_pretty(directories)
        .unwrap_or_else(|_| "{\"folders\":[]}".to_string());

    // Document block goes at the front so it can become a stable cache prefix.
    // Chat block goes after, since it changes every turn.
    let document_block = turn
        .format_document_block()
        .map(|s| format!("## Open document\n{s}\n\n"))
        .unwrap_or_default();
    let chat_block = turn
        .format_chat_block()
        .map(|s| format!("## Conversation context\n{s}\n\n"))
        .unwrap_or_default();

    let user_content = if hits.is_empty() {
        format!(
            "{document_block}\
             {chat_block}\
             Query: {query}\n\n\
             Current directory context:\n{directory_text}\n\n\
             No relevant documents were found in the knowledge base. \
             Answer based on what you know, or indicate the information is unavailable."
        )
    } else {
        let chunks_text = hits
            .iter()
            .enumerate()
            .map(|(i, h)| {
                format!(
                    "[{}] doc_id={} para_id={}\n{}",
                    i + 1,
                    h.document_id,
                    h.paragraph_id,
                    h.content
                )
            })
            .collect::<Vec<_>>()
            .join("\n\n");

        format!(
            "{document_block}\
             {chat_block}\
             Query: {query}\n\n\
             Current directory context:\n{directory_text}\n\n\
             Retrieved chunks (ranked by relevance):\n\n\
             {chunks_text}\n\n\
             Write a comprehensive answer grounded in the chunks above. \
             When directory structure is relevant, use the directory context above rather than \
             inferring folder IDs or paths from stale document references. \
             Cite sources inline using [[doc_id:para_id]] immediately after each \
             cited sentence. Do not propose or apply any edits — only summarise."
        )
    };

    vec![
        ChatMessage::system("You are a research assistant synthesising knowledge-base content."),
        ChatMessage::user(user_content),
    ]
}
