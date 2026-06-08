// Copyright 2024 Kaya Suites. Licensed under the Apache License, Version 2.0.
//! `POST /oauth/token` — exchange an authorization code for an access token.
//!
//! Supports:
//! - `authorization_code` grant only.
//! - PKCE S256 (verifier-binding to the auth-code's challenge).
//! - Client authentication: `none` for public clients (`client_id` in body),
//!   `client_secret_basic` for confidential clients (`Authorization: Basic ...`).
//!
//! Returns the OAuth standard JSON response on success and the standard
//! `{ error, error_description }` JSON on failure with the appropriate status.

use axum::{
    Extension, Form, Json,
    http::{HeaderMap, StatusCode, header::AUTHORIZATION},
    response::{IntoResponse, Response},
};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use kaya_oauth::{
    AccessTokenKind, OAuthError, clients, codes, crypto, tokens,
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::AnyPool;
use uuid::Uuid;

#[derive(Deserialize)]
pub struct TokenForm {
    pub grant_type: String,
    pub code: String,
    pub redirect_uri: String,
    pub code_verifier: String,
    #[serde(default)]
    pub client_id: Option<String>,
    #[serde(default)]
    pub client_secret: Option<String>,
}

pub async fn token(
    Extension(pool): Extension<AnyPool>,
    headers: HeaderMap,
    Form(form): Form<TokenForm>,
) -> Response {
    match handle(&pool, &headers, form).await {
        Ok(value) => (StatusCode::OK, Json(value)).into_response(),
        Err(e) => error_response(&e),
    }
}

async fn handle(pool: &AnyPool, headers: &HeaderMap, form: TokenForm) -> Result<Value, OAuthError> {
    if form.grant_type != "authorization_code" {
        return Err(OAuthError::UnsupportedGrantType);
    }

    // Authenticate the client. Prefer Basic auth header if present.
    let (client_id, client_secret) = resolve_client_credentials(headers, &form)?;
    let client = clients::authenticate(pool, client_id, client_secret.as_deref()).await?;

    // Consume the auth code atomically — replay-safe via the
    // `consumed_at IS NULL` guard in `codes::consume`.
    let code = codes::consume(pool, &form.code).await?;

    // Bind the code to the same client and redirect_uri that requested it.
    if code.client_id != client.id || code.redirect_uri != form.redirect_uri {
        return Err(OAuthError::InvalidGrant);
    }

    // PKCE verification.
    crypto::verify_pkce(code.code_challenge_method, &form.code_verifier, &code.code_challenge)?;

    // Mint the access token. The token is owned by the user who approved the
    // auth code, and tagged with the client that requested it.
    let minted = tokens::mint(
        pool,
        tokens::MintRequest {
            client_id: client.id,
            user_id: code.user_id,
            scope: code.scope.clone(),
            kind: AccessTokenKind::Access,
            name: String::new(),
        },
    )
    .await?;

    Ok(json!({
        "access_token": minted.raw,
        "token_type":   "Bearer",
        "scope":        code.scope.as_str(),
    }))
}

fn resolve_client_credentials(
    headers: &HeaderMap,
    form: &TokenForm,
) -> Result<(Uuid, Option<String>), OAuthError> {
    // 1) HTTP Basic auth header.
    if let Some(basic) = headers
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Basic "))
    {
        let decoded = B64
            .decode(basic.trim())
            .map_err(|_| OAuthError::InvalidClient)?;
        let s = std::str::from_utf8(&decoded).map_err(|_| OAuthError::InvalidClient)?;
        let (id, secret) = s.split_once(':').ok_or(OAuthError::InvalidClient)?;
        let client_id = Uuid::parse_str(id).map_err(|_| OAuthError::InvalidClient)?;
        return Ok((client_id, Some(secret.to_owned())));
    }

    // 2) Form-body fallback (public clients, or confidential ones that prefer it).
    let raw = form.client_id.as_deref().ok_or(OAuthError::InvalidClient)?;
    let client_id = Uuid::parse_str(raw).map_err(|_| OAuthError::InvalidClient)?;
    Ok((client_id, form.client_secret.clone()))
}

fn error_response(e: &OAuthError) -> Response {
    let status = match e {
        OAuthError::InvalidClient => StatusCode::UNAUTHORIZED,
        OAuthError::Server(_) | OAuthError::Db(_) => StatusCode::INTERNAL_SERVER_ERROR,
        _ => StatusCode::BAD_REQUEST,
    };
    (
        status,
        Json(json!({
            "error": e.code(),
            "error_description": e.to_string(),
        })),
    )
        .into_response()
}

/// Re-exported so DCR can use the same Basic-auth decoder if we add a
/// registration-access-token flow later.
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn basic_auth_round_trip() {
        let raw = format!("{}:{}", "11111111-1111-1111-1111-111111111111", "sec");
        let encoded = B64.encode(raw);
        let mut hm = HeaderMap::new();
        hm.insert(AUTHORIZATION, format!("Basic {encoded}").parse().unwrap());

        let form = TokenForm {
            grant_type: "authorization_code".into(),
            code: "x".into(),
            redirect_uri: "x".into(),
            code_verifier: "x".into(),
            client_id: None,
            client_secret: None,
        };
        let (id, secret) = resolve_client_credentials(&hm, &form).unwrap();
        assert_eq!(id.to_string(), "11111111-1111-1111-1111-111111111111");
        assert_eq!(secret.as_deref(), Some("sec"));
    }

    #[test]
    fn form_fallback() {
        let form = TokenForm {
            grant_type: "authorization_code".into(),
            code: "x".into(),
            redirect_uri: "x".into(),
            code_verifier: "x".into(),
            client_id: Some("11111111-1111-1111-1111-111111111111".into()),
            client_secret: None,
        };
        let (id, secret) = resolve_client_credentials(&HeaderMap::new(), &form).unwrap();
        assert_eq!(id.to_string(), "11111111-1111-1111-1111-111111111111");
        assert!(secret.is_none());
    }

    /// Document the single-scope assumption: any future split must touch the
    /// token endpoint's scope-validation path. This test is a tripwire.
    #[test]
    fn only_mcp_scope_today() {
        let s = kaya_oauth::Scope::mcp();
        assert_eq!(s.as_str(), "mcp");
    }
}
