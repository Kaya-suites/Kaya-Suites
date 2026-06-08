// Copyright 2024 Kaya Suites. Licensed under the Apache License, Version 2.0.
//! `/mcp` — Streamable HTTP MCP endpoint for remote Claude Desktop / Code clients.
//!
//! Authentication: `Authorization: Bearer <token>` against `oauth_access_tokens`
//! (issued either by the OAuth code flow or as a long-lived PAT from Settings).
//!
//! On any 401 the response carries
//! `WWW-Authenticate: Bearer resource_metadata="<issuer>/.well-known/oauth-protected-resource"`
//! so Claude Desktop can discover the OAuth flow automatically (RFC 9728 +
//! MCP 2025-11-25).
//!
//! One [`StreamableHttpService`] is cached per resolved `user_id`; clones of the
//! same [`KayaService`] template share a [`PendingEditStore`] so propose-then-
//! commit works across reconnects.
//!
//! Per-user adapter construction is delegated to [`crate::build_user_adapters`]
//! so postgres / sqlite / mysql all work uniformly.

use std::collections::HashMap;
use std::sync::Arc;

use axum::{
    Extension,
    body::Body,
    extract::Request,
    http::{HeaderMap, HeaderValue, StatusCode, header::AUTHORIZATION},
    response::{IntoResponse, Response},
};
use kaya_core::{UserContext, auth::UserSession, model_router::ModelRouter};
use kaya_mcp::KayaService;
use kaya_oauth::tokens as oauth_tokens;
use kaya_server::OAuthIssuer;
use kaya_storage::DbBackend;
use rmcp::transport::streamable_http_server::{
    StreamableHttpServerConfig, StreamableHttpService,
    session::local::LocalSessionManager,
};
use sqlx::AnyPool;
use tokio::sync::RwLock;
use tower_service::Service as _;
use uuid::Uuid;

type CachedService = Arc<StreamableHttpService<KayaService, LocalSessionManager>>;
pub type McpCache = Arc<RwLock<HashMap<Uuid, CachedService>>>;

/// Configuration the `/mcp` handler needs from the host binary.
#[derive(Clone)]
pub struct McpState {
    pub pool: AnyPool,
    pub db_backend: DbBackend,
    pub router: Arc<ModelRouter>,
    pub cache: McpCache,
    pub issuer: OAuthIssuer,
}

fn extract_bearer(headers: &HeaderMap) -> Option<String> {
    headers
        .get(AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")
        .map(str::to_owned)
}

/// 401 with the resource-metadata pointer Claude Desktop uses to discover the
/// OAuth flow.
fn unauthorized(issuer: &OAuthIssuer, body: &'static str) -> Response {
    let header = format!(
        r#"Bearer resource_metadata="{}/.well-known/oauth-protected-resource""#,
        issuer.url()
    );
    let mut resp = (StatusCode::UNAUTHORIZED, body).into_response();
    if let Ok(value) = HeaderValue::from_str(&header) {
        resp.headers_mut()
            .insert(axum::http::header::WWW_AUTHENTICATE, value);
    }
    resp
}

async fn build_service_for_user(
    state: &McpState,
    user_id: Uuid,
) -> anyhow::Result<KayaService> {
    let user_ctx = UserContext { user_id, tenant_id: user_id };
    let (storage, sessions) =
        kaya_storage::build_user_adapters(&state.db_backend, user_ctx).await?;
    let session = UserSession { user_id };
    Ok(KayaService::new(storage, sessions, state.router.clone(), session))
}

async fn resolve_or_build(
    state: &McpState,
    token: &str,
) -> Result<CachedService, Response> {
    let access = oauth_tokens::resolve(&state.pool, token)
        .await
        .map_err(|_| unauthorized(&state.issuer, "invalid or revoked token"))?;

    if let Some(svc) = state.cache.read().await.get(&access.user_id).cloned() {
        return Ok(svc);
    }

    let template = build_service_for_user(state, access.user_id)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "build kaya service");
            (StatusCode::INTERNAL_SERVER_ERROR, "service init failed").into_response()
        })?;

    let factory = move || Ok::<_, std::io::Error>(template.clone());
    let http_service = Arc::new(StreamableHttpService::new(
        factory,
        Arc::new(LocalSessionManager::default()),
        StreamableHttpServerConfig::default(),
    ));

    state
        .cache
        .write()
        .await
        .entry(access.user_id)
        .or_insert_with(|| http_service.clone());

    Ok(http_service)
}

pub async fn handle(
    Extension(state): Extension<McpState>,
    req: Request,
) -> Response {
    let token = match extract_bearer(req.headers()) {
        Some(t) => t,
        None => return unauthorized(&state.issuer, "missing bearer token"),
    };

    let svc = match resolve_or_build(&state, &token).await {
        Ok(s) => s,
        Err(r) => return r,
    };

    let (parts, body) = req.into_parts();
    let req = Request::from_parts(parts, body);

    let mut svc_clone = (*svc).clone();
    match svc_clone.call(req).await {
        Ok(resp) => resp.map(Body::new).into_response(),
        Err(_unreachable) => (StatusCode::INTERNAL_SERVER_ERROR, "mcp service error")
            .into_response(),
    }
}
