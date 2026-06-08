//! Integration tests for `SqliteAdapter`.
//!
//! Each test spins up a fresh temporary SQLite database so the tests are
//! completely isolated and can run in parallel.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
use std::time::Instant;

use async_trait::async_trait;
use chrono::NaiveDate;
use futures::stream::BoxStream;
use uuid::Uuid;

use kaya_core::{
    KayaError, OperationType,
    model_router::{
        CompletionRequest, CompletionResponse, EmbeddingRequest, EmbeddingResponse, LlmProvider,
        ModelRouter, StreamItem, ToolCallRequest, ToolCallResponse, meter::TokenUsage,
    },
    retrieval::{chunk_document, index_document_chunks, retrieve},
    storage::{Document, StorageAdapter},
};
use kaya_storage::SqliteAdapter;

// ── Shared helpers ─────────────────────────────────────────────────────────────

fn temp_db() -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir");
    let db = dir.path().join("index.db");
    (dir, db)
}

fn make_doc() -> Document {
    Document {
        id: Uuid::new_v4(),
        title: "Integration Test Doc".to_string(),
        owner: Some("alice".to_string()),
        last_reviewed: Some(NaiveDate::from_ymd_opt(2024, 6, 1).unwrap()),
        tags: vec!["rust".to_string(), "sqlite".to_string()],
        related_docs: vec![],
        body: "# Hello\n\nThis is the body.\n".to_string(),
        folder_id: None,
        sort_order: 0,
    }
}

fn blank_doc() -> Document {
    Document {
        id: Uuid::new_v4(),
        title: String::new(),
        owner: None,
        last_reviewed: None,
        tags: vec![],
        related_docs: vec![],
        body: String::new(),
        folder_id: None,
        sort_order: 0,
    }
}

// ── Topic embedder ─────────────────────────────────────────────────────────────

struct TopicEmbedder {
    call_count: Arc<AtomicUsize>,
}

impl TopicEmbedder {
    fn new() -> (Arc<Self>, Arc<AtomicUsize>) {
        let count = Arc::new(AtomicUsize::new(0));
        (
            Arc::new(Self {
                call_count: Arc::clone(&count),
            }),
            count,
        )
    }
}

fn topic_vector(text: &str) -> Vec<f32> {
    let t = text.to_lowercase();
    if t.contains("alpha") {
        vec![1.0, 0.0, 0.0]
    } else if t.contains("beta") {
        vec![0.0, 1.0, 0.0]
    } else if t.contains("gamma") {
        vec![0.0, 0.0, 1.0]
    } else {
        let v = 1.0_f32 / 3.0_f32.sqrt();
        vec![v, v, v]
    }
}

#[async_trait]
impl LlmProvider for TopicEmbedder {
    async fn complete(&self, _: CompletionRequest) -> Result<CompletionResponse, KayaError> {
        unreachable!("TopicEmbedder does not implement complete")
    }

    async fn stream(
        &self,
        _: CompletionRequest,
    ) -> Result<BoxStream<'static, Result<StreamItem, KayaError>>, KayaError> {
        unreachable!("TopicEmbedder does not implement stream")
    }

    async fn embed(&self, req: EmbeddingRequest) -> Result<EmbeddingResponse, KayaError> {
        self.call_count.fetch_add(1, Ordering::SeqCst);
        Ok(EmbeddingResponse {
            embedding: topic_vector(&req.text),
            usage: TokenUsage {
                input_tokens: 1,
                output_tokens: 0,
                model: req.model,
                operation: OperationType::Embedding,
            },
        })
    }

    async fn tool_call(&self, _: ToolCallRequest) -> Result<ToolCallResponse, KayaError> {
        unreachable!("TopicEmbedder does not implement tool_call")
    }
}

fn make_router(embedder: Arc<dyn LlmProvider>) -> ModelRouter {
    let mut routes: HashMap<OperationType, (Arc<dyn LlmProvider>, String)> = HashMap::new();
    routes.insert(
        OperationType::Embedding,
        (embedder, "test-model".to_string()),
    );
    ModelRouter::from_routes(routes)
}

// ── Document round-trip tests ─────────────────────────────────────────────────

#[tokio::test]
async fn test_round_trip() {
    let (_dir, db) = temp_db();
    let adapter = SqliteAdapter::new(&db).await.unwrap();

    let doc = make_doc();
    adapter.save_document(&doc).await.unwrap();

    let loaded = adapter.get_document(doc.id).await.unwrap();
    assert_eq!(loaded.id, doc.id);
    assert_eq!(loaded.title, doc.title);
    assert_eq!(loaded.owner, doc.owner);
    assert_eq!(loaded.last_reviewed, doc.last_reviewed);
    assert_eq!(loaded.tags, doc.tags);
    assert_eq!(loaded.body.trim(), doc.body.trim());

    let all = adapter.list_documents().await.unwrap();
    assert!(all.iter().any(|d| d.id == doc.id));
}

#[tokio::test]
async fn test_delete_document() {
    let (_dir, db) = temp_db();
    let adapter = SqliteAdapter::new(&db).await.unwrap();

    let doc = make_doc();
    adapter.save_document(&doc).await.unwrap();
    adapter.delete_document(doc.id).await.unwrap();

    let result = adapter.get_document(doc.id).await;
    assert!(
        result.is_err(),
        "deleted document should not be retrievable"
    );

    let all = adapter.list_documents().await.unwrap();
    assert!(!all.iter().any(|d| d.id == doc.id));
}

// ── Retrieval tests ────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_retrieval_seed_corpus() {
    let (_dir, db) = temp_db();
    let adapter = Arc::new(SqliteAdapter::new(&db).await.unwrap());

    let (embedder, _count) = TopicEmbedder::new();
    let router = make_router(embedder);

    let doc_a = Document {
        id: Uuid::new_v4(),
        title: "Alpha Systems".to_string(),
        body: "Alpha particles are a type of ionizing radiation.\n\nAlpha decay releases helium nuclei.".to_string(),
        ..blank_doc()
    };
    let doc_b = Document {
        id: Uuid::new_v4(),
        title: "Beta Testing".to_string(),
        body: "Beta testing involves systematic verification.\n\nBeta releases precede stable versions.".to_string(),
        ..blank_doc()
    };
    let doc_c = Document {
        id: Uuid::new_v4(),
        title: "Gamma Radiation".to_string(),
        body: "Gamma rays are electromagnetic waves of high frequency.\n\nGamma radiation penetrates most materials.".to_string(),
        ..blank_doc()
    };

    let storage: Arc<dyn StorageAdapter> = adapter;
    for doc in [&doc_a, &doc_b, &doc_c] {
        storage.save_document(doc).await.unwrap();
        index_document_chunks(doc, &storage, &router, None, None)
            .await
            .unwrap();
    }

    let results = retrieve("alpha", 3, &storage, &router, None, None)
        .await
        .unwrap();
    assert!(!results.is_empty());
    assert_eq!(results[0].document_id, doc_a.id, "alpha query → alpha doc");

    let results = retrieve("beta", 3, &storage, &router, None, None)
        .await
        .unwrap();
    assert_eq!(results[0].document_id, doc_b.id, "beta query → beta doc");

    let results = retrieve("gamma", 3, &storage, &router, None, None)
        .await
        .unwrap();
    assert_eq!(results[0].document_id, doc_c.id, "gamma query → gamma doc");
}

#[tokio::test]
async fn test_citation_round_trip() {
    let (_dir, db) = temp_db();
    let adapter = Arc::new(SqliteAdapter::new(&db).await.unwrap());

    let (embedder, _) = TopicEmbedder::new();
    let router = make_router(embedder);

    let doc = Document {
        id: Uuid::new_v4(),
        title: "Citation Test".to_string(),
        body: "First paragraph about alpha concepts.\n\nSecond paragraph discusses other topics.\n\nThird paragraph mentions gamma radiation.".to_string(),
        ..blank_doc()
    };

    let storage: Arc<dyn StorageAdapter> = adapter;
    storage.save_document(&doc).await.unwrap();
    index_document_chunks(&doc, &storage, &router, None, None)
        .await
        .unwrap();

    let results = retrieve("alpha", 1, &storage, &router, None, None)
        .await
        .unwrap();
    assert!(!results.is_empty(), "retrieve must return a result");

    let hit = &results[0];
    assert_eq!(
        hit.document_id, doc.id,
        "citation points to correct document"
    );

    let all_chunks = chunk_document(&doc);
    let source_chunk = all_chunks
        .iter()
        .find(|c| c.paragraph_id == hit.paragraph_id)
        .expect("cited paragraph_id must exist in the source document");

    assert_eq!(
        source_chunk.content, hit.content,
        "chunk content must match"
    );
}

#[tokio::test]
async fn test_reembedding_efficiency() {
    let (_dir, db) = temp_db();
    let adapter = Arc::new(SqliteAdapter::new(&db).await.unwrap());

    let (embedder, call_count) = TopicEmbedder::new();
    let router = make_router(embedder);

    let make_body = |edit: bool| -> String {
        (0..10_usize)
            .map(|i| {
                if edit && i == 4 {
                    "Paragraph 4: EDITED content about beta.".to_string()
                } else {
                    format!("Paragraph {i}: content about alpha topic {i}.")
                }
            })
            .collect::<Vec<_>>()
            .join("\n\n")
    };

    let doc = Document {
        id: Uuid::new_v4(),
        title: "Efficiency Test".to_string(),
        body: make_body(false),
        ..blank_doc()
    };

    let storage: Arc<dyn StorageAdapter> = adapter;
    storage.save_document(&doc).await.unwrap();
    let first_embed_calls = index_document_chunks(&doc, &storage, &router, None, None)
        .await
        .unwrap();
    assert_eq!(
        first_embed_calls, 10,
        "first index: all 10 paragraphs embedded"
    );
    assert_eq!(call_count.load(Ordering::SeqCst), 10);

    let edited_doc = Document {
        body: make_body(true),
        ..doc.clone()
    };
    let second_embed_calls = index_document_chunks(&edited_doc, &storage, &router, None, None)
        .await
        .unwrap();

    assert_eq!(
        second_embed_calls, 1,
        "re-index after single edit must make exactly 1 embedding call"
    );
    assert_eq!(call_count.load(Ordering::SeqCst), 11);
}

#[tokio::test]
async fn test_performance_smoke() {
    let (_dir, db) = temp_db();
    let adapter = Arc::new(SqliteAdapter::new(&db).await.unwrap());

    let (embedder, _) = TopicEmbedder::new();
    let router = make_router(embedder);
    let storage: Arc<dyn StorageAdapter> = adapter;

    let topics = ["alpha", "beta", "gamma"];
    for i in 0..100_usize {
        let topic = topics[i % 3];
        let body = (0..5)
            .map(|p| format!("Document {i} paragraph {p}: discusses {topic} concepts in depth."))
            .collect::<Vec<_>>()
            .join("\n\n");

        let doc = Document {
            id: Uuid::new_v4(),
            title: format!("Document {i}"),
            body,
            ..blank_doc()
        };

        storage.save_document(&doc).await.unwrap();
        index_document_chunks(&doc, &storage, &router, None, None)
            .await
            .unwrap();
    }

    let start = Instant::now();
    let results = retrieve("alpha concepts", 5, &storage, &router, None, None)
        .await
        .unwrap();
    let elapsed = start.elapsed();

    assert!(!results.is_empty(), "retrieval must return results");
    assert!(
        elapsed.as_millis() < 200,
        "retrieval over 100-doc corpus took {}ms, expected < 200ms",
        elapsed.as_millis()
    );
}
