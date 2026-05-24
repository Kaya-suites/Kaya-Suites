//! Orchestrator — the new entry point for the agent system.
//!
//! `orchestrate(msg, ctx)` is the chat entry point used by the HTTP handler. It:
//!
//! 1. Classifies the user message into an [`AgentPlan`] via a single fast model
//!    call (`OperationType::IntentClassification`).
//! 2. Spawns the [`Researcher`] and streams its events tagged
//!    [`AgentSource::Researcher`].
//! 3. For `ResearchThenEdit` plans, passes the [`ResearchResult`] to the
//!    [`Editor`] and streams its events tagged [`AgentSource::Editor`].
//!
//! The Orchestrator does not call any tools itself. If classification fails or
//! returns an unrecognised intent it falls back to `ResearchOnly` and logs a
//! warning.

use std::sync::Arc;

use futures::channel::mpsc;
use futures::stream::BoxStream;
use futures::{SinkExt, StreamExt};

use crate::agent::editor::Editor;
use crate::agent::log::InvocationLog;
use crate::agent::researcher::Researcher;
use crate::agent::tools::write_tools;
use crate::agent::{AgentContext, AgentEvent, AgentSource, SourcedEvent};
use crate::auth::UserSession;
use crate::error::KayaError;
use crate::model_router::{ModelRouter, OperationType};
use crate::session::SessionStorage;
use crate::storage::StorageAdapter;

// ── Context ───────────────────────────────────────────────────────────────────

/// Shared context for an orchestrated agent turn. Has the same fields as
/// [`AgentContext`] so sub-agent contexts can be constructed cheaply.
pub struct OrchestratorContext {
    pub storage: Arc<dyn StorageAdapter>,
    pub sessions: Arc<dyn SessionStorage>,
    pub router: Arc<ModelRouter>,
    pub session: UserSession,
    pub conversation_context: Option<String>,
}

impl OrchestratorContext {
    fn as_agent_ctx(&self) -> Arc<AgentContext> {
        Arc::new(AgentContext {
            storage: self.storage.clone(),
            sessions: self.sessions.clone(),
            router: self.router.clone(),
            session: self.session.clone(),
            conversation_context: self.conversation_context.clone(),
        })
    }
}

// ── Plan ─────────────────────────────────────────────────────────────────────

/// The Orchestrator's intent classification output.
#[derive(Debug, Clone)]
pub enum AgentPlan {
    /// Only research is needed; no document edits.
    ResearchOnly { query: String },
    /// Research first, then edit based on the findings.
    ResearchThenEdit { query: String, instruction: String },
}

// ── Entry point ───────────────────────────────────────────────────────────────

/// Run an orchestrated agent turn for `msg`.
///
/// Returns a stream of [`SourcedEvent`]s. Events from the Researcher carry
/// `source: AgentSource::Researcher`; events from the Editor carry
/// `source: AgentSource::Editor`. The stream ends after the last agent emits
/// its `FinalMessage`.
pub fn orchestrate(
    msg: &str,
    ctx: OrchestratorContext,
) -> BoxStream<'static, Result<SourcedEvent, KayaError>> {
    let msg = msg.to_owned();
    let (tx, rx) = mpsc::channel::<Result<SourcedEvent, KayaError>>(64);

    tokio::spawn(async move {
        orchestrate_task(msg, ctx, tx).await;
    });

    Box::pin(rx)
}

// ── Internal task ─────────────────────────────────────────────────────────────

async fn orchestrate_task(
    msg: String,
    ctx: OrchestratorContext,
    mut tx: mpsc::Sender<Result<SourcedEvent, KayaError>>,
) {
    println!(
        "[agent][orchestrator][start] message={}",
        truncate_for_log(&msg, 240)
    );
    let plan = classify_intent(&msg, &ctx).await;
    println!("[agent][orchestrator][plan] {}", format_plan(&plan));
    let agent_ctx = ctx.as_agent_ctx();
    let log = Arc::new(InvocationLog::new());

    match &plan {
        AgentPlan::ResearchOnly { .. } => {
            println!("[agent][orchestrator][handoff] researcher only");
            run_researcher(&plan, agent_ctx, log, &mut tx).await;
        }
        AgentPlan::ResearchThenEdit { .. } => {
            println!("[agent][orchestrator][handoff] researcher then editor");
            let (researcher_tx, mut researcher_rx) =
                mpsc::channel::<Result<AgentEvent, KayaError>>(64);

            let researcher = Researcher::new();
            let plan_clone = plan.clone();
            let ctx_clone = agent_ctx.clone();
            let log_clone = log.clone();

            // Run the Researcher and collect its ResearchResult.
            let research_result = {
                let research_fut =
                    researcher.research(&plan_clone, ctx_clone, log_clone, researcher_tx);

                // Drive both the Researcher task and the event forwarding
                // concurrently. We need to forward events while the Researcher
                // runs, but also capture the returned ResearchResult.
                tokio::pin!(research_fut);

                let mut result: Option<
                    Result<crate::agent::researcher::ResearchResult, KayaError>,
                > = None;

                loop {
                    tokio::select! {
                        biased;
                        ev = researcher_rx.next() => {
                            match ev {
                                Some(e) => {
                                    let sourced = e.map(|event| SourcedEvent {
                                        source: AgentSource::Researcher,
                                        event,
                                    });
                                    if tx.send(sourced).await.is_err() {
                                        return;
                                    }
                                }
                                None => break,
                            }
                        }
                        res = &mut research_fut, if result.is_none() => {
                            result = Some(res);
                        }
                    }
                }

                // Drain any remaining events after the Researcher completed.
                while let Some(ev) = researcher_rx.next().await {
                    let sourced = ev.map(|event| SourcedEvent {
                        source: AgentSource::Researcher,
                        event,
                    });
                    if tx.send(sourced).await.is_err() {
                        return;
                    }
                }

                match result {
                    Some(Ok(r)) => r,
                    Some(Err(e)) => {
                        let _ = tx.send(Err(e)).await;
                        return;
                    }
                    None => {
                        // research_fut completed before select loop caught it
                        let _ = tx
                            .send(Err(KayaError::Internal("researcher did not return".into())))
                            .await;
                        return;
                    }
                }
            };

            println!(
                "[agent][orchestrator][research_complete] cited_docs={} stale_refs={} summary={}",
                research_result.cited_doc_ids.len(),
                research_result.stale_refs.len(),
                truncate_for_log(&research_result.summary_context, 300)
            );

            // Now run the Editor with the ResearchResult.
            let (editor_tx, mut editor_rx) = mpsc::channel::<Result<AgentEvent, KayaError>>(64);

            let editor = Editor::new(write_tools());
            let edit_fut = editor.edit(&plan, research_result, agent_ctx, log, editor_tx);

            tokio::pin!(edit_fut);

            loop {
                tokio::select! {
                    biased;
                    ev = editor_rx.next() => {
                        match ev {
                            Some(e) => {
                                let sourced = e.map(|event| SourcedEvent {
                                    source: AgentSource::Editor,
                                    event,
                                });
                                if tx.send(sourced).await.is_err() {
                                    return;
                                }
                            }
                            None => break,
                        }
                    }
                    res = &mut edit_fut => {
                        if let Err(e) = res {
                            let _ = tx.send(Err(e)).await;
                        }
                        break;
                    }
                }
            }

            // Drain remaining editor events.
            while let Some(ev) = editor_rx.next().await {
                let sourced = ev.map(|event| SourcedEvent {
                    source: AgentSource::Editor,
                    event,
                });
                if tx.send(sourced).await.is_err() {
                    return;
                }
            }
        }
    }

    println!("[agent][orchestrator][done]");
}

// ── Classification ────────────────────────────────────────────────────────────

async fn classify_intent(msg: &str, ctx: &OrchestratorContext) -> AgentPlan {
    let convo_context = ctx
        .conversation_context
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .map(|s| format!("\nConversation context:\n{s}\n"))
        .unwrap_or_default();

    let prompt = format!(
        "Classify the following user message as one of two intents.\n\
         Return a JSON object only, no explanation.\n\
         \n\
         Intent options:\n\
         1. research_only — the user wants information, a summary, or an answer.\n\
         2. research_then_edit — the user wants to create, modify, move, or delete documents or folders.\n\
         \n\
         JSON format for research_only:\n\
         {{\"intent\":\"research_only\",\"query\":\"<user query>\"}}\n\
         \n\
         JSON format for research_then_edit:\n\
         {{\"intent\":\"research_then_edit\",\"query\":\"<what to research>\",\"instruction\":\"<what to edit>\"}}\n\
         \n\
         Use the conversation context only as supporting background. The current user message is the source of truth for the requested action.\n\
         {convo_context}\
         User message: {msg}"
    );

    match ctx
        .router
        .complete(OperationType::IntentClassification, prompt)
        .await
    {
        Ok(resp) => {
            println!(
                "[agent][orchestrator][classify_raw] {}",
                truncate_for_log(&resp.content, 240)
            );
            parse_intent_response(&resp.content, msg)
        }
        Err(e) => {
            eprintln!("[orchestrator] classification failed ({e}); falling back to ResearchOnly");
            AgentPlan::ResearchOnly {
                query: msg.to_owned(),
            }
        }
    }
}

fn parse_intent_response(content: &str, original_msg: &str) -> AgentPlan {
    // Strip markdown code fences if present.
    let trimmed = content
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) else {
        eprintln!("[orchestrator] could not parse classification JSON; falling back");
        return AgentPlan::ResearchOnly {
            query: original_msg.to_owned(),
        };
    };

    match v["intent"].as_str() {
        Some("research_only") => AgentPlan::ResearchOnly {
            query: v["query"].as_str().unwrap_or(original_msg).to_owned(),
        },
        Some("research_then_edit") => AgentPlan::ResearchThenEdit {
            query: v["query"].as_str().unwrap_or(original_msg).to_owned(),
            instruction: v["instruction"].as_str().unwrap_or(original_msg).to_owned(),
        },
        other => {
            eprintln!(
                "[orchestrator] unrecognised intent {:?}; falling back to ResearchOnly",
                other
            );
            AgentPlan::ResearchOnly {
                query: original_msg.to_owned(),
            }
        }
    }
}

// ── ResearchOnly helper ───────────────────────────────────────────────────────

async fn run_researcher(
    plan: &AgentPlan,
    ctx: Arc<AgentContext>,
    log: Arc<InvocationLog>,
    tx: &mut mpsc::Sender<Result<SourcedEvent, KayaError>>,
) {
    let (researcher_tx, mut researcher_rx) = mpsc::channel::<Result<AgentEvent, KayaError>>(64);

    let researcher = Researcher::new();
    let plan_clone = plan.clone();
    let ctx_clone = ctx.clone();
    let log_clone = log.clone();

    let research_fut = researcher.research(&plan_clone, ctx_clone, log_clone, researcher_tx);
    tokio::pin!(research_fut);

    let mut done = false;
    loop {
        tokio::select! {
            biased;
            ev = researcher_rx.next() => {
                match ev {
                    Some(e) => {
                        let sourced = e.map(|event| SourcedEvent {
                            source: AgentSource::Researcher,
                            event,
                        });
                        if tx.send(sourced).await.is_err() {
                            return;
                        }
                    }
                    None => break,
                }
            }
            _res = &mut research_fut, if !done => {
                done = true;
            }
        }
    }

    // Drain.
    while let Some(ev) = researcher_rx.next().await {
        let sourced = ev.map(|event| SourcedEvent {
            source: AgentSource::Researcher,
            event,
        });
        if tx.send(sourced).await.is_err() {
            return;
        }
    }
}

fn format_plan(plan: &AgentPlan) -> String {
    match plan {
        AgentPlan::ResearchOnly { query } => {
            format!(
                "intent=research_only query={}",
                truncate_for_log(query, 180)
            )
        }
        AgentPlan::ResearchThenEdit { query, instruction } => format!(
            "intent=research_then_edit query={} instruction={}",
            truncate_for_log(query, 180),
            truncate_for_log(instruction, 180)
        ),
    }
}

fn truncate_for_log(text: &str, max_chars: usize) -> String {
    let total_chars = text.chars().count();
    if total_chars <= max_chars {
        return text.replace('\n', "\\n");
    }

    let truncated: String = text.chars().take(max_chars).collect();
    format!(
        "{}… ({} chars)",
        truncated.replace('\n', "\\n"),
        total_chars
    )
}
