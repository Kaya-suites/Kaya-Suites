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
use crate::agent::{AgentContext, AgentEvent};
use crate::error::KayaError;
use crate::model_router::OperationType;
use crate::retrieval::{self, RetrievalResult};

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

        let hits: Vec<RetrievalResult> =
            retrieval::retrieve(query, self.top_k, &ctx.storage, &ctx.router, Some(ctx.sessions.as_ref()))
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
        let synthesis_prompt = build_synthesis_prompt(query, &hits);

        let synthesis_resp = match ctx
            .router
            .complete(OperationType::ResearchSynthesis, synthesis_prompt)
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
            summary_context,
        })
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn build_synthesis_prompt(query: &str, hits: &[RetrievalResult]) -> String {
    if hits.is_empty() {
        return format!(
            "Query: {query}\n\n\
             No relevant documents were found in the knowledge base. \
             Answer based on what you know, or indicate the information is unavailable."
        );
    }

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
        "You are a research assistant synthesising knowledge-base content.\n\n\
         Query: {query}\n\n\
         Retrieved chunks (ranked by relevance):\n\n\
         {chunks_text}\n\n\
         Write a comprehensive answer grounded in the chunks above. \
         Cite sources inline using [[doc_id:para_id]] immediately after each \
         cited sentence. Do not propose or apply any edits — only summarise."
    )
}
