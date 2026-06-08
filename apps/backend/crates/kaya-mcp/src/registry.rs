// Copyright 2024 Kaya Suites. Licensed under the Apache License, Version 2.0.
//! Wraps the existing `kaya_core::agent::Tool` implementations into an
//! `rmcp::ToolRouter`.
//!
//! Read tools are exposed unchanged. Write tools surface as `propose_*` —
//! they emit a `ProposedEdit` which is stashed in the service's
//! [`PendingEditStore`] and returned as `{ edit_id, preview }` for Claude to
//! display to the user. The MCP-only `commit_edit` and `reject_edit` tools
//! finalise.

use std::sync::Arc;

use futures::future::FutureExt;
use kaya_core::{
    agent::{
        AgentContext, Tool as KayaTool, TurnContext,
        tools::{
            CreateDocument, CreateFolder, DeleteDocument, FindStaleReferences,
            ListDocuments, ProposeEdit, ReadDocument, SearchDirectories,
            SearchDocuments, UpdateDocument,
        },
    },
    edit::commit_edit,
};
use rmcp::{
    ErrorData as McpError,
    handler::server::router::tool::{ToolRoute, ToolRouter},
    model::{CallToolResult, Content, JsonObject, Tool as RmcpTool},
};
use serde_json::Value;
use uuid::Uuid;

use crate::preview;
use crate::service::KayaService;

/// Build the canonical Kaya tool router.
pub fn build_tool_router() -> ToolRouter<KayaService> {
    let mut router = ToolRouter::<KayaService>::new();

    // Read tools — exposed 1:1.
    router.add_route(read_route(Arc::new(SearchDocuments)));
    router.add_route(read_route(Arc::new(SearchDirectories)));
    router.add_route(read_route(Arc::new(ReadDocument)));
    router.add_route(read_route(Arc::new(ListDocuments)));
    router.add_route(read_route(Arc::new(FindStaleReferences)));

    // Write tools — renamed to `propose_*` and returning `{ edit_id, preview }`.
    router.add_route(propose_route("propose_create_document", Arc::new(CreateDocument)));
    router.add_route(propose_route("propose_update_document", Arc::new(UpdateDocument)));
    router.add_route(propose_route("propose_modify_document", Arc::new(ProposeEdit)));
    router.add_route(propose_route("propose_delete_document", Arc::new(DeleteDocument)));
    router.add_route(propose_route("propose_create_folder", Arc::new(CreateFolder)));

    // MCP-only finalisation tools.
    router.add_route(commit_route());
    router.add_route(reject_route());

    router
}

// ── helpers ─────────────────────────────────────────────────────────────────

fn agent_ctx(svc: &KayaService) -> AgentContext {
    AgentContext {
        storage: svc.storage.clone(),
        sessions: svc.sessions.clone(),
        router: svc.router.clone(),
        session: svc.session.clone(),
        turn: TurnContext::default(),
    }
}

fn json_to_object(schema: Value) -> JsonObject {
    match schema {
        Value::Object(map) => map,
        _ => JsonObject::new(),
    }
}

fn arguments_value(args: Option<JsonObject>) -> Value {
    Value::Object(args.unwrap_or_default())
}

fn text_result(value: Value) -> CallToolResult {
    let body = serde_json::to_string(&value).unwrap_or_else(|_| "{}".into());
    CallToolResult::success(vec![Content::text(body)])
}

fn error_result(err: impl ToString) -> McpError {
    McpError::internal_error(err.to_string(), None)
}

// ── route builders ──────────────────────────────────────────────────────────

fn read_route(tool: Arc<dyn KayaTool>) -> ToolRoute<KayaService> {
    let attr = RmcpTool::new(
        tool.name(),
        tool.description(),
        Arc::new(json_to_object(tool.schema())),
    );
    let tool_for_call = tool.clone();
    ToolRoute::new_dyn(attr, move |ctx| {
        let tool = tool_for_call.clone();
        async move {
            let svc = ctx.service;
            let input = arguments_value(ctx.arguments);
            let actx = agent_ctx(svc);
            let out = tool.invoke(input, &actx).await.map_err(error_result)?;
            Ok(text_result(out.content))
        }
        .boxed()
    })
}

fn propose_route(mcp_name: &'static str, tool: Arc<dyn KayaTool>) -> ToolRoute<KayaService> {
    let description = format!(
        "PROPOSE-ONLY: {} The change is NOT written. The response contains an \
         `edit_id` and a `preview`. Show the preview to the user and call \
         `commit_edit {{ edit_id }}` only after they explicitly confirm; call \
         `reject_edit {{ edit_id }}` if they decline.",
        tool.description()
    );
    let attr = RmcpTool::new(
        mcp_name,
        description,
        Arc::new(json_to_object(tool.schema())),
    );
    let tool_for_call = tool.clone();
    ToolRoute::new_dyn(attr, move |ctx| {
        let tool = tool_for_call.clone();
        async move {
            let svc = ctx.service;
            let input = arguments_value(ctx.arguments);
            let actx = agent_ctx(svc);
            let out = tool.invoke(input, &actx).await.map_err(error_result)?;
            match out.proposed_edit {
                Some(edit) => {
                    let payload = preview::render(&edit);
                    svc.pending.insert(edit).await;
                    Ok(text_result(payload))
                }
                None => Ok(text_result(out.content)),
            }
        }
        .boxed()
    })
}

fn commit_route() -> ToolRoute<KayaService> {
    let schema = serde_json::json!({
        "type": "object",
        "required": ["edit_id"],
        "properties": {
            "edit_id": { "type": "string", "format": "uuid",
                "description": "ID returned by a propose_* tool." }
        }
    });
    let attr = RmcpTool::new(
        "commit_edit",
        "Apply a previously proposed edit. Pass the `edit_id` returned by a \
         `propose_*` tool. Only call after the user has confirmed the preview.",
        Arc::new(json_to_object(schema)),
    );
    ToolRoute::new_dyn(attr, move |ctx: rmcp::handler::server::tool::ToolCallContext<'_, KayaService>| {
        async move {
            let svc: &KayaService = ctx.service;
            let input = arguments_value(ctx.arguments);
            let edit_id = input["edit_id"]
                .as_str()
                .and_then(|s| Uuid::parse_str(s).ok())
                .ok_or_else(|| McpError::invalid_params("missing or invalid edit_id", None))?;

            let edit = svc
                .pending
                .take(edit_id)
                .await
                .ok_or_else(|| McpError::invalid_params("unknown edit_id", None))?;

            let token = svc.session.approve_edit(&edit);
            let affected = commit_edit(edit, token, svc.storage.clone())
                .await
                .map_err(error_result)?;
            Ok(text_result(serde_json::json!({
                "ok": true,
                "edit_id": edit_id,
                "affected_id": affected,
            })))
        }
        .boxed()
    })
}

fn reject_route() -> ToolRoute<KayaService> {
    let schema = serde_json::json!({
        "type": "object",
        "required": ["edit_id"],
        "properties": {
            "edit_id": { "type": "string", "format": "uuid" },
            "reason":  { "type": "string" }
        }
    });
    let attr = RmcpTool::new(
        "reject_edit",
        "Discard a pending proposed edit without applying it.",
        Arc::new(json_to_object(schema)),
    );
    ToolRoute::new_dyn(attr, move |ctx: rmcp::handler::server::tool::ToolCallContext<'_, KayaService>| {
        async move {
            let svc: &KayaService = ctx.service;
            let input = arguments_value(ctx.arguments);
            let edit_id = input["edit_id"]
                .as_str()
                .and_then(|s| Uuid::parse_str(s).ok())
                .ok_or_else(|| McpError::invalid_params("missing or invalid edit_id", None))?;
            let _ = svc.pending.take(edit_id).await;
            Ok(text_result(serde_json::json!({ "ok": true, "edit_id": edit_id })))
        }
        .boxed()
    })
}
