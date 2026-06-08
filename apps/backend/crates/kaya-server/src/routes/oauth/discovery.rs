// Copyright 2024 Kaya Suites. Licensed under the Apache License, Version 2.0.
//! OAuth discovery documents.
//!
//! - `/.well-known/oauth-authorization-server` — RFC 8414.
//! - `/.well-known/oauth-protected-resource`   — RFC 9728, the document
//!   Claude Desktop hits after a `WWW-Authenticate` challenge on `/mcp`.

use axum::{Extension, Json};
use serde_json::{Value, json};

use super::issuer::OAuthIssuer;

pub async fn authorization_server(
    Extension(issuer): Extension<OAuthIssuer>,
) -> Json<Value> {
    Json(json!({
        "issuer": issuer.url(),
        "authorization_endpoint": issuer.join("/oauth/authorize"),
        "token_endpoint":         issuer.join("/oauth/token"),
        "registration_endpoint":  issuer.join("/oauth/register"),
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none", "client_secret_basic"],
        "scopes_supported": ["mcp"],
    }))
}

pub async fn protected_resource(
    Extension(issuer): Extension<OAuthIssuer>,
) -> Json<Value> {
    Json(json!({
        "resource": issuer.join("/mcp"),
        "authorization_servers": [issuer.url()],
        "bearer_methods_supported": ["header"],
        "scopes_supported": ["mcp"],
    }))
}
