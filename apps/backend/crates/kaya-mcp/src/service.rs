// Copyright 2024 Kaya Suites. Licensed under the Apache License, Version 2.0.
//! The MCP `Service` shared by both transports.
//!
//! Holds per-user adapters and a [`PendingEditStore`]. The same struct backs
//! the stdio binary (one user per process) and is constructed per-connection
//! by the `/mcp` HTTP route.

use std::sync::Arc;

use kaya_core::{SessionStorage, StorageAdapter, auth::UserSession, model_router::ModelRouter};
use rmcp::{
    ErrorData as McpError, RoleServer, ServerHandler,
    handler::server::router::tool::ToolRouter,
    model::{
        CallToolRequestParams, CallToolResult, Implementation, ListToolsResult,
        PaginatedRequestParams, ServerCapabilities, ServerInfo, Tool,
    },
    service::RequestContext,
};

use crate::pending::PendingEditStore;

/// The service handed to `rmcp::serve_server`. All tool closures receive `&Self`.
///
/// `Clone` is structural: every field is `Arc`-backed (storage, sessions,
/// router, tool_router) or copy-cheap (`UserSession`, `PendingEditStore` which
/// wraps an `Arc<Mutex<…>>`). Cloning is required by
/// `rmcp::StreamableHttpService`'s service factory so each MCP session gets a
/// fresh handle while sharing the same `PendingEditStore`.
#[derive(Clone)]
pub struct KayaService {
    pub storage: Arc<dyn StorageAdapter>,
    pub sessions: Arc<dyn SessionStorage>,
    pub router: Arc<ModelRouter>,
    pub session: UserSession,
    pub pending: PendingEditStore,
    pub tool_router: ToolRouter<KayaService>,
}

impl KayaService {
    pub fn new(
        storage: Arc<dyn StorageAdapter>,
        sessions: Arc<dyn SessionStorage>,
        router: Arc<ModelRouter>,
        session: UserSession,
    ) -> Self {
        Self {
            storage,
            sessions,
            router,
            session,
            pending: PendingEditStore::new(),
            tool_router: crate::registry::build_tool_router(),
        }
    }
}

impl ServerHandler for KayaService {
    fn get_info(&self) -> ServerInfo {
        let caps = ServerCapabilities::builder().enable_tools().build();
        ServerInfo::new(caps)
            .with_server_info(
                Implementation::new("kaya-mcp", env!("CARGO_PKG_VERSION"))
                    .with_title("Kaya Suites"),
            )
            .with_instructions(
                "Kaya knowledge-base. Write tools propose changes; call \
                 `commit_edit { edit_id }` only after the user confirms the \
                 preview. Use `reject_edit` if they decline.",
            )
    }

    fn get_tool(&self, name: &str) -> Option<Tool> {
        self.tool_router.get(name).cloned()
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _ctx: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, McpError> {
        Ok(ListToolsResult::with_all_items(self.tool_router.list_all()))
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        ctx: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, McpError> {
        let tcc = rmcp::handler::server::tool::ToolCallContext::new(self, request, ctx);
        self.tool_router.call(tcc).await
    }
}
