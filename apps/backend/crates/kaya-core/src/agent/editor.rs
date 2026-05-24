//! Editor agent — write-only tool calls grounded by a [`ResearchResult`].
//!
//! The Editor receives the Researcher's [`ResearchResult`] and uses it as
//! grounding context injected into its system prompt. It runs its own inner loop
//! (up to `max_turns = 6`) using the four write tools: `create_document`,
//! `propose_edit`, `update_document`, and `delete_document`.
//!
//! # Compile-time tool isolation
//!
//! `Editor::new` accepts only `Vec<Arc<dyn WriteTool>>`. Passing a read tool
//! (e.g. `SearchDocuments`) is a compile error because `SearchDocuments` does
//! not implement `WriteTool`.

use std::sync::Arc;
use std::time::Instant;

use chrono::Utc;
use futures::SinkExt;
use futures::channel::mpsc;
use uuid::Uuid;

use crate::agent::log::{InvocationLog, ToolInvocation};
use crate::agent::tool::WriteTool;
use crate::agent::{AgentContext, AgentEvent};
use crate::error::KayaError;
use crate::model_router::{OperationType, ToolCallRequest, ToolDefinition};
use crate::token_counter::count_tokens;

use super::orchestrator::AgentPlan;
use super::researcher::ResearchResult;

// ── Agent ─────────────────────────────────────────────────────────────────────

pub struct Editor {
    tools: Vec<Arc<dyn WriteTool>>,
    max_turns: usize,
}

impl Editor {
    /// Construct an Editor. `tools` must be write-only tool implementations.
    /// Passing a [`ReadTool`](crate::agent::tool::ReadTool) fails to compile.
    pub fn new(tools: Vec<Arc<dyn WriteTool>>) -> Self {
        Self {
            tools,
            max_turns: 6,
        }
    }

    pub fn with_max_turns(mut self, n: usize) -> Self {
        self.max_turns = n;
        self
    }

    /// Run the editing loop, grounded by `research`. Emits [`AgentEvent`]s to
    /// `tx` (including [`AgentEvent::ProposedEditEmitted`] for any proposed
    /// changes). The ApprovalToken gate in `edit.rs` is unchanged.
    pub async fn edit(
        &self,
        plan: &AgentPlan,
        research: ResearchResult,
        ctx: Arc<AgentContext>,
        log: Arc<InvocationLog>,
        mut tx: mpsc::Sender<Result<AgentEvent, KayaError>>,
    ) -> Result<(), KayaError> {
        let instruction = match plan {
            AgentPlan::ResearchThenEdit { instruction, .. } => instruction.as_str(),
            AgentPlan::ResearchOnly { query } => query.as_str(),
        };

        let tool_defs: Vec<ToolDefinition> = self
            .tools
            .iter()
            .map(|t| ToolDefinition {
                name: t.name().to_owned(),
                description: t.description().to_owned(),
                parameters: t.schema(),
            })
            .collect();

        let system_prompt = build_editor_prompt(
            &self.tools,
            instruction,
            &research,
            ctx.conversation_context.as_deref(),
        );
        let turn_id = Uuid::new_v4();
        let mut tool_history = String::new();
        let mut total_input_tokens: u32 = 0;
        let mut total_output_tokens: u32 = 0;
        let mut last_model = String::new();

        for _ in 0..self.max_turns {
            let prompt = format!("{system_prompt}\nUser: {instruction}\n{tool_history}");
            total_input_tokens = total_input_tokens.saturating_add(count_tokens(&prompt, "gpt-4"));

            let req = ToolCallRequest {
                prompt,
                model: String::new(),
                operation: OperationType::EditProposal,
                tools: tool_defs.clone(),
            };

            let resp = match ctx.router.tool_call(OperationType::EditProposal, req).await {
                Ok(r) => r,
                Err(e) => {
                    let _ = tx.send(Err(e)).await;
                    return Err(KayaError::Internal("editor model call failed".into()));
                }
            };

            last_model = resp.usage.model.clone();

            match resp.result {
                Some(tool_call) => {
                    if tx
                        .send(Ok(AgentEvent::ToolCall {
                            name: tool_call.tool_name.clone(),
                            input: tool_call.arguments.clone(),
                        }))
                        .await
                        .is_err()
                    {
                        return Err(KayaError::Internal("stream dropped".into()));
                    }

                    let started_at = Utc::now();
                    let t0 = Instant::now();

                    let (output_json, maybe_edit, error_str) =
                        match self.tools.iter().find(|t| t.name() == tool_call.tool_name) {
                            None => {
                                let e = format!("Unknown tool: {}", tool_call.tool_name);
                                (serde_json::json!({ "error": &e }), None, Some(e))
                            }
                            Some(t) => match t.invoke(tool_call.arguments.clone(), &ctx).await {
                                Ok(out) => (out.content, out.proposed_edit, None),
                                Err(e) => {
                                    let s = e.to_string();
                                    (serde_json::json!({ "error": &s }), None, Some(s))
                                }
                            },
                        };

                    let latency_ms = t0.elapsed().as_millis() as u64;

                    log.record(ToolInvocation {
                        id: Uuid::new_v4(),
                        turn_id,
                        tool_name: tool_call.tool_name.clone(),
                        input: tool_call.arguments.clone(),
                        output: error_str
                            .as_ref()
                            .map(|e| Err(e.clone()))
                            .unwrap_or_else(|| Ok(output_json.clone())),
                        latency_ms,
                        started_at,
                    });

                    if tx
                        .send(Ok(AgentEvent::ToolResult {
                            name: tool_call.tool_name.clone(),
                            output: output_json.clone(),
                            latency_ms,
                        }))
                        .await
                        .is_err()
                    {
                        return Err(KayaError::Internal("stream dropped".into()));
                    }

                    if let Some(edit) = maybe_edit {
                        if tx
                            .send(Ok(AgentEvent::ProposedEditEmitted { edit }))
                            .await
                            .is_err()
                        {
                            return Err(KayaError::Internal("stream dropped".into()));
                        }
                    }

                    let result_json = serde_json::to_string(&output_json).unwrap_or_default();
                    let args_json = serde_json::to_string(&tool_call.arguments).unwrap_or_default();
                    tool_history.push_str(&format!(
                        "\n[Calling: {}({args_json})]\n[Result]: {result_json}\n",
                        tool_call.tool_name,
                    ));
                }

                None => {
                    let text = resp
                        .content
                        .filter(|s| !s.is_empty())
                        .unwrap_or_else(|| "Done.".to_owned());

                    total_output_tokens = count_tokens(&text, &resp.usage.model);

                    let _ = tx
                        .send(Ok(AgentEvent::Usage {
                            input_tokens: total_input_tokens,
                            output_tokens: total_output_tokens,
                            model: last_model,
                        }))
                        .await;
                    let _ = tx.send(Ok(AgentEvent::FinalMessage { text })).await;

                    return Ok(());
                }
            }
        }

        // Exceeded max_turns.
        let _ = tx
            .send(Ok(AgentEvent::Usage {
                input_tokens: total_input_tokens,
                output_tokens: total_output_tokens,
                model: last_model,
            }))
            .await;
        let _ = tx
            .send(Ok(AgentEvent::FinalMessage {
                text: "Reached maximum editor turns.".to_owned(),
            }))
            .await;

        Ok(())
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn build_editor_prompt(
    tools: &[Arc<dyn WriteTool>],
    instruction: &str,
    research: &ResearchResult,
    conversation_context: Option<&str>,
) -> String {
    let tool_list = tools
        .iter()
        .map(|t| format!("- {}: {}", t.name(), t.description()))
        .collect::<Vec<_>>()
        .join("\n");
    let directory_context = serde_json::to_string_pretty(&research.directory_context)
        .unwrap_or_else(|_| "{\"folders\":[]}".to_string());
    let conversation_context = conversation_context
        .filter(|s| !s.trim().is_empty())
        .map(|s| format!("## Conversation context\n{s}\n\n"))
        .unwrap_or_default();

    format!(
        "You are the Editor agent for Kaya Suites.\n\
         \n\
         {conversation_context}\
         ## Research context\n\
         The Researcher agent has gathered the following context for you:\n\
         {}\n\
         \n\
         ## Directory context\n\
         Use this structured directory data exactly as provided:\n\
         {directory_context}\n\
         \n\
         ## Your task\n\
         Using the research context above, carry out the following instruction:\n\
         {instruction}\n\
         \n\
         Available tools (write-only — do not search or read):\n\
         {tool_list}\n\
         \n\
         IMPORTANT: Never apply document edits directly. Always use propose_edit \
         or create_document so the user can review and approve the change. \
         For create_folder, root-level folders must omit `parent_id` entirely; \
         never use `00000000-0000-0000-0000-000000000000` as a root sentinel. \
         Use only folder IDs that appear in DIRECTORY_CONTEXT. If no matching \
         parent folder is present there, omit `parent_id` rather than guessing. \
         You already have all the information you need from the research context — \
         do not attempt to search or read documents.",
        research.summary_context
    )
}
