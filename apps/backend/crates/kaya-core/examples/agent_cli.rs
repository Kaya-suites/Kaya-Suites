//! CLI harness for the Kaya orchestrated agent flow.
//!
//! Runs one agent turn against a mock in-memory knowledge base, prints each
//! event as it arrives, and shows the propose-then-approve flow end-to-end.
//!
//! ```
//! cargo run -p kaya-core --example agent_cli
//! ```

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use futures::StreamExt;
use serde_json::json;
use uuid::Uuid;

use kaya_core::agent::{AgentEvent, AgentSource, OrchestratorContext, SourcedEvent, orchestrate};
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

// ── Minimal in-memory storage ────────────────────────────────────────────────

struct Mem(Arc<Mutex<HashMap<Uuid, Document>>>);

impl Mem {
    fn new(docs: Vec<Document>) -> Arc<Self> {
        let map: HashMap<_, _> = docs.into_iter().map(|d| (d.id, d)).collect();
        Arc::new(Self(Arc::new(Mutex::new(map))))
    }
}

#[async_trait]
impl StorageAdapter for Mem {
    async fn get_document(&self, id: Uuid) -> Result<Document, StorageError> {
        self.0
            .lock()
            .unwrap()
            .get(&id)
            .cloned()
            .ok_or(StorageError::NotFound(id))
    }
    async fn save_document(&self, doc: &Document) -> Result<(), StorageError> {
        self.0.lock().unwrap().insert(doc.id, doc.clone());
        Ok(())
    }
    async fn delete_document(&self, id: Uuid) -> Result<(), StorageError> {
        self.0.lock().unwrap().remove(&id);
        Ok(())
    }
    async fn list_documents(&self) -> Result<Vec<Document>, StorageError> {
        Ok(self.0.lock().unwrap().values().cloned().collect())
    }
    async fn list_folders(&self) -> Result<Vec<kaya_core::storage::Folder>, StorageError> {
        Ok(vec![])
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

// ── Scripted mock provider ───────────────────────────────────────────────────

struct MockProvider {
    turns: Mutex<std::collections::VecDeque<(Option<ToolCallResult>, Option<String>)>>,
    complete_responses: Mutex<std::collections::VecDeque<String>>,
}

impl MockProvider {
    fn new(
        turns: Vec<(Option<ToolCallResult>, Option<String>)>,
        complete_responses: Vec<String>,
    ) -> Arc<Self> {
        Arc::new(Self {
            turns: Mutex::new(turns.into()),
            complete_responses: Mutex::new(complete_responses.into()),
        })
    }
}

#[async_trait]
impl LlmProvider for MockProvider {
    async fn complete(&self, r: CompletionRequest) -> Result<CompletionResponse, KayaError> {
        Ok(CompletionResponse {
            content: self
                .complete_responses
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or_default(),
            usage: usage(r.model, r.operation),
        })
    }
    async fn stream(
        &self,
        r: CompletionRequest,
    ) -> Result<futures::stream::BoxStream<'static, Result<StreamItem, KayaError>>, KayaError> {
        Ok(Box::pin(futures::stream::iter(vec![Ok(
            StreamItem::Usage(usage(r.model, r.operation)),
        )])))
    }
    async fn embed(&self, r: EmbeddingRequest) -> Result<EmbeddingResponse, KayaError> {
        Ok(EmbeddingResponse {
            embedding: vec![0.0; 3],
            usage: TokenUsage {
                input_tokens: 0,
                output_tokens: 0,
                model: r.model,
                operation: OperationType::Embedding,
            },
        })
    }
    async fn tool_call(&self, r: ToolCallRequest) -> Result<ToolCallResponse, KayaError> {
        let (tc, content) = self
            .turns
            .lock()
            .unwrap()
            .pop_front()
            .expect("mock ran out of scripted turns");
        Ok(ToolCallResponse {
            result: tc,
            content,
            usage: usage(r.model, r.operation),
        })
    }
}

fn usage(model: String, operation: OperationType) -> TokenUsage {
    TokenUsage {
        input_tokens: 5,
        output_tokens: 10,
        model,
        operation,
    }
}

fn router(p: Arc<dyn LlmProvider>) -> Arc<ModelRouter> {
    let mut routes = HashMap::new();
    for op in [
        OperationType::RetrievalClassification,
        OperationType::DocumentGeneration,
        OperationType::EditProposal,
        OperationType::StaleDetection,
        OperationType::Embedding,
        OperationType::IntentClassification,
        OperationType::ResearchSynthesis,
    ] {
        routes.insert(op, (p.clone(), "mock-model".to_owned()));
    }
    Arc::new(ModelRouter::from_routes(routes))
}

// ── No-op SessionStorage ──────────────────────────────────────────────────────

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

// ── main ─────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    // Seed the knowledge base with one document.
    let doc_id = Uuid::new_v4();
    let doc = Document {
        id: doc_id,
        title: "Onboarding Guide".into(),
        owner: Some("alice@example.com".into()),
        last_reviewed: None,
        tags: vec!["onboarding".into()],
        related_docs: vec![],
        body: "Welcome to the team.\n\nThis guide covers your first week.".into(),
        folder_id: None,
        sort_order: 0,
    };
    let storage = Mem::new(vec![doc]);

    // Script the model: search → propose_edit → final answer.
    let provider = MockProvider::new(
        vec![
        (
            Some(ToolCallResult {
                tool_name: "propose_edit".into(),
                arguments: json!({
                    "document_id": doc_id.to_string(),
                    "hunks": [
                        { "old_text": "This guide covers your first week.", "new_text": "This guide covers your first week.\n\nCheck the wiki for more resources." }
                    ],
                    "reason": "Added wiki link paragraph"
                }),
            }),
            None,
        ),
        (
            None,
            Some("I've proposed adding a wiki link to the onboarding guide. Please review and approve.".into()),
        ),
        ],
        vec![
            r#"{"intent":"research_then_edit","query":"onboarding guide","instruction":"Update the onboarding guide."}"#
                .into(),
            "The onboarding guide exists and is the right place for the requested wiki-link update.".into(),
        ],
    );

    let session = UserSession {
        user_id: Uuid::new_v4(),
    };
    let ctx = OrchestratorContext {
        storage: storage.clone() as Arc<dyn StorageAdapter>,
        sessions: Arc::new(NoopSessions),
        router: router(provider as Arc<dyn LlmProvider>),
        session: session.clone(),
        turn: Default::default(),
    };

    println!("── Agent turn ─────────────────────────────────────────────────");
    println!("User: Update the onboarding guide.\n");

    let mut stream = orchestrate("Update the onboarding guide.", ctx);
    let mut proposed_edit = None;

    while let Some(ev) = stream.next().await {
        match ev.unwrap() {
            SourcedEvent {
                source,
                event: AgentEvent::ToolCall { name, input },
            } => {
                println!(
                    "[{source:?}][tool call]  {name}({})",
                    serde_json::to_string(&input).unwrap()
                );
            }
            SourcedEvent {
                source,
                event:
                    AgentEvent::ToolResult {
                        name,
                        output,
                        latency_ms,
                    },
            } => {
                println!("[{source:?}][tool result] {name} — {latency_ms}ms → {output}");
            }
            SourcedEvent {
                source: AgentSource::Editor,
                event: AgentEvent::ProposedEditEmitted { edit },
            } => {
                println!("[Editor][proposed edit] id={}", edit.id);
                proposed_edit = Some(edit);
            }
            SourcedEvent {
                source,
                event: AgentEvent::FinalMessage { text },
            } => {
                println!("\n{source:?}: {text}");
            }
            SourcedEvent {
                source,
                event: AgentEvent::ThinkingChunk { text },
            } => print!("[{source:?}] {text}"),
            SourcedEvent {
                source,
                event:
                    AgentEvent::Usage {
                        input_tokens,
                        output_tokens,
                        model,
                    },
            } => {
                println!(
                    "[{source:?}][usage] model={model} input={input_tokens} output={output_tokens}"
                );
            }
            SourcedEvent { .. } => {}
        }
    }

    // ── Approve and commit ────────────────────────────────────────────────────
    if let Some(edit) = proposed_edit {
        println!(
            "\n── Approving edit {} ────────────────────────────────────────",
            edit.id
        );
        let token = session.approve_edit(&edit);
        commit_edit(edit, token, storage.clone() as Arc<dyn StorageAdapter>)
            .await
            .expect("commit_edit failed");

        let updated = storage.get_document(doc_id).await.unwrap();
        println!("Document body after commit:\n{}", updated.body);
    }
}
