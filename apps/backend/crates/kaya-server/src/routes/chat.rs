use std::collections::HashMap;
use std::convert::Infallible;
use std::sync::Arc;

use axum::{
    Json,
    body::Body,
    extract::{Extension, Path},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use bytes::Bytes;
use futures::StreamExt;
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::sync::Mutex;
use tokio_stream::wrappers::ReceiverStream;
use uuid::Uuid;

use kaya_core::{
    ParagraphChange, ProposedEdit, ProposedEditKind, SessionStorage, StorageAdapter,
    agent::{
        AgentEvent, ChatContext, ConversationSummarizer, DocumentFocus, OrchestratorContext,
        SourcedEvent, TurnContext, orchestrate,
    },
    auth::UserSession,
    diff::compute_paragraph_diff,
    model_router::ModelRouter,
    session::{ChatHistorySummary, EditHistoryEntry},
};

use crate::state::StoredEdit;

#[derive(Deserialize)]
pub struct ChatBody {
    pub message: String,
    pub context: Option<ChatContextPayload>,
}

/// Frontend doc-focus payload. Accepts either the new structured shape or a
/// plain string (legacy — treated as a raw document body with empty id/title).
/// The legacy branch is kept for one release; remove after the web client is
/// confirmed on the structured shape.
#[derive(Deserialize)]
#[serde(untagged)]
pub enum ChatContextPayload {
    Structured(DocumentFocusPayload),
    Legacy(String),
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentFocusPayload {
    pub doc_id: Uuid,
    pub title: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub body: String,
}

impl ChatContextPayload {
    fn into_document_focus(self) -> Option<DocumentFocus> {
        match self {
            ChatContextPayload::Structured(p) => Some(DocumentFocus {
                doc_id: p.doc_id,
                title: p.title,
                tags: p.tags,
                body: p.body,
            }),
            ChatContextPayload::Legacy(body) if !body.trim().is_empty() => Some(DocumentFocus {
                doc_id: Uuid::nil(),
                title: String::new(),
                tags: Vec::new(),
                body,
            }),
            ChatContextPayload::Legacy(_) => None,
        }
    }
}

pub async fn chat_stream(
    Extension(storage): Extension<Arc<dyn StorageAdapter>>,
    Extension(sessions): Extension<Arc<dyn SessionStorage>>,
    Extension(llm): Extension<Option<Arc<ModelRouter>>>,
    Extension(pending_edits): Extension<Arc<Mutex<HashMap<Uuid, StoredEdit>>>>,
    Path(session_id): Path<Uuid>,
    Json(body): Json<ChatBody>,
) -> Response {
    let Some(router) = llm else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "LLM provider not configured"})),
        )
            .into_response();
    };

    let prior_messages = sessions
        .get_prior_messages(session_id)
        .await
        .unwrap_or_default();
    let chat_summary = sessions.get_chat_summary(session_id).await.unwrap_or(None);
    let recent_edits = sessions
        .get_recent_edit_history(session_id, 5)
        .await
        .unwrap_or_default();

    let is_first_turn = prior_messages.is_empty();

    let _ = sessions.touch_session(session_id).await;

    let _ = sessions
        .save_user_message(session_id, &Uuid::new_v4().to_string(), &body.message)
        .await;

    let (tx, rx) = tokio::sync::mpsc::channel::<Bytes>(64);
    let message = body.message;
    let recent_messages = prior_messages
        .iter()
        .rev()
        .take(5)
        .cloned()
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>();
    let turn_context = build_turn_context(
        body.context,
        chat_summary,
        recent_messages,
        recent_edits,
    );

    tokio::spawn(async move {
        run_agent_stream(
            storage,
            sessions,
            pending_edits,
            router,
            session_id,
            message,
            turn_context,
            is_first_turn,
            tx,
        )
        .await;
    });

    let stream = ReceiverStream::new(rx).map(Ok::<_, Infallible>);

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/event-stream")
        .header(header::CACHE_CONTROL, "no-cache")
        .header("X-Accel-Buffering", "no")
        .body(Body::from_stream(stream))
        .unwrap()
}

async fn run_agent_stream(
    storage: Arc<dyn StorageAdapter>,
    sessions: Arc<dyn SessionStorage>,
    pending_edits: Arc<Mutex<HashMap<Uuid, StoredEdit>>>,
    router: Arc<ModelRouter>,
    session_id: Uuid,
    original_message: String,
    turn_context: TurnContext,
    is_first_turn: bool,
    tx: tokio::sync::mpsc::Sender<Bytes>,
) {
    let session = UserSession {
        user_id: Uuid::nil(),
    };
    let orch_ctx = OrchestratorContext {
        storage: storage.clone(),
        sessions: sessions.clone(),
        router: router.clone(),
        session,
        turn: turn_context,
    };
    let mut events = orchestrate(&original_message, orch_ctx);

    let mut doc_title_cache: HashMap<Uuid, String> = HashMap::new();
    let mut assistant_text = String::new();
    let mut assistant_citations: Vec<Value> = Vec::new();
    let mut assistant_proposals: Vec<Value> = Vec::new();
    let assistant_message_id = Uuid::new_v4().to_string();
    let mut turn_input_tokens: u32 = 0;
    let mut turn_output_tokens: u32 = 0;
    let mut turn_model = String::new();

    macro_rules! send {
        ($data:expr) => {{
            let line = format!("data: {}\n\n", $data);
            if tx.send(Bytes::from(line)).await.is_err() {
                return;
            }
        }};
    }

    while let Some(result) = events.next().await {
        let sourced = match result {
            Err(e) => {
                send!(json!({"type": "Error", "message": e.to_string()}));
                break;
            }
            Ok(s) => s,
        };

        let SourcedEvent { source, event } = sourced;
        let source_str = match source {
            kaya_core::agent::AgentSource::Orchestrator => "orchestrator",
            kaya_core::agent::AgentSource::Researcher => "researcher",
            kaya_core::agent::AgentSource::Editor => "editor",
        };

        log_agent_event(source_str, &event);

        match event {
            AgentEvent::ToolResult { name, output, .. } => match name.as_str() {
                "search_documents" => {
                    if let Some(arr) = output.get("documents").and_then(|v| v.as_array()) {
                        for item in arr {
                            if let (Some(id_str), Some(title)) =
                                (item["id"].as_str(), item["title"].as_str())
                            {
                                if let Ok(id) = Uuid::parse_str(id_str) {
                                    doc_title_cache.insert(id, title.to_string());
                                }
                            }
                        }
                    }
                }
                "read_document" => {
                    if let (Some(id_str), Some(title)) =
                        (output["id"].as_str(), output["title"].as_str())
                    {
                        if let Ok(id) = Uuid::parse_str(id_str) {
                            doc_title_cache.insert(id, title.to_string());
                        }
                    }
                }
                _ => {}
            },

            AgentEvent::ProposedEditEmitted { edit } => {
                if let Some(sse_data) = build_edit_sse(
                    &storage,
                    &sessions,
                    &pending_edits,
                    session_id,
                    &assistant_message_id,
                    &edit,
                )
                .await
                {
                    assistant_proposals.push(proposal_record(&sse_data));
                    send!(sse_data);
                }
            }

            AgentEvent::FinalMessage { text } => {
                let (clean_text, raw_citations) = extract_citations(&text);

                for (label, (doc_id_str, para_id)) in raw_citations.iter().enumerate() {
                    let label = label + 1;
                    let doc_id = Uuid::parse_str(doc_id_str).unwrap_or(Uuid::nil());

                    let title = if let Some(t) = doc_title_cache.get(&doc_id) {
                        t.clone()
                    } else {
                        storage
                            .get_document(doc_id)
                            .await
                            .map(|d| d.title)
                            .unwrap_or_default()
                    };

                    assistant_citations.push(json!({
                        "label": label,
                        "docId": doc_id_str,
                        "paragraphId": para_id,
                        "title": title,
                    }));

                    send!(json!({
                        "type": "CitationFound",
                        "docId": doc_id_str,
                        "paragraphId": para_id,
                        "label": label,
                        "title": title,
                    }));
                }

                for chunk in clean_text
                    .as_bytes()
                    .chunks(80)
                    .map(|c| std::str::from_utf8(c).unwrap_or_default())
                {
                    send!(json!({"type": "TextChunk", "content": chunk}));
                    tokio::time::sleep(tokio::time::Duration::from_millis(15)).await;
                }

                assistant_text = clean_text;
            }

            AgentEvent::Usage {
                input_tokens,
                output_tokens,
                model,
            } => {
                turn_input_tokens = input_tokens;
                turn_output_tokens = output_tokens;
                turn_model = model;
            }

            _ => {}
        }
    }

    if !assistant_text.is_empty() {
        let citations_json =
            serde_json::to_string(&assistant_citations).unwrap_or_else(|_| "[]".to_string());
        let _ = sessions
            .save_assistant_message(
                session_id,
                &assistant_message_id,
                &assistant_text,
                &citations_json,
                turn_input_tokens,
                turn_output_tokens,
                &turn_model,
            )
            .await;

        if !assistant_proposals.is_empty() {
            let proposals_json = serde_json::to_string(&assistant_proposals)
                .unwrap_or_else(|_| "[]".to_string());
            let _ = sessions
                .update_message_proposals(&assistant_message_id, &proposals_json)
                .await;
        }

        let sessions_for_summary = sessions.clone();
        let router_for_summary = router.clone();
        tokio::spawn(async move {
            refresh_chat_summary_if_needed(sessions_for_summary, router_for_summary, session_id)
                .await;
        });

        if is_first_turn {
            let naming_messages = vec![
                kaya_core::model_router::ChatMessage::user(format!(
                    "Generate a short title (3–6 words, no quotes, no trailing punctuation) \
                     for a conversation that starts with this user message:\n\n{original_message}\n\nTitle:"
                )),
            ];
            if let Ok(resp) = router
                .complete(
                    kaya_core::model_router::OperationType::RetrievalClassification,
                    naming_messages,
                )
                .await
            {
                let title = resp
                    .content
                    .trim()
                    .trim_matches('"')
                    .trim_matches('\'')
                    .to_string();
                if !title.is_empty() {
                    let _ = sessions.rename_session(session_id, title.clone()).await;
                    send!(
                        json!({"type": "SessionRenamed", "sessionId": session_id, "title": title})
                    );
                }
            }
        }
    }

    send!(json!({"type": "Done"}));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn extract_citations(text: &str) -> (String, Vec<(String, String)>) {
    let mut result = String::with_capacity(text.len());
    let mut citations: Vec<(String, String)> = Vec::new();
    let mut remaining = text;

    while let Some(start) = remaining.find("[[") {
        result.push_str(&remaining[..start]);
        remaining = &remaining[start + 2..];

        if let Some(end) = remaining.find("]]") {
            let inner = &remaining[..end];
            remaining = &remaining[end + 2..];

            if let Some(colon) = inner.find(':') {
                let doc_id = inner[..colon].trim().to_string();
                let para_id = inner[colon + 1..].trim().to_string();

                let label = citations
                    .iter()
                    .position(|(d, p)| d == &doc_id && p == &para_id)
                    .map(|i| i + 1)
                    .unwrap_or_else(|| {
                        citations.push((doc_id, para_id));
                        citations.len()
                    });

                result.push_str(&format!("[{label}]"));
            } else {
                result.push_str("[[");
                result.push_str(inner);
                result.push_str("]]");
            }
        } else {
            result.push_str("[[");
            result.push_str(remaining);
            remaining = "";
        }
    }

    result.push_str(remaining);
    (result, citations)
}

/// Insert a `StoredEdit` into the in-memory map (hot path used by the
/// approve/reject handlers) AND mirror it into `pending_edits` table so the
/// edit survives a server restart. Storage failures are logged and swallowed
/// — losing durability is preferable to dropping a live SSE stream.
async fn save_stored_edit(
    pending_edits: &Arc<Mutex<HashMap<Uuid, StoredEdit>>>,
    sessions: &Arc<dyn SessionStorage>,
    stored: StoredEdit,
) {
    let edit_id = stored.edit.id;
    match serde_json::to_string(&stored) {
        Ok(payload) => {
            if let Err(e) = sessions.save_pending_edit(edit_id, &payload).await {
                tracing::warn!(error = %e, %edit_id, "save_pending_edit failed; in-memory only");
            }
        }
        Err(e) => {
            tracing::warn!(error = %e, %edit_id, "serialize StoredEdit failed; in-memory only");
        }
    }
    pending_edits.lock().await.insert(edit_id, stored);
}

async fn build_edit_sse(
    storage: &Arc<dyn StorageAdapter>,
    sessions: &Arc<dyn SessionStorage>,
    pending_edits: &Arc<Mutex<HashMap<Uuid, StoredEdit>>>,
    session_id: Uuid,
    message_id: &str,
    edit: &ProposedEdit,
) -> Option<Value> {
    let (doc_id, para_id, original, proposed) = match &edit.kind {
        ProposedEditKind::Modify {
            document_id, diff, ..
        } => {
            if diff.changes.is_empty() {
                return None;
            }
            // Aggregate all changed paragraphs so the review card shows the full diff.
            let mut old_parts: Vec<&str> = Vec::new();
            let mut new_parts: Vec<&str> = Vec::new();
            for c in &diff.changes {
                match c {
                    ParagraphChange::Modify {
                        old_text, new_text, ..
                    } => {
                        old_parts.push(old_text.as_str());
                        new_parts.push(new_text.as_str());
                    }
                    ParagraphChange::Remove { text, .. } => {
                        old_parts.push(text.as_str());
                    }
                    ParagraphChange::Add { text, .. } => {
                        new_parts.push(text.as_str());
                    }
                }
            }
            let first_id = match &diff.changes[0] {
                ParagraphChange::Modify { paragraph_id, .. } => paragraph_id.clone(),
                ParagraphChange::Remove { paragraph_id, .. } => paragraph_id.clone(),
                ParagraphChange::Add { paragraph_id, .. } => paragraph_id.clone(),
            };
            (
                Some(*document_id),
                first_id,
                old_parts.join("\n\n"),
                new_parts.join("\n\n"),
            )
        }
        ProposedEditKind::Create { body, .. } => {
            (None, "p0".to_string(), String::new(), body.clone())
        }
        ProposedEditKind::UpdateContent {
            document_id,
            new_content,
        } => {
            let old_body = storage
                .get_document(*document_id)
                .await
                .map(|d| d.body)
                .unwrap_or_default();
            let diff = compute_paragraph_diff(&old_body, new_content);
            let mut old_parts: Vec<&str> = Vec::new();
            let mut new_parts: Vec<&str> = Vec::new();
            for c in &diff.changes {
                match c {
                    ParagraphChange::Modify {
                        old_text, new_text, ..
                    } => {
                        old_parts.push(old_text.as_str());
                        new_parts.push(new_text.as_str());
                    }
                    ParagraphChange::Remove { text, .. } => {
                        old_parts.push(text.as_str());
                    }
                    ParagraphChange::Add { text, .. } => {
                        new_parts.push(text.as_str());
                    }
                }
            }
            (
                Some(*document_id),
                "p0".to_string(),
                old_parts.join("\n\n"),
                new_parts.join("\n\n"),
            )
        }
        ProposedEditKind::DeleteDocument { document_id } => {
            let doc_title = storage
                .get_document(*document_id)
                .await
                .map(|d| d.title)
                .unwrap_or_default();
            let stored = StoredEdit {
                session_id,
                message_id: message_id.to_string(),
                edit: edit.clone(),
                doc_title: doc_title.clone(),
                first_paragraph_id: String::new(),
                original_paragraph: String::new(),
                proposed_paragraph: String::new(),
            };
            save_stored_edit(pending_edits, sessions, stored).await;
            let _ = sessions
                .upsert_edit_history_entry(
                    session_id,
                    &build_edit_history_entry(
                        edit,
                        "pending",
                        &doc_title,
                        "",
                        "",
                    ),
                )
                .await;
            return Some(json!({
                "type": "ProposedDeleteEmitted",
                "editId": edit.id,
                "docId": document_id,
                "docTitle": doc_title,
            }));
        }
        ProposedEditKind::CreateFolder { name, parent_id } => {
            let stored = StoredEdit {
                session_id,
                message_id: message_id.to_string(),
                edit: edit.clone(),
                doc_title: String::new(),
                first_paragraph_id: String::new(),
                original_paragraph: String::new(),
                proposed_paragraph: String::new(),
            };
            save_stored_edit(pending_edits, sessions, stored).await;
            let _ = sessions
                .upsert_edit_history_entry(
                    session_id,
                    &build_edit_history_entry(edit, "pending", "", "", ""),
                )
                .await;
            return Some(json!({
                "type": "ProposedFolderCreateEmitted",
                "editId": edit.id,
                "name": name,
                "parentId": parent_id,
            }));
        }
    };

    let doc_title = if let Some(id) = doc_id {
        storage
            .get_document(id)
            .await
            .map(|d| d.title)
            .unwrap_or_default()
    } else {
        String::new()
    };

    let stored = StoredEdit {
        session_id,
        message_id: message_id.to_string(),
        edit: edit.clone(),
        doc_title: doc_title.clone(),
        first_paragraph_id: para_id.clone(),
        original_paragraph: original.clone(),
        proposed_paragraph: proposed.clone(),
    };
    save_stored_edit(pending_edits, sessions, stored).await;
    let _ = sessions
        .upsert_edit_history_entry(
            session_id,
            &build_edit_history_entry(edit, "pending", &doc_title, &original, &proposed),
        )
        .await;

    Some(json!({
        "type": "ProposedEditEmitted",
        "editId": edit.id,
        "docId": doc_id,
        "paragraphId": para_id,
        "original": original,
        "proposed": proposed,
    }))
}

/// Convert an outgoing SSE event Value into the shape persisted in
/// `chat_messages.proposals`. Adds `kind` and `status: "pending"`.
fn proposal_record(sse: &Value) -> Value {
    let event_type = sse.get("type").and_then(|v| v.as_str()).unwrap_or("");
    let kind = match event_type {
        "ProposedEditEmitted" => "edit",
        "ProposedDeleteEmitted" => "delete",
        "ProposedFolderCreateEmitted" => "folderCreate",
        _ => "unknown",
    };
    let mut obj = serde_json::Map::new();
    obj.insert("kind".to_string(), Value::String(kind.to_string()));
    if let Some(id) = sse.get("editId") {
        obj.insert("id".to_string(), id.clone());
    }
    for key in [
        "docId",
        "paragraphId",
        "original",
        "proposed",
        "docTitle",
        "name",
        "parentId",
    ] {
        if let Some(v) = sse.get(key) {
            obj.insert(key.to_string(), v.clone());
        }
    }
    obj.insert(
        "status".to_string(),
        Value::String("pending".to_string()),
    );
    Value::Object(obj)
}

fn build_turn_context(
    request_context: Option<ChatContextPayload>,
    summary: Option<ChatHistorySummary>,
    recent_messages: Vec<(String, String)>,
    recent_edits: Vec<EditHistoryEntry>,
) -> TurnContext {
    let summary = summary.filter(|s| !s.summary.trim().is_empty()).map(|s| s.summary);
    let chat = if summary.is_none() && recent_messages.is_empty() && recent_edits.is_empty() {
        None
    } else {
        Some(ChatContext {
            summary,
            recent_messages,
            recent_edits,
        })
    };

    let document = request_context.and_then(ChatContextPayload::into_document_focus);

    TurnContext { chat, document }
}

fn build_edit_history_entry(
    edit: &ProposedEdit,
    status: &str,
    doc_title: &str,
    original: &str,
    proposed: &str,
) -> EditHistoryEntry {
    let now = chrono::Utc::now().timestamp_millis();
    let kind = match &edit.kind {
        ProposedEditKind::Modify { .. } => "modify",
        ProposedEditKind::Create { .. } => "create_document",
        ProposedEditKind::UpdateContent { .. } => "update_content",
        ProposedEditKind::DeleteDocument { .. } => "delete_document",
        ProposedEditKind::CreateFolder { .. } => "create_folder",
    }
    .to_string();

    let summary = format_edit_history_summary(edit, doc_title, original, proposed);

    EditHistoryEntry {
        edit_id: edit.id.to_string(),
        kind,
        status: status.to_string(),
        summary,
        created_at: now,
        updated_at: now,
    }
}

fn format_edit_history_summary(
    edit: &ProposedEdit,
    doc_title: &str,
    original: &str,
    proposed: &str,
) -> String {
    match &edit.kind {
        ProposedEditKind::Modify { .. } | ProposedEditKind::UpdateContent { .. } => {
            let doc = if doc_title.is_empty() {
                "document".to_string()
            } else {
                format!("document \"{}\"", truncate_text(doc_title, 80))
            };
            format!(
                "Updated {doc}. Original: {} Proposed: {}",
                truncate_text(original, 120),
                truncate_text(proposed, 120)
            )
        }
        ProposedEditKind::Create { title, body, .. } => format!(
            "Created document \"{}\" with draft content: {}",
            truncate_text(title, 80),
            truncate_text(body, 120)
        ),
        ProposedEditKind::DeleteDocument { .. } => {
            if doc_title.is_empty() {
                "Deleted a document.".to_string()
            } else {
                format!("Deleted document \"{}\".", truncate_text(doc_title, 80))
            }
        }
        ProposedEditKind::CreateFolder { name, parent_id } => {
            if parent_id.is_some() {
                format!("Created folder \"{}\" inside an existing parent.", truncate_text(name, 80))
            } else {
                format!("Created root folder \"{}\".", truncate_text(name, 80))
            }
        }
    }
}

async fn refresh_chat_summary_if_needed(
    sessions: Arc<dyn SessionStorage>,
    router: Arc<ModelRouter>,
    session_id: Uuid,
) {
    let messages = match sessions.get_prior_messages(session_id).await {
        Ok(messages) => messages,
        Err(_) => return,
    };

    if messages.len() <= 5 {
        return;
    }

    let covered_message_count = messages.len().saturating_sub(5);
    if covered_message_count == 0 || covered_message_count % 5 != 0 {
        return;
    }

    if let Ok(Some(existing)) = sessions.get_chat_summary(session_id).await {
        if existing.covered_message_count as usize >= covered_message_count {
            return;
        }
    }

    let older_messages = &messages[..covered_message_count];
    let summarizer = ConversationSummarizer::new();
    let summary = match summarizer.summarize(router.as_ref(), older_messages).await {
        Ok(summary) if !summary.trim().is_empty() => summary,
        _ => return,
    };

    let _ = sessions
        .save_chat_summary(
            session_id,
            &ChatHistorySummary {
                summary,
                covered_message_count: covered_message_count as u32,
                updated_at: chrono::Utc::now().timestamp_millis(),
            },
        )
        .await;
}

fn log_agent_event(source: &str, event: &AgentEvent) {
    match event {
        AgentEvent::ThinkingChunk { text } => {
            println!("[agent][{source}][thinking] {}", truncate_text(text, 400));
        }
        AgentEvent::ToolCall { name, input } => {
            println!(
                "[agent][{source}][tool_call] {name} {}",
                truncate_json(input, 600)
            );
        }
        AgentEvent::ToolResult {
            name,
            output,
            latency_ms,
        } => {
            println!(
                "[agent][{source}][tool_result] {name} latency_ms={latency_ms} {}",
                truncate_json(output, 600)
            );
        }
        AgentEvent::ProposedEditEmitted { edit } => {
            println!("[agent][{source}][proposed_edit] {}", describe_edit(edit));
        }
        AgentEvent::FinalMessage { text } => {
            println!("[agent][{source}][final] {}", truncate_text(text, 500));
        }
        AgentEvent::Usage {
            input_tokens,
            output_tokens,
            model,
        } => {
            println!(
                "[agent][{source}][usage] model={model} input_tokens={input_tokens} output_tokens={output_tokens}"
            );
        }
    }
}

fn describe_edit(edit: &ProposedEdit) -> String {
    match &edit.kind {
        ProposedEditKind::Create { title, body, .. } => format!(
            "id={} kind=create title={} body_preview={}",
            edit.id,
            truncate_text(title, 120),
            truncate_text(body, 240)
        ),
        ProposedEditKind::DeleteDocument { document_id } => {
            format!("id={} kind=delete document_id={document_id}", edit.id)
        }
        ProposedEditKind::UpdateContent {
            document_id,
            new_content,
        } => format!(
            "id={} kind=update_content document_id={} new_content_preview={}",
            edit.id,
            document_id,
            truncate_text(new_content, 240)
        ),
        ProposedEditKind::Modify {
            document_id,
            diff,
            new_body,
        } => format!(
            "id={} kind=modify document_id={} changed_paragraphs={} new_body_preview={}",
            edit.id,
            document_id,
            diff.changes.len(),
            truncate_text(new_body, 240)
        ),
        ProposedEditKind::CreateFolder { name, parent_id } => format!(
            "id={} kind=create_folder name={} parent_id={:?}",
            edit.id,
            truncate_text(name, 120),
            parent_id
        ),
    }
}

fn truncate_json(value: &Value, max_chars: usize) -> String {
    let serialized =
        serde_json::to_string(value).unwrap_or_else(|_| "<failed to serialize json>".to_string());
    truncate_text(&serialized, max_chars)
}

fn truncate_text(text: &str, max_chars: usize) -> String {
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
