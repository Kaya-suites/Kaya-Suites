//! Google Gemini provider backed by `rig-core`.

use async_trait::async_trait;
use futures::StreamExt;
use futures::stream::BoxStream;
use rig_core::client::{CompletionClient, EmbeddingsClient};
use rig_core::completion::{CompletionModel, GetTokenUsage, ToolDefinition as RigToolDefinition};
use rig_core::embeddings::EmbeddingModel;
use rig_core::message::AssistantContent;
use rig_core::providers::gemini;
use rig_core::providers::gemini::completion::gemini_api_types::GenerateContentResponse;
use rig_core::streaming::StreamedAssistantContent;

use crate::error::KayaError;

use super::super::meter::TokenUsage;
use super::super::{
    CompletionRequest as KayaCompletionRequest, CompletionResponse, EmbeddingRequest,
    EmbeddingResponse, LlmProvider, OperationType, StreamChunk, StreamItem, ToolCallRequest,
    ToolCallResponse, ToolCallResult,
};

const DEFAULT_MAX_TOKENS: u32 = 4096;

pub struct GeminiProvider {
    api_key: String,
}

impl GeminiProvider {
    pub fn new(api_key: String) -> Self {
        Self { api_key }
    }

    fn client(&self) -> Result<gemini::Client, KayaError> {
        gemini::Client::new(&self.api_key).map_err(|e| KayaError::Internal(e.to_string()))
    }
}

fn rig_tools(tools: &[super::super::ToolDefinition]) -> Vec<RigToolDefinition> {
    tools
        .iter()
        .map(|t| RigToolDefinition {
            name: t.name.clone(),
            description: t.description.clone(),
            parameters: t.parameters.clone(),
        })
        .collect()
}

fn extract_text(choice: &rig_core::one_or_many::OneOrMany<AssistantContent>) -> String {
    choice
        .iter()
        .filter_map(|c| {
            if let AssistantContent::Text(t) = c {
                Some(t.text.as_str())
            } else {
                None
            }
        })
        .collect::<Vec<_>>()
        .join("")
}

fn extract_tool_or_text(
    choice: &rig_core::one_or_many::OneOrMany<AssistantContent>,
) -> (Option<ToolCallResult>, Option<String>) {
    for item in choice.iter() {
        match item {
            AssistantContent::ToolCall(call) => {
                return (
                    Some(ToolCallResult {
                        tool_name: call.function.name.clone(),
                        arguments: call.function.arguments.clone(),
                    }),
                    None,
                );
            }
            AssistantContent::Text(text) if !text.text.is_empty() => {
                return (None, Some(text.text.clone()));
            }
            _ => {}
        }
    }
    (None, None)
}

fn completion_usage(raw: &GenerateContentResponse) -> (u32, u32, String) {
    let model = raw.model_version.clone().unwrap_or_default();
    match raw.usage_metadata.as_ref().and_then(|u| u.token_usage()) {
        Some(u) => (u.input_tokens as u32, u.output_tokens as u32, model),
        None => (0, 0, model),
    }
}

fn streaming_usage<R: GetTokenUsage>(raw: &R, model_fallback: &str) -> (u32, u32, String) {
    match raw.token_usage() {
        Some(u) => (
            u.input_tokens as u32,
            u.output_tokens as u32,
            model_fallback.to_owned(),
        ),
        None => (0, 0, model_fallback.to_owned()),
    }
}

#[async_trait]
impl LlmProvider for GeminiProvider {
    async fn complete(
        &self,
        request: KayaCompletionRequest,
    ) -> Result<CompletionResponse, KayaError> {
        let client = self.client()?;
        let model = client.completion_model(&request.model);
        let resp = model
            .completion_request(request.prompt.clone())
            .max_tokens(request.max_tokens.unwrap_or(DEFAULT_MAX_TOKENS) as u64)
            .send()
            .await
            .map_err(|e| KayaError::Internal(e.to_string()))?;

        let content = extract_text(&resp.choice);
        let (input_tokens, output_tokens, model_name) = completion_usage(&resp.raw_response);

        Ok(CompletionResponse {
            content,
            usage: TokenUsage {
                input_tokens,
                output_tokens,
                model: if model_name.is_empty() {
                    request.model
                } else {
                    model_name
                },
                operation: request.operation,
            },
        })
    }

    async fn stream(
        &self,
        request: KayaCompletionRequest,
    ) -> Result<BoxStream<'static, Result<StreamItem, KayaError>>, KayaError> {
        let client = self.client()?;
        let model = client.completion_model(&request.model);
        let rig_stream = model
            .completion_request(request.prompt.clone())
            .max_tokens(request.max_tokens.unwrap_or(DEFAULT_MAX_TOKENS) as u64)
            .stream()
            .await
            .map_err(|e| KayaError::Internal(e.to_string()))?;

        let operation = request.operation;
        let model_fallback = request.model;

        let adapted = rig_stream.filter_map(move |item| {
            let operation = operation.clone();
            let model_fallback = model_fallback.clone();
            futures::future::ready(match item {
                Ok(StreamedAssistantContent::Text(text)) => {
                    Some(Ok(StreamItem::Chunk(StreamChunk { delta: text.text })))
                }
                Ok(StreamedAssistantContent::Final(raw)) => {
                    let (input_tokens, output_tokens, model_name) =
                        streaming_usage(&raw, &model_fallback);
                    Some(Ok(StreamItem::Usage(TokenUsage {
                        input_tokens,
                        output_tokens,
                        model: model_name,
                        operation,
                    })))
                }
                Ok(_) => None,
                Err(e) => Some(Err(KayaError::Internal(e.to_string()))),
            })
        });

        Ok(Box::pin(adapted))
    }

    async fn embed(&self, request: EmbeddingRequest) -> Result<EmbeddingResponse, KayaError> {
        let client = self.client()?;
        let model = client.embedding_model(&request.model);
        // rig's embed_text does not surface usage from the API response,
        // so we estimate via the standard BPE approximation (~4 chars/token).
        let estimated_tokens = (request.text.len() as f32 / 4.0).ceil() as u32;
        let embedding = model
            .embed_text(&request.text)
            .await
            .map_err(|e| KayaError::Internal(e.to_string()))?;

        Ok(EmbeddingResponse {
            embedding: embedding.vec.iter().map(|&v| v as f32).collect(),
            usage: TokenUsage {
                input_tokens: estimated_tokens,
                output_tokens: 0,
                model: request.model,
                operation: OperationType::Embedding,
            },
        })
    }

    async fn tool_call(&self, request: ToolCallRequest) -> Result<ToolCallResponse, KayaError> {
        let client = self.client()?;
        let model = client.completion_model(&request.model);
        let resp = model
            .completion_request(request.prompt.clone())
            .max_tokens(DEFAULT_MAX_TOKENS as u64)
            .tools(rig_tools(&request.tools))
            .send()
            .await
            .map_err(|e| KayaError::Internal(e.to_string()))?;

        let (tool_result, content) = extract_tool_or_text(&resp.choice);
        let (input_tokens, output_tokens, model_name) = completion_usage(&resp.raw_response);

        Ok(ToolCallResponse {
            result: tool_result,
            content,
            usage: TokenUsage {
                input_tokens,
                output_tokens,
                model: if model_name.is_empty() {
                    request.model
                } else {
                    model_name
                },
                operation: request.operation,
            },
        })
    }
}
