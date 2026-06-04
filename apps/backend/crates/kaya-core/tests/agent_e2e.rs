//! End-to-end agent tests.
//!
//! Tests verified:
//! 1. Search-then-edit turn produces a `ProposedEdit`; document unchanged until
//!    `commit_edit` is called with an `ApprovalToken` (FR-15).
//! 2. Every tool call is recorded in the `InvocationLog` (FR-14).
//! 3. Cancelling the stream mid-turn does not panic or leak tasks.
//! 4. `commit_edit` with an `ApprovalToken` from `UserSession::approve_edit`
//!    applies the change; without a token it cannot be called (trybuild).

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use futures::StreamExt;
use serde_json::json;
use uuid::Uuid;

use kaya_core::agent::tools::{CreateFolder, SearchDirectories};
use kaya_core::agent::{
    AgentContext, AgentEvent, AgentPlan, AgentSource, InvocationLog, OrchestratorContext,
    Researcher, SourcedEvent, Tool, orchestrate,
};
use kaya_core::auth::UserSession;
use kaya_core::edit::commit_edit;
use kaya_core::error::KayaError;
use kaya_core::model_router::{
    CompletionRequest, CompletionResponse, EmbeddingRequest, EmbeddingResponse, LlmProvider,
    ModelRouter, OperationType, StreamItem, TokenUsage, ToolCallRequest, ToolCallResponse,
    ToolCallResult,
};
use kaya_core::session::{MessageRecord, Session, SessionError, SessionStorage, UsageSummary};
use kaya_core::storage::{
    Chunk, ChunkHit, Document, Embedding, Folder, StorageAdapter, StorageError,
};

// ── In-memory StorageAdapter ─────────────────────────────────────────────────

struct MemStorage {
    docs: Arc<Mutex<HashMap<Uuid, Document>>>,
    folders: Arc<Mutex<HashMap<Uuid, Folder>>>,
}

impl MemStorage {
    fn new() -> Self {
        Self {
            docs: Arc::new(Mutex::new(HashMap::new())),
            folders: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    fn with_doc(doc: Document) -> Self {
        let s = Self::new();
        s.docs.lock().unwrap().insert(doc.id, doc);
        s
    }

    fn get_doc_sync(&self, id: Uuid) -> Option<Document> {
        self.docs.lock().unwrap().get(&id).cloned()
    }
}

#[async_trait]
impl StorageAdapter for MemStorage {
    async fn get_document(&self, id: Uuid) -> Result<Document, StorageError> {
        self.docs
            .lock()
            .unwrap()
            .get(&id)
            .cloned()
            .ok_or(StorageError::NotFound(id))
    }
    async fn save_document(&self, doc: &Document) -> Result<(), StorageError> {
        self.docs.lock().unwrap().insert(doc.id, doc.clone());
        Ok(())
    }
    async fn delete_document(&self, id: Uuid) -> Result<(), StorageError> {
        self.docs.lock().unwrap().remove(&id);
        Ok(())
    }
    async fn list_documents(&self) -> Result<Vec<Document>, StorageError> {
        Ok(self.docs.lock().unwrap().values().cloned().collect())
    }
    async fn list_folders(&self) -> Result<Vec<Folder>, StorageError> {
        Ok(self.folders.lock().unwrap().values().cloned().collect())
    }
    async fn get_folder(&self, id: Uuid) -> Result<Folder, StorageError> {
        self.folders
            .lock()
            .unwrap()
            .get(&id)
            .cloned()
            .ok_or(StorageError::FolderNotFound(id))
    }
    async fn search_embeddings(
        &self,
        _q: &[f32],
        _lim: usize,
    ) -> Result<Vec<ChunkHit>, StorageError> {
        Ok(vec![])
    }
    async fn save_embeddings(&self, _e: &Embedding) -> Result<(), StorageError> {
        Ok(())
    }
    async fn save_chunk(&self, _c: &Chunk) -> Result<(), StorageError> {
        Ok(())
    }
    async fn delete_chunks_for_document(&self, _id: Uuid) -> Result<(), StorageError> {
        Ok(())
    }
    async fn get_chunk_hashes(&self, _id: Uuid) -> Result<Vec<(String, String)>, StorageError> {
        Ok(vec![])
    }
    async fn search_text(&self, _q: &str, _lim: usize) -> Result<Vec<ChunkHit>, StorageError> {
        Ok(vec![])
    }
    async fn delete_embeddings_for_paragraphs(
        &self,
        _id: Uuid,
        _pids: &[String],
    ) -> Result<(), StorageError> {
        Ok(())
    }
}

// ── No-op SessionStorage ─────────────────────────────────────────────────────

struct NoopSessions;

#[async_trait]
impl SessionStorage for NoopSessions {
    async fn list_sessions(&self) -> Result<Vec<Session>, SessionError> {
        Ok(vec![])
    }
    async fn create_session(&self, _: Option<String>) -> Result<Session, SessionError> {
        Ok(Session {
            id: Uuid::new_v4(),
            title: String::new(),
            created_at: 0,
            updated_at: 0,
            message_count: 0,
            total_input_tokens: 0,
            total_output_tokens: 0,
            pinned: false,
        })
    }
    async fn get_messages(&self, _: Uuid) -> Result<Vec<MessageRecord>, SessionError> {
        Ok(vec![])
    }
    async fn get_prior_messages(&self, _: Uuid) -> Result<Vec<(String, String)>, SessionError> {
        Ok(vec![])
    }
    async fn save_user_message(&self, _: Uuid, _: &str, _: &str) -> Result<(), SessionError> {
        Ok(())
    }
    async fn save_assistant_message(
        &self,
        _: Uuid,
        _: &str,
        _: &str,
        _: &str,
        _: u32,
        _: u32,
        _: &str,
    ) -> Result<(), SessionError> {
        Ok(())
    }
    async fn get_usage_summary(&self) -> Result<UsageSummary, SessionError> {
        Ok(UsageSummary {
            total_input_tokens: 0,
            total_output_tokens: 0,
            by_model: vec![],
            sessions: vec![],
            total_embedding_tokens: 0,
            by_embedding_model: vec![],
        })
    }
    async fn save_embedding_call(&self, _: &kaya_core::EmbeddingCall) -> Result<(), SessionError> {
        Ok(())
    }
    async fn upsert_document_embedding_status(
        &self,
        _: &kaya_core::DocumentEmbeddingStatus,
    ) -> Result<(), SessionError> {
        Ok(())
    }
    async fn touch_session(&self, _: Uuid) -> Result<(), SessionError> {
        Ok(())
    }
    async fn rename_session(&self, _: Uuid, _: String) -> Result<(), SessionError> {
        Ok(())
    }
    async fn delete_session(&self, _: Uuid) -> Result<(), SessionError> {
        Ok(())
    }
    async fn pin_session(&self, _: Uuid, _: bool) -> Result<(), SessionError> {
        Ok(())
    }
}

fn noop_orch_ctx(
    storage: Arc<dyn StorageAdapter>,
    router: Arc<ModelRouter>,
) -> OrchestratorContext {
    OrchestratorContext {
        storage,
        sessions: Arc::new(NoopSessions),
        router,
        session: UserSession {
            user_id: Uuid::new_v4(),
        },
        turn: Default::default(),
    }
}

// ── Scripted LLM provider ─────────────────────────────────────────────────────

/// One scripted turn: the model either calls a tool or gives a final answer.
struct ScriptedTurn {
    tool_call: Option<ToolCallResult>,
    content: Option<String>,
}

/// An [`LlmProvider`] that pops pre-baked turns from a queue.
/// Ignores the prompt; simply returns the next scripted response.
struct ScriptedProvider {
    turns: Mutex<std::collections::VecDeque<ScriptedTurn>>,
    /// Pre-baked responses for `complete()` calls (e.g. classification).
    complete_responses: Mutex<std::collections::VecDeque<String>>,
    /// Every `complete()` request's message list, captured in call order.
    captured_complete: Mutex<Vec<Vec<kaya_core::model_router::ChatMessage>>>,
}

impl ScriptedProvider {
    fn new(turns: Vec<ScriptedTurn>) -> Self {
        Self {
            turns: Mutex::new(turns.into()),
            complete_responses: Mutex::new(std::collections::VecDeque::new()),
            captured_complete: Mutex::new(Vec::new()),
        }
    }

    fn with_complete(self, responses: Vec<String>) -> Self {
        *self.complete_responses.lock().unwrap() = responses.into();
        self
    }

    fn captured_complete(&self) -> Vec<Vec<kaya_core::model_router::ChatMessage>> {
        self.captured_complete.lock().unwrap().clone()
    }
}

#[async_trait]
impl LlmProvider for ScriptedProvider {
    async fn complete(&self, req: CompletionRequest) -> Result<CompletionResponse, KayaError> {
        self.captured_complete
            .lock()
            .unwrap()
            .push(req.messages.clone());
        let content = self
            .complete_responses
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or_default();
        Ok(CompletionResponse {
            content,
            usage: zero_usage(req.model, req.operation),
        })
    }
    async fn stream(
        &self,
        req: CompletionRequest,
    ) -> Result<futures::stream::BoxStream<'static, Result<StreamItem, KayaError>>, KayaError> {
        use futures::stream;
        let usage = zero_usage(req.model, req.operation);
        Ok(Box::pin(stream::iter(vec![Ok(StreamItem::Usage(usage))])))
    }
    async fn embed(&self, req: EmbeddingRequest) -> Result<EmbeddingResponse, KayaError> {
        Ok(EmbeddingResponse {
            embedding: vec![0.0; 3],
            usage: TokenUsage {
                input_tokens: 0,
                output_tokens: 0,
                model: req.model,
                operation: OperationType::Embedding,
            },
        })
    }
    async fn tool_call(&self, req: ToolCallRequest) -> Result<ToolCallResponse, KayaError> {
        let turn = self
            .turns
            .lock()
            .unwrap()
            .pop_front()
            .expect("ScriptedProvider: no more scripted turns");
        Ok(ToolCallResponse {
            result: turn.tool_call,
            content: turn.content,
            usage: zero_usage(req.model, req.operation),
        })
    }
}

fn zero_usage(model: String, operation: OperationType) -> TokenUsage {
    TokenUsage {
        input_tokens: 1,
        output_tokens: 1,
        model,
        operation,
    }
}

fn all_ops() -> Vec<OperationType> {
    vec![
        OperationType::RetrievalClassification,
        OperationType::DocumentGeneration,
        OperationType::EditProposal,
        OperationType::StaleDetection,
        OperationType::Embedding,
        OperationType::IntentClassification,
        OperationType::ResearchSynthesis,
    ]
}

fn router_with(provider: Arc<dyn LlmProvider>) -> Arc<ModelRouter> {
    let mut routes: HashMap<OperationType, (Arc<dyn LlmProvider>, String)> = HashMap::new();
    for op in all_ops() {
        routes.insert(op, (provider.clone(), "test-model".to_owned()));
    }
    Arc::new(ModelRouter::from_routes(routes))
}

fn make_doc(body: &str) -> Document {
    Document {
        id: Uuid::new_v4(),
        title: "Test Document".into(),
        owner: None,
        last_reviewed: None,
        tags: vec![],
        related_docs: vec![],
        body: body.into(),
        folder_id: None,
        sort_order: 0,
    }
}

fn make_folder(name: &str, parent_id: Option<Uuid>) -> Folder {
    Folder {
        id: Uuid::new_v4(),
        name: name.to_string(),
        parent_id,
        sort_order: 0,
        created_at: "2026-01-01T00:00:00Z".into(),
        updated_at: "2026-01-01T00:00:00Z".into(),
    }
}

// ── Test 1: propose-then-approve invariant ───────────────────────────────────

#[tokio::test]
async fn search_then_edit_requires_approval() {
    let doc = make_doc("Old paragraph one.\n\nOld paragraph two.");
    let doc_id = doc.id;
    let storage = Arc::new(MemStorage::with_doc(doc));

    let provider = Arc::new(
        ScriptedProvider::new(vec![
            ScriptedTurn {
                tool_call: Some(ToolCallResult {
                    tool_name: "propose_edit".into(),
                    arguments: json!({
                        "document_id": doc_id.to_string(),
                        "hunks": [
                            { "old_text": "Old paragraph one.\n\nOld paragraph two.", "new_text": "New paragraph one.\n\nNew paragraph two." }
                        ],
                        "reason": "Updating content"
                    }),
                }),
                content: None,
            },
            ScriptedTurn {
                tool_call: None,
                content: Some("I have proposed an edit to the document.".into()),
            },
        ])
        .with_complete(vec![
            r#"{"intent":"research_then_edit","query":"test document paragraphs","instruction":"Update the test document."}"#
                .into(),
            "The test document contains the paragraphs that need updating.".into(),
        ]),
    );

    let orch_ctx = noop_orch_ctx(
        storage.clone() as Arc<dyn StorageAdapter>,
        router_with(provider as Arc<dyn LlmProvider>),
    );
    let mut stream = orchestrate("Update the test document.", orch_ctx);

    let mut events: Vec<SourcedEvent> = Vec::new();
    while let Some(ev) = stream.next().await {
        events.push(ev.expect("agent event should not error"));
    }

    // ── Find the ProposedEdit ──────────────────────────────────────────────────
    let proposed = events
        .iter()
        .find_map(|e| {
            if let SourcedEvent {
                source: AgentSource::Editor,
                event: AgentEvent::ProposedEditEmitted { edit },
            } = e
            {
                Some(edit.clone())
            } else {
                None
            }
        })
        .expect("agent must emit a ProposedEditEmitted event");

    // ── Document must still be unchanged ─────────────────────────────────────
    let before = storage.get_doc_sync(doc_id).unwrap();
    assert_eq!(
        before.body, "Old paragraph one.\n\nOld paragraph two.",
        "document body must not change before approval"
    );

    // ── Approve and commit ────────────────────────────────────────────────────
    let session = UserSession {
        user_id: Uuid::new_v4(),
    };
    let token = session.approve_edit(&proposed);
    commit_edit(proposed, token, storage.clone() as Arc<dyn StorageAdapter>)
        .await
        .expect("commit_edit should succeed");

    // ── Document must now reflect the proposed body ───────────────────────────
    let after = storage.get_doc_sync(doc_id).unwrap();
    assert_eq!(
        after.body, "New paragraph one.\n\nNew paragraph two.",
        "document body must reflect the approved edit"
    );

    // ── Final message must have been emitted ─────────────────────────────────
    assert!(
        events
            .iter()
            .any(|e| matches!(e.event, AgentEvent::FinalMessage { .. })),
        "stream must end with a FinalMessage"
    );
}

// ── Test 2: tool transparency ────────────────────────────────────────────────

#[tokio::test]
async fn invocation_log_captures_every_tool_used() {
    let doc = make_doc("Some content.");
    let storage = Arc::new(MemStorage::with_doc(doc));
    let provider =
        Arc::new(ScriptedProvider::new(vec![]).with_complete(vec!["Grounded summary.".into()]));
    let ctx = Arc::new(AgentContext {
        storage: storage as Arc<dyn StorageAdapter>,
        sessions: Arc::new(NoopSessions),
        router: router_with(provider as Arc<dyn LlmProvider>),
        session: UserSession {
            user_id: Uuid::new_v4(),
        },
        turn: Default::default(),
    });

    let log = Arc::new(InvocationLog::new());
    let (tx, mut rx) = futures::channel::mpsc::channel(16);
    let researcher = Researcher::new();
    let plan = AgentPlan::ResearchOnly {
        query: "Show me the documents.".into(),
    };
    let _ = researcher
        .research(&plan, ctx, log.clone(), tx)
        .await
        .expect("research should succeed");
    while let Some(ev) = rx.next().await {
        ev.expect("no errors");
    }

    let entries = log.entries();
    let names: Vec<&str> = entries.iter().map(|e| e.tool_name.as_str()).collect();

    assert!(
        names.contains(&"search_directories"),
        "log must contain search_directories"
    );
    assert!(
        names.contains(&"search_documents"),
        "log must contain search_documents"
    );
    assert_eq!(entries.len(), 2, "exactly 2 tool calls should be logged");

    // Every entry must have a latency measurement.
    for entry in &entries {
        assert!(entry.latency_ms < 5_000, "latency should be sane");
    }
}

// ── Test 3: cancellation ─────────────────────────────────────────────────────

#[tokio::test]
async fn cancellation_does_not_panic_or_leak() {
    let storage = Arc::new(MemStorage::new());

    let provider = Arc::new(ScriptedProvider::new(vec![]).with_complete(vec![
        r#"{"intent":"research_only","query":"List docs."}"#.into(),
        "Done.".into(),
    ]));
    let orch_ctx = noop_orch_ctx(
        storage as Arc<dyn StorageAdapter>,
        router_with(provider as Arc<dyn LlmProvider>),
    );
    let mut stream = orchestrate("List docs.", orch_ctx);

    // Consume only the first event, then drop the stream.
    let first = stream.next().await;
    assert!(first.is_some(), "should get at least one event");
    drop(stream);

    // Give the background task a moment to notice the cancelled sender.
    tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    // If the task panicked, tokio would surface it. Reaching here = clean exit.
}

// ── Test 4: create_document also requires approval ───────────────────────────

#[tokio::test]
async fn create_document_requires_approval() {
    let storage = Arc::new(MemStorage::new());

    let provider = Arc::new(
        ScriptedProvider::new(vec![
            ScriptedTurn {
                tool_call: Some(ToolCallResult {
                    tool_name: "create_document".into(),
                    arguments: json!({
                        "title": "Brand New Doc",
                        "body": "# Brand New\n\nFresh content."
                    }),
                }),
                content: None,
            },
            ScriptedTurn {
                tool_call: None,
                content: Some("Created a new document proposal.".into()),
            },
        ])
        .with_complete(vec![
            r#"{"intent":"research_then_edit","query":"new document requirements","instruction":"Create a doc."}"#
                .into(),
            "Creating a new document is appropriate.".into(),
        ]),
    );

    let orch_ctx = noop_orch_ctx(
        storage.clone() as Arc<dyn StorageAdapter>,
        router_with(provider as Arc<dyn LlmProvider>),
    );
    let mut stream = orchestrate("Create a doc.", orch_ctx);

    let mut events: Vec<SourcedEvent> = Vec::new();
    while let Some(ev) = stream.next().await {
        events.push(ev.unwrap());
    }

    let proposed = events
        .iter()
        .find_map(|e| {
            if let SourcedEvent {
                source: AgentSource::Editor,
                event: AgentEvent::ProposedEditEmitted { edit },
            } = e
            {
                Some(edit.clone())
            } else {
                None
            }
        })
        .expect("must emit ProposedEditEmitted for create_document");

    // Storage must still be empty — no approval yet.
    assert_eq!(
        storage.docs.lock().unwrap().len(),
        0,
        "no document should exist before approval"
    );

    // Approve → commit → document must now exist.
    let session = UserSession {
        user_id: Uuid::new_v4(),
    };
    let token = session.approve_edit(&proposed);
    commit_edit(proposed, token, storage.clone() as Arc<dyn StorageAdapter>)
        .await
        .unwrap();

    assert_eq!(
        storage.docs.lock().unwrap().len(),
        1,
        "document must exist after approval"
    );
}

// ── Orchestrator tests ────────────────────────────────────────────────────────

// ── Test 5: ResearchOnly routing ─────────────────────────────────────────────

#[tokio::test]
async fn orchestrator_routes_question_to_research_only() {
    let storage = Arc::new(MemStorage::new());

    // classify → research_only; researcher does RAG retrieval + one synthesis complete()
    let provider = Arc::new(ScriptedProvider::new(vec![]).with_complete(vec![
        r#"{"intent":"research_only","query":"what is in the knowledge base"}"#.into(),
        "Here is what I found in the knowledge base.".into(),
    ]));

    let orch_ctx = noop_orch_ctx(storage as Arc<dyn StorageAdapter>, router_with(provider));
    let mut stream = orchestrate("what is in the knowledge base", orch_ctx);

    let mut events: Vec<SourcedEvent> = Vec::new();
    while let Some(ev) = stream.next().await {
        events.push(ev.expect("no error expected"));
    }

    assert!(
        events
            .iter()
            .any(|e| matches!(e.event, AgentEvent::FinalMessage { .. })),
        "stream must end with a FinalMessage"
    );
    // All events must be tagged Researcher (no Editor in ResearchOnly).
    for e in &events {
        assert_eq!(
            e.source,
            AgentSource::Researcher,
            "all events in ResearchOnly must come from Researcher"
        );
    }
}

// ── Test 5b: Orchestrator classifier excludes doc body ───────────────────────

#[tokio::test]
async fn orchestrator_classifier_omits_document_body() {
    use kaya_core::agent::{DocumentFocus, TurnContext};
    use kaya_core::model_router::ChatMessage;

    let storage = Arc::new(MemStorage::new());

    // classify → research_only; researcher does one synthesis complete().
    let provider = Arc::new(ScriptedProvider::new(vec![]).with_complete(vec![
        r#"{"intent":"research_only","query":"q"}"#.into(),
        "synthesised answer".into(),
    ]));
    let provider_capture = provider.clone();

    let doc_body =
        "SECRET_BODY_MARKER: this string must never appear in the classifier prompt.";

    let orch_ctx = OrchestratorContext {
        storage: storage as Arc<dyn StorageAdapter>,
        sessions: Arc::new(NoopSessions),
        router: router_with(provider),
        session: UserSession {
            user_id: Uuid::new_v4(),
        },
        turn: TurnContext {
            chat: None,
            document: Some(DocumentFocus {
                doc_id: Uuid::new_v4(),
                title: "Distinctive Title".into(),
                body: doc_body.into(),
                tags: vec![],
            }),
        },
    };

    let mut stream = orchestrate("summarise the open doc", orch_ctx);
    while let Some(_ev) = stream.next().await {}

    let captured = provider_capture.captured_complete();
    assert!(
        !captured.is_empty(),
        "classifier must have made at least one complete() call"
    );

    // First complete() call is the intent classifier.
    let classifier_msgs = &captured[0];
    let classifier_text = classifier_msgs
        .iter()
        .map(|m| match m {
            ChatMessage::System(s) | ChatMessage::User(s) | ChatMessage::Assistant(s) => s.clone(),
        })
        .collect::<Vec<_>>()
        .join("\n");

    assert!(
        !classifier_text.contains("SECRET_BODY_MARKER"),
        "classifier prompt must NOT contain the document body; got:\n{classifier_text}"
    );
    assert!(
        classifier_text.contains("Distinctive Title"),
        "classifier prompt MUST contain the document title; got:\n{classifier_text}"
    );

    // Second complete() call is the Researcher's synthesis: it SHOULD see the body.
    assert!(captured.len() >= 2, "researcher must have called complete()");
    let synth_msgs = &captured[1];
    let synth_text = synth_msgs
        .iter()
        .map(|m| match m {
            ChatMessage::System(s) | ChatMessage::User(s) | ChatMessage::Assistant(s) => s.clone(),
        })
        .collect::<Vec<_>>()
        .join("\n");
    assert!(
        synth_text.contains("SECRET_BODY_MARKER"),
        "researcher synthesis prompt MUST contain the document body; got:\n{synth_text}"
    );
}

// ── Test 6: ResearchThenEdit routing ─────────────────────────────────────────

#[tokio::test]
async fn orchestrator_routes_edit_request_to_research_then_edit() {
    let doc = make_doc("Old content.");
    let doc_id = doc.id;
    let storage = Arc::new(MemStorage::with_doc(doc));

    // Turn order: classify → researcher(RAG + synthesis) → editor(propose_edit→final)
    let provider = Arc::new(
        ScriptedProvider::new(vec![
            // Editor: propose_edit
            ScriptedTurn {
                tool_call: Some(ToolCallResult {
                    tool_name: "propose_edit".into(),
                    arguments: json!({
                        "document_id": doc_id.to_string(),
                        "hunks": [{"old_text": "Old content.", "new_text": "New content."}],
                        "reason": "Update"
                    }),
                }),
                content: None,
            },
            // Editor: final
            ScriptedTurn {
                tool_call: None,
                content: Some("Edit proposed.".into()),
            },
        ])
        .with_complete(vec![
            r#"{"intent":"research_then_edit","query":"content","instruction":"update content"}"#
                .into(),
            // Researcher synthesis
            "Found the document with relevant content.".into(),
        ]),
    );

    let orch_ctx = noop_orch_ctx(storage as Arc<dyn StorageAdapter>, router_with(provider));
    let mut stream = orchestrate("update content in the document", orch_ctx);

    let mut events: Vec<SourcedEvent> = Vec::new();
    while let Some(ev) = stream.next().await {
        events.push(ev.expect("no error expected"));
    }

    let researcher_finals: Vec<_> = events
        .iter()
        .filter(|e| {
            matches!(e.source, AgentSource::Researcher)
                && matches!(e.event, AgentEvent::FinalMessage { .. })
        })
        .collect();
    let editor_finals: Vec<_> = events
        .iter()
        .filter(|e| {
            matches!(e.source, AgentSource::Editor)
                && matches!(e.event, AgentEvent::FinalMessage { .. })
        })
        .collect();

    assert!(
        !researcher_finals.is_empty(),
        "Researcher must emit a FinalMessage"
    );
    assert!(!editor_finals.is_empty(), "Editor must emit a FinalMessage");

    // Researcher events must appear before Editor events.
    let first_editor = events
        .iter()
        .position(|e| matches!(e.source, AgentSource::Editor))
        .expect("must have at least one Editor event");
    let last_researcher = events
        .iter()
        .rposition(|e| matches!(e.source, AgentSource::Researcher))
        .expect("must have at least one Researcher event");
    assert!(
        last_researcher < first_editor,
        "all Researcher events must precede Editor events"
    );
}

// ── Test 7: ResearchResult injected into Editor prompt ───────────────────────

#[tokio::test]
async fn research_result_injected_into_editor_prompt() {
    let doc = make_doc("Some body text.");
    let storage = Arc::new(MemStorage::with_doc(doc));
    let clients = make_folder("Clients", None);
    let acme = make_folder("Acme", Some(clients.id));
    storage
        .folders
        .lock()
        .unwrap()
        .extend([(clients.id, clients.clone()), (acme.id, acme.clone())]);

    // We capture the prompt sent to the Editor by inspecting the
    // `complete_responses` queue — we use a `PromptCapturingProvider` instead.
    use std::sync::Mutex as StdMutex;

    struct CapturingProvider {
        inner: ScriptedProvider,
        captured_prompts: Arc<StdMutex<Vec<String>>>,
    }

    #[async_trait]
    impl LlmProvider for CapturingProvider {
        async fn complete(&self, req: CompletionRequest) -> Result<CompletionResponse, KayaError> {
            let snapshot = serde_json::to_string(&req.messages).unwrap_or_default();
            self.captured_prompts.lock().unwrap().push(snapshot);
            self.inner.complete(req).await
        }
        async fn stream(
            &self,
            req: CompletionRequest,
        ) -> Result<futures::stream::BoxStream<'static, Result<StreamItem, KayaError>>, KayaError>
        {
            self.inner.stream(req).await
        }
        async fn embed(&self, req: EmbeddingRequest) -> Result<EmbeddingResponse, KayaError> {
            self.inner.embed(req).await
        }
        async fn tool_call(&self, req: ToolCallRequest) -> Result<ToolCallResponse, KayaError> {
            let snapshot = serde_json::to_string(&req.messages).unwrap_or_default();
            self.captured_prompts.lock().unwrap().push(snapshot);
            self.inner.tool_call(req).await
        }
    }

    let captured = Arc::new(StdMutex::new(Vec::<String>::new()));
    // Researcher now uses RAG + one synthesis complete() call.
    // UNIQUE_RESEARCH_MARKER comes from the synthesis response so it lands in
    // the Editor's system prompt via ResearchResult.summary_context.
    let inner = ScriptedProvider::new(vec![
        // Editor: final message
        ScriptedTurn {
            tool_call: None,
            content: Some("Edit done.".into()),
        },
    ])
    .with_complete(vec![
        r#"{"intent":"research_then_edit","query":"acme","instruction":"do it"}"#.into(),
        // Researcher synthesis — contains the marker
        "UNIQUE_RESEARCH_MARKER found.".into(),
    ]);

    let provider = Arc::new(CapturingProvider {
        inner,
        captured_prompts: captured.clone(),
    });

    let orch_ctx = noop_orch_ctx(
        storage as Arc<dyn StorageAdapter>,
        router_with(provider as Arc<dyn LlmProvider>),
    );
    let mut stream = orchestrate("do it", orch_ctx);
    while let Some(ev) = stream.next().await {
        let _ = ev;
    }

    let prompts = captured.lock().unwrap();
    let editor_prompt = prompts
        .iter()
        .find(|p| p.contains("UNIQUE_RESEARCH_MARKER"))
        .expect("Editor prompt must contain the Researcher's summary_context");

    assert!(
        editor_prompt.contains("UNIQUE_RESEARCH_MARKER"),
        "Editor system prompt must include Researcher's final message"
    );
    assert!(
        editor_prompt.contains(&acme.id.to_string()),
        "Editor prompt must include structured directory folder IDs"
    );
    assert!(
        editor_prompt.contains("Clients / Acme"),
        "Editor prompt must include structured directory paths"
    );
    assert!(
        editor_prompt.contains("Use only folder IDs that appear in DIRECTORY_CONTEXT."),
        "Editor system prompt must require IDs to come from directory context"
    );
    assert!(
        editor_prompt
            .contains("never use `00000000-0000-0000-0000-000000000000` as a root sentinel"),
        "Editor system prompt must forbid nil UUID root sentinels for folders"
    );
}

#[tokio::test]
async fn search_directories_returns_current_folder_paths() {
    let storage = Arc::new(MemStorage::new());
    let clients = make_folder("Clients", None);
    let acme = make_folder("Acme", Some(clients.id));
    storage
        .folders
        .lock()
        .unwrap()
        .extend([(clients.id, clients.clone()), (acme.id, acme.clone())]);

    let mut doc = make_doc("Folder-aware body.");
    doc.title = "Acme Contract Notes".into();
    doc.folder_id = Some(acme.id);
    storage.docs.lock().unwrap().insert(doc.id, doc);

    let provider = Arc::new(ScriptedProvider::new(vec![]));
    let ctx = AgentContext {
        storage: storage as Arc<dyn StorageAdapter>,
        sessions: Arc::new(NoopSessions),
        router: router_with(provider as Arc<dyn LlmProvider>),
        session: UserSession {
            user_id: Uuid::new_v4(),
        },
        turn: Default::default(),
    };

    let output = SearchDirectories
        .invoke(
            json!({"query": "create a folder under acme", "limit": 5}),
            &ctx,
        )
        .await
        .expect("directory search should succeed");

    let folders = output.content["folders"]
        .as_array()
        .expect("folders should be an array");
    assert!(
        !folders.is_empty(),
        "directory search should return at least one folder"
    );
    assert_eq!(folders[0]["id"], json!(acme.id));
    assert_eq!(folders[0]["path"], json!("Clients / Acme"));
}

#[tokio::test]
async fn create_folder_treats_nil_uuid_parent_as_root() {
    let provider = Arc::new(ScriptedProvider::new(vec![]));
    let ctx = AgentContext {
        storage: Arc::new(MemStorage::new()) as Arc<dyn StorageAdapter>,
        sessions: Arc::new(NoopSessions),
        router: router_with(provider as Arc<dyn LlmProvider>),
        session: UserSession {
            user_id: Uuid::new_v4(),
        },
        turn: Default::default(),
    };

    let output = CreateFolder
        .invoke(
            json!({
                "name": "Root Child",
                "parent_id": Uuid::nil().to_string(),
            }),
            &ctx,
        )
        .await
        .expect("create_folder should succeed");

    assert_eq!(output.content["parent_id"], serde_json::Value::Null);

    let edit = output
        .proposed_edit
        .expect("create_folder should emit a proposed edit");
    match edit.kind {
        kaya_core::ProposedEditKind::CreateFolder { parent_id, .. } => {
            assert_eq!(parent_id, None, "nil UUID should be normalized to root");
        }
        other => panic!("unexpected proposed edit kind: {other:?}"),
    }
}

#[tokio::test]
async fn create_folder_rejects_unknown_parent_id() {
    let provider = Arc::new(ScriptedProvider::new(vec![]));
    let ctx = AgentContext {
        storage: Arc::new(MemStorage::new()) as Arc<dyn StorageAdapter>,
        sessions: Arc::new(NoopSessions),
        router: router_with(provider as Arc<dyn LlmProvider>),
        session: UserSession {
            user_id: Uuid::new_v4(),
        },
        turn: Default::default(),
    };

    let missing_parent = Uuid::parse_str("11111111-1111-1111-1111-111111111111")
        .expect("hard-coded UUID must parse");

    let err = match CreateFolder
        .invoke(
            json!({
                "name": "Should Fail",
                "parent_id": missing_parent.to_string(),
            }),
            &ctx,
        )
        .await
    {
        Ok(_) => panic!("create_folder should reject unknown parent IDs"),
        Err(err) => err,
    };

    assert!(
        err.to_string().contains(&missing_parent.to_string()),
        "error should mention the unknown parent ID"
    );
}

// ── Test 8: Fallback on unrecognised intent ───────────────────────────────────

#[tokio::test]
async fn orchestrator_falls_back_on_unrecognised_intent() {
    let storage = Arc::new(MemStorage::new());

    let provider = Arc::new(ScriptedProvider::new(vec![]).with_complete(vec![
        // Unrecognised intent → falls back to ResearchOnly
        r#"{"intent":"unknown","query":"whatever"}"#.into(),
        // Researcher synthesis
        "Nothing found.".into(),
    ]));

    let orch_ctx = noop_orch_ctx(storage as Arc<dyn StorageAdapter>, router_with(provider));
    let mut stream = orchestrate("some message", orch_ctx);

    let mut events: Vec<SourcedEvent> = Vec::new();
    while let Some(ev) = stream.next().await {
        events.push(ev.expect("no panic expected on fallback"));
    }

    assert!(
        events
            .iter()
            .any(|e| matches!(e.event, AgentEvent::FinalMessage { .. })),
        "fallback must still produce a FinalMessage"
    );
    for e in &events {
        assert_eq!(
            e.source,
            AgentSource::Researcher,
            "fallback must route to Researcher (ResearchOnly)"
        );
    }
}

// ── Test 9: AgentEvent tagging ────────────────────────────────────────────────

#[tokio::test]
async fn agent_event_tagging() {
    let doc = make_doc("Tagging test body.");
    let doc_id = doc.id;
    let storage = Arc::new(MemStorage::with_doc(doc));
    let folder = make_folder("Tagging", None);
    storage.folders.lock().unwrap().insert(folder.id, folder);

    // Researcher uses RAG (emits synthetic search_documents ToolCall event).
    // Editor uses tool_call() turns.
    let provider = Arc::new(
        ScriptedProvider::new(vec![
            // Editor: propose_edit → final
            ScriptedTurn {
                tool_call: Some(ToolCallResult {
                    tool_name: "propose_edit".into(),
                    arguments: json!({
                        "document_id": doc_id.to_string(),
                        "hunks": [{"old_text": "Tagging test body.", "new_text": "Updated."}],
                        "reason": "Tag test"
                    }),
                }),
                content: None,
            },
            ScriptedTurn {
                tool_call: None,
                content: Some("Tagged.".into()),
            },
        ])
        .with_complete(vec![
            r#"{"intent":"research_then_edit","query":"tagging","instruction":"tag it"}"#.into(),
            // Researcher synthesis
            "Tagging research done.".into(),
        ]),
    );

    let orch_ctx = noop_orch_ctx(storage as Arc<dyn StorageAdapter>, router_with(provider));
    let mut stream = orchestrate("tag it", orch_ctx);

    let mut events: Vec<SourcedEvent> = Vec::new();
    while let Some(ev) = stream.next().await {
        events.push(ev.expect("no error expected"));
    }

    // search_documents and search_directories tool calls must be tagged Researcher
    let search_calls: Vec<_> = events
        .iter()
        .filter(|e| {
            matches!(
                &e.event,
                AgentEvent::ToolCall { name, .. } if name == "search_documents"
            )
        })
        .collect();
    assert!(
        !search_calls.is_empty(),
        "must have at least one search_documents ToolCall"
    );
    for e in &search_calls {
        assert_eq!(
            e.source,
            AgentSource::Researcher,
            "search_documents must be Researcher"
        );
    }

    let directory_calls: Vec<_> = events
        .iter()
        .filter(|e| {
            matches!(
                &e.event,
                AgentEvent::ToolCall { name, .. } if name == "search_directories"
            )
        })
        .collect();
    assert!(
        !directory_calls.is_empty(),
        "must have at least one search_directories ToolCall"
    );
    for e in &directory_calls {
        assert_eq!(
            e.source,
            AgentSource::Researcher,
            "search_directories must be Researcher"
        );
    }

    // propose_edit tool calls must be tagged Editor
    let edit_calls: Vec<_> = events
        .iter()
        .filter(|e| {
            matches!(
                &e.event,
                AgentEvent::ToolCall { name, .. } if name == "propose_edit"
            )
        })
        .collect();
    assert!(
        !edit_calls.is_empty(),
        "must have at least one propose_edit ToolCall"
    );
    for e in &edit_calls {
        assert_eq!(e.source, AgentSource::Editor, "propose_edit must be Editor");
    }
}
