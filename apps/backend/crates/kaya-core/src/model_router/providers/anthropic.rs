//! Anthropic provider backed by `rig-core`.

use async_trait::async_trait;
use futures::StreamExt;
use futures::stream::BoxStream;
use rig_core::client::CompletionClient;
use rig_core::completion::{CompletionModel, GetTokenUsage, ToolDefinition as RigToolDefinition};
use rig_core::message::AssistantContent;
use rig_core::providers::anthropic;
use rig_core::providers::anthropic::completion::CompletionResponse as AnthropicResponse;
use rig_core::streaming::StreamedAssistantContent;

use crate::error::KayaError;

use super::super::meter::TokenUsage;
use super::super::{
    CompletionRequest as KayaCompletionRequest, CompletionResponse, EmbeddingRequest,
    EmbeddingResponse, LlmProvider, StreamChunk, StreamItem, ToolCallRequest, ToolCallResponse,
    ToolCallResult,
};

const DEFAULT_MAX_TOKENS: u32 = 4096;

pub struct AnthropicProvider {
    api_key: String,
}

impl AnthropicProvider {
    pub fn new(api_key: String) -> Self {
        Self { api_key }
    }

    fn client(&self) -> Result<anthropic::Client, KayaError> {
        anthropic::Client::new(&self.api_key).map_err(|e| KayaError::Internal(e.to_string()))
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

fn completion_usage(raw: &AnthropicResponse) -> (u32, u32, String) {
    (
        raw.usage.input_tokens as u32,
        raw.usage.output_tokens as u32,
        raw.model.clone(),
    )
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
impl LlmProvider for AnthropicProvider {
    async fn complete(
        &self,
        request: KayaCompletionRequest,
    ) -> Result<CompletionResponse, KayaError> {
        let client = self.client()?;
        let model = client.completion_model(&request.model);
        let (preamble, prompt) = super::messages_to_parts(&request.messages);
        let mut builder = model
            .completion_request(prompt)
            .max_tokens(request.max_tokens.unwrap_or(DEFAULT_MAX_TOKENS) as u64);
        if let Some(p) = preamble {
            builder = builder.preamble(p);
        }
        let resp = builder
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
                model: model_name,
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
        let (preamble, prompt) = super::messages_to_parts(&request.messages);
        let mut builder = model
            .completion_request(prompt)
            .max_tokens(request.max_tokens.unwrap_or(DEFAULT_MAX_TOKENS) as u64);
        if let Some(p) = preamble {
            builder = builder.preamble(p);
        }
        let rig_stream = builder
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

    async fn embed(&self, _request: EmbeddingRequest) -> Result<EmbeddingResponse, KayaError> {
        Err(KayaError::Internal(
            "Anthropic does not provide an embeddings endpoint; \
             route OperationType::Embedding to OpenAI or Gemini"
                .to_owned(),
        ))
    }

    async fn tool_call(&self, request: ToolCallRequest) -> Result<ToolCallResponse, KayaError> {
        let client = self.client()?;
        let model = client.completion_model(&request.model);
        let (preamble, prompt) = super::messages_to_parts(&request.messages);
        let mut builder = model
            .completion_request(prompt)
            .max_tokens(DEFAULT_MAX_TOKENS as u64)
            .tools(rig_tools(&request.tools));
        if let Some(p) = preamble {
            builder = builder.preamble(p);
        }
        let resp = builder
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
                model: model_name,
                operation: request.operation,
            },
        })
    }
}
