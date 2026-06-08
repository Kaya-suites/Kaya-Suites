// Copyright 2024 Kaya Suites. Licensed under the Apache License, Version 2.0.
//! `POST /oauth/register` — Dynamic Client Registration (RFC 7591).
//!
//! Public endpoint. We don't gate it (per RFC 7591 §3 most servers don't), but
//! a follow-up could add an enrollment token. The response includes a
//! `registration_access_token` so the client can manage its own registration.

use axum::{Extension, Json, http::StatusCode};
use kaya_oauth::{ClientType, RegistrationKind, clients};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::AnyPool;

#[derive(Deserialize)]
pub struct RegisterBody {
    pub redirect_uris: Vec<String>,
    #[serde(default)]
    pub client_name: Option<String>,
    /// `"none"` → public (PKCE only). `"client_secret_basic"` → confidential.
    /// Any other value is rejected.
    #[serde(default = "default_token_auth")]
    pub token_endpoint_auth_method: String,
    #[serde(default)]
    pub grant_types: Option<Vec<String>>,
    #[serde(default)]
    pub response_types: Option<Vec<String>>,
    #[serde(default)]
    pub scope: Option<String>,
}

fn default_token_auth() -> String {
    "none".into()
}

#[derive(Serialize)]
pub struct RegisterResponse {
    pub client_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_secret: Option<String>,
    pub client_id_issued_at: i64,
    pub client_name: String,
    pub redirect_uris: Vec<String>,
    pub token_endpoint_auth_method: String,
    pub grant_types: Vec<String>,
    pub response_types: Vec<String>,
    pub registration_access_token: String,
    pub registration_client_uri: String,
}

pub async fn register(
    Extension(pool): Extension<AnyPool>,
    Extension(issuer): Extension<super::OAuthIssuer>,
    Json(body): Json<RegisterBody>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let client_type = match body.token_endpoint_auth_method.as_str() {
        "none" => ClientType::Public,
        "client_secret_basic" => ClientType::Confidential,
        _ => return Err(error("invalid_client_metadata", "unsupported token_endpoint_auth_method")),
    };

    // We support only `authorization_code` + `code`.
    if let Some(grants) = &body.grant_types {
        if grants.iter().any(|g| g != "authorization_code") {
            return Err(error("invalid_client_metadata", "only authorization_code grant supported"));
        }
    }
    if let Some(responses) = &body.response_types {
        if responses.iter().any(|r| r != "code") {
            return Err(error("invalid_client_metadata", "only `code` response type supported"));
        }
    }
    if let Some(scope) = &body.scope {
        if kaya_oauth::Scope::parse(scope).is_err() {
            return Err(error("invalid_client_metadata", "unknown scope"));
        }
    }
    if body.redirect_uris.is_empty() {
        return Err(error("invalid_redirect_uri", "at least one redirect_uri required"));
    }

    let name = body
        .client_name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("Unnamed MCP client")
        .to_owned();

    let reg = clients::register(
        &pool,
        clients::RegisterRequest {
            name: name.clone(),
            redirect_uris: body.redirect_uris.clone(),
            client_type,
            registration_kind: RegistrationKind::Dcr,
            owner_user_id: None,
        },
    )
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "DCR register failed");
        error("server_error", "failed to register client")
    })?;

    let resp = RegisterResponse {
        client_id: reg.client.id.to_string(),
        client_secret: reg.client_secret,
        client_id_issued_at: reg.client.created_at / 1000,
        client_name: reg.client.name,
        redirect_uris: reg.client.redirect_uris,
        token_endpoint_auth_method: body.token_endpoint_auth_method,
        grant_types: vec!["authorization_code".into()],
        response_types: vec!["code".into()],
        registration_access_token: reg
            .registration_access_token
            .unwrap_or_default(),
        registration_client_uri: issuer.join(&format!("/oauth/clients/{}", reg.client.id)),
    };

    Ok((StatusCode::CREATED, Json(serde_json::to_value(resp).unwrap())))
}

fn error(code: &str, description: &str) -> (StatusCode, Json<Value>) {
    (
        StatusCode::BAD_REQUEST,
        Json(json!({ "error": code, "error_description": description })),
    )
}
