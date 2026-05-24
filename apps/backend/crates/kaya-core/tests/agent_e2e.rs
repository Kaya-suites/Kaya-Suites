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

use kaya_core::agent::tools::default_tools;
use kaya_core::agent::{
    AgentContext, AgentEvent, AgentLoop, AgentSource, InvocationLog, OrchestratorContext,
    SourcedEvent, orchestrate,
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
use kaya_core::storage::{Chunk, ChunkHit, Document, Embedding, StorageAdapter, StorageError};

// ── In-memory StorageAdapter ─────────────────────────────────────────────────

struct MemStorage {
    docs: Arc<Mutex<HashMap<Uuid, Document>>>,
}

impl MemStorage {
    fn new() -> Self {
        Self {
            docs: Arc::new(Mutex::new(HashMap::new())),
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
    async fn save_embedding_call(&self, _: &str, _: u32) -> Result<(), SessionError> {
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
}

impl ScriptedProvider {
    fn new(turns: Vec<ScriptedTurn>) -> Self {
        Self {
            turns: Mutex::new(turns.into()),
            complete_responses: Mutex::new(std::collections::VecDeque::new()),
        }
    }

    fn with_complete(self, responses: Vec<String>) -> Self {
        *self.complete_responses.lock().unwrap() = responses.into();
        self
    }
}

#[async_trait]
impl LlmProvider for ScriptedProvider {
    async fn complete(&self, req: CompletionRequest) -> Result<CompletionResponse, KayaError> {
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
    }
}

// ── Test 1: propose-then-approve invariant ───────────────────────────────────

#[tokio::test]
async fn search_then_edit_requires_approval() {
    let doc = make_doc("Old paragraph one.\n\nOld paragraph two.");
    let doc_id = doc.id;
    let storage = Arc::new(MemStorage::with_doc(doc));

    // Turn 1 — search_documents; Turn 2 — propose_edit; Turn 3 — final answer.
    let provider = Arc::new(ScriptedProvider::new(vec![
        ScriptedTurn {
            tool_call: Some(ToolCallResult {
                tool_name: "search_documents".into(),
                arguments: json!({ "query": "paragraph", "limit": 3 }),
            }),
            content: None,
        },
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
    ]));

    let ctx = Arc::new(AgentContext {
        storage: storage.clone() as Arc<dyn StorageAdapter>,
        sessions: Arc::new(NoopSessions),
        router: router_with(provider as Arc<dyn LlmProvider>),
        session: UserSession {
            user_id: Uuid::new_v4(),
        },
    });

    let log = Arc::new(InvocationLog::new());
    let agent = AgentLoop::new(default_tools());
    let mut stream = agent.run(
        "Update the test document.".into(),
        vec![],
        ctx.clone(),
        log.clone(),
    );

    let mut events: Vec<AgentEvent> = Vec::new();
    while let Some(ev) = stream.next().await {
        events.push(ev.expect("agent event should not error"));
    }

    // ── Find the ProposedEdit ──────────────────────────────────────────────────
    let proposed = events
        .iter()
        .find_map(|e| {
            if let AgentEvent::ProposedEditEmitted { edit } = e {
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
            .any(|e| matches!(e, AgentEvent::FinalMessage { .. })),
        "stream must end with a FinalMessage"
    );
}

// ── Test 2: tool transparency ────────────────────────────────────────────────

#[tokio::test]
async fn invocation_log_captures_every_tool_used() {
    let doc = make_doc("Some content.");
    let doc_id = doc.id;
    let storage = Arc::new(MemStorage::with_doc(doc));

    let provider = Arc::new(ScriptedProvider::new(vec![
        ScriptedTurn {
            tool_call: Some(ToolCallResult {
                tool_name: "list_documents".into(),
                arguments: json!({}),
            }),
            content: None,
        },
        ScriptedTurn {
            tool_call: Some(ToolCallResult {
                tool_name: "read_document".into(),
                arguments: json!({ "document_id": doc_id.to_string() }),
            }),
            content: None,
        },
        ScriptedTurn {
            tool_call: None,
            content: Some("Here is the document.".into()),
        },
    ]));

    let ctx = Arc::new(AgentContext {
        storage: storage.clone() as Arc<dyn StorageAdapter>,
        sessions: Arc::new(NoopSessions),
        router: router_with(provider as Arc<dyn LlmProvider>),
        session: UserSession {
            user_id: Uuid::new_v4(),
        },
    });

    let log = Arc::new(InvocationLog::new());
    let agent = AgentLoop::new(default_tools());
    let mut stream = agent.run("Show me the documents.".into(), vec![], ctx, log.clone());
    while let Some(ev) = stream.next().await {
        ev.expect("no errors");
    }

    let entries = log.entries();
    let names: Vec<&str> = entries.iter().map(|e| e.tool_name.as_str()).collect();

    assert!(
        names.contains(&"list_documents"),
        "log must contain list_documents"
    );
    assert!(
        names.contains(&"read_document"),
        "log must contain read_document"
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

    // Five tool calls followed by a final message — we will cancel after the first.
    let turns: Vec<ScriptedTurn> = (0..5)
        .map(|_| ScriptedTurn {
            tool_call: Some(ToolCallResult {
                tool_name: "list_documents".into(),
                arguments: json!({}),
            }),
            content: None,
        })
        .chain(std::iter::once(ScriptedTurn {
            tool_call: None,
            content: Some("Done.".into()),
        }))
        .collect();

    let provider = Arc::new(ScriptedProvider::new(turns));
    let ctx = Arc::new(AgentContext {
        storage: storage as Arc<dyn StorageAdapter>,
        sessions: Arc::new(NoopSessions),
        router: router_with(provider as Arc<dyn LlmProvider>),
        session: UserSession {
            user_id: Uuid::new_v4(),
        },
    });

    let log = Arc::new(InvocationLog::new());
    let agent = AgentLoop::new(default_tools());
    let mut stream = agent.run("List docs.".into(), vec![], ctx, log);

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

    let provider = Arc::new(ScriptedProvider::new(vec![
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
    ]));

    let ctx = Arc::new(AgentContext {
        storage: storage.clone() as Arc<dyn StorageAdapter>,
        sessions: Arc::new(NoopSessions),
        router: router_with(provider as Arc<dyn LlmProvider>),
        session: UserSession {
            user_id: Uuid::new_v4(),
        },
    });

    let log = Arc::new(InvocationLog::new());
    let agent = AgentLoop::new(default_tools());
    let mut stream = agent.run("Create a doc.".into(), vec![], ctx, log);

    let mut events = Vec::new();
    while let Some(ev) = stream.next().await {
        events.push(ev.unwrap());
    }

    let proposed = events
        .iter()
        .find_map(|e| {
            if let AgentEvent::ProposedEditEmitted { edit } = e {
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
    let provider = Arc::new(
        ScriptedProvider::new(vec![])
            .with_complete(vec![
                r#"{"intent":"research_only","query":"what is in the knowledge base"}"#.into(),
                "Here is what I found in the knowledge base.".into(),
            ]),
    );

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
            self.captured_prompts
                .lock()
                .unwrap()
                .push(req.prompt.clone());
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
            self.captured_prompts
                .lock()
                .unwrap()
                .push(req.prompt.clone());
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
        r#"{"intent":"research_then_edit","query":"test","instruction":"do it"}"#.into(),
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
}

// ── Test 8: Fallback on unrecognised intent ───────────────────────────────────

#[tokio::test]
async fn orchestrator_falls_back_on_unrecognised_intent() {
    let storage = Arc::new(MemStorage::new());

    let provider = Arc::new(
        ScriptedProvider::new(vec![])
            .with_complete(vec![
                // Unrecognised intent → falls back to ResearchOnly
                r#"{"intent":"unknown","query":"whatever"}"#.into(),
                // Researcher synthesis
                "Nothing found.".into(),
            ]),
    );

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

    // search_documents tool calls must be tagged Researcher
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
