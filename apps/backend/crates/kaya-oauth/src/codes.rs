// Copyright 2024 Kaya Suites. Licensed under the Apache License, Version 2.0.
//! `oauth_authorization_codes` — short-lived, single-use.
//!
//! Lifecycle: minted by `/oauth/authorize`'s consent decision, consumed exactly
//! once by `/oauth/token`. Codes expire 10 minutes after issuance per OAuth 2.1
//! recommendations.

use chrono::Utc;
use sqlx::AnyPool;
use uuid::Uuid;

use crate::crypto::{generate_authorization_code, hash_token};
use crate::model::{AuthorizationCode, OAuthError, PkceMethod, Scope};

pub const CODE_TTL_SECS: i64 = 600;

pub struct MintRequest {
    pub client_id: Uuid,
    pub user_id: Uuid,
    pub redirect_uri: String,
    pub scope: Scope,
    pub code_challenge: String,
    pub code_challenge_method: PkceMethod,
}

pub struct MintedCode {
    /// The raw `code` value handed back to the client via redirect. Shown once.
    pub raw: String,
    pub expires_at: i64,
}

pub async fn mint(pool: &AnyPool, req: MintRequest) -> Result<MintedCode, OAuthError> {
    let raw = generate_authorization_code();
    let hash = hash_token(&raw);
    let now_ms = Utc::now().timestamp_millis();
    let expires_at = now_ms + CODE_TTL_SECS * 1000;

    sqlx::query(
        "INSERT INTO oauth_authorization_codes \
         (code_hash, client_id, user_id, redirect_uri, scope, code_challenge, \
          code_challenge_method, expires_at) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    )
    .bind(&hash)
    .bind(req.client_id.to_string())
    .bind(req.user_id.to_string())
    .bind(&req.redirect_uri)
    .bind(req.scope.as_str())
    .bind(&req.code_challenge)
    .bind(req.code_challenge_method.as_str())
    .bind(expires_at)
    .execute(pool)
    .await?;

    Ok(MintedCode { raw, expires_at })
}

/// Look up a code without consuming it. Used by the token endpoint to validate
/// PKCE *before* atomically consuming.
pub async fn peek(pool: &AnyPool, raw: &str) -> Result<AuthorizationCode, OAuthError> {
    let hash = hash_token(raw);
    let row: Option<(String, String, String, String, String, String, i64, Option<i64>)> = sqlx::query_as(
        "SELECT client_id, user_id, redirect_uri, scope, code_challenge, \
                code_challenge_method, expires_at, consumed_at \
         FROM oauth_authorization_codes WHERE code_hash = ?",
    )
    .bind(&hash)
    .fetch_optional(pool)
    .await?;

    let (client_id, user_id, redirect_uri, scope, challenge, method, expires_at, consumed_at) =
        row.ok_or(OAuthError::InvalidGrant)?;

    let now = Utc::now().timestamp_millis();
    if consumed_at.is_some() || expires_at < now {
        return Err(OAuthError::InvalidGrant);
    }

    Ok(AuthorizationCode {
        client_id: Uuid::parse_str(&client_id).map_err(|e| OAuthError::Server(e.to_string()))?,
        user_id: Uuid::parse_str(&user_id).map_err(|e| OAuthError::Server(e.to_string()))?,
        redirect_uri,
        scope: Scope::parse(&scope)?,
        code_challenge: challenge,
        code_challenge_method: PkceMethod::parse(&method)?,
        expires_at,
        consumed_at,
    })
}

/// Atomically consume a code. Returns the parsed code on success.
///
/// `peek` + `consume` together implement the OAuth 2.1 "one-time use" rule:
/// the UPDATE only flips `consumed_at` if it was previously NULL, so a
/// concurrent replay loses the race and gets `InvalidGrant`.
pub async fn consume(pool: &AnyPool, raw: &str) -> Result<AuthorizationCode, OAuthError> {
    let code = peek(pool, raw).await?;
    let hash = hash_token(raw);
    let now = Utc::now().timestamp_millis();

    let r = sqlx::query(
        "UPDATE oauth_authorization_codes SET consumed_at = $1 \
         WHERE code_hash = $2 AND consumed_at IS NULL",
    )
    .bind(now)
    .bind(&hash)
    .execute(pool)
    .await?;

    if r.rows_affected() == 0 {
        return Err(OAuthError::InvalidGrant);
    }

    Ok(code)
}
