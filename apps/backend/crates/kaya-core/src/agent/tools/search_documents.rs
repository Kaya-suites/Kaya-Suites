//! `search_documents` — vector-database semantic search.

use async_trait::async_trait;
use serde_json::{Value, json};

use crate::agent::{
    AgentContext,
    tool::{Tool, ToolOutput},
};
use crate::error::KayaError;
use crate::session::EmbeddingCall;

pub struct SearchDocuments;

#[async_trait]
impl Tool for SearchDocuments {
    fn name(&self) -> &'static str {
        "search_documents"
    }

    fn description(&self) -> &'static str {
        "Search the knowledge base using vector similarity. \
         Returns the most semantically relevant document chunks with their IDs and titles."
    }

    fn schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["query"],
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query text."
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of results to return (default 5).",
                    "default": 5
                }
            }
        })
    }

    async fn invoke(&self, input: Value, ctx: &AgentContext) -> Result<ToolOutput, KayaError> {
        let query = input["query"]
            .as_str()
            .ok_or_else(|| KayaError::Internal("search_documents: missing 'query'".into()))?
            .to_owned();
        let limit = input["limit"].as_u64().unwrap_or(5) as usize;

        let emb = ctx.router.embed(query.clone()).await?;
        let _ = ctx
            .sessions
            .save_embedding_call(&EmbeddingCall {
                model: emb.usage.model.clone(),
                tokens: emb.usage.input_tokens,
                task_id: None,
                task_type: "search_documents_tool".to_string(),
                session_id: None,
                document_id: None,
                paragraph_id: None,
            })
            .await;
        let hits = ctx.storage.search_embeddings(&emb.embedding, limit).await?;

        let mut seen = std::collections::HashSet::new();
        let mut results = Vec::new();
        for hit in &hits {
            if !seen.insert(hit.document_id) {
                continue;
            }
            if let Ok(doc) = ctx.storage.get_document(hit.document_id).await {
                results.push(json!({
                    "id": doc.id,
                    "title": doc.title,
                    "paragraph_id": hit.paragraph_id,
                    "excerpt": hit.content,
                }));
            }
        }

        Ok(ToolOutput::value(json!({ "documents": results })))
    }
}
