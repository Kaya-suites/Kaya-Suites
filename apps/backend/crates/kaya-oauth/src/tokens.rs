// Copyright 2024 Kaya Suites. Licensed under the Apache License, Version 2.0.
//! `oauth_access_tokens` — replaces the old `mcp_tokens` table.
//!
//! Long-lived; revocation is the only way they go away. `kind = "pat"` rows are
//! displayed under the user's "Personal access tokens" card; `kind = "access"`
//! rows are grouped by client under "Connected apps".

use chrono::Utc;
use sqlx::AnyPool;
use uuid::Uuid;

use crate::crypto::{generate_access_token, hash_token};
use crate::model::{AccessToken, AccessTokenKind, OAuthError, Scope};

pub struct MintRequest {
    pub client_id: Uuid,
    pub user_id: Uuid,
    pub scope: Scope,
    pub kind: AccessTokenKind,
    /// Display name (PATs only). Empty for OAuth-issued tokens.
    pub name: String,
}

pub struct MintedToken {
    pub id: Uuid,
    pub raw: String,
}

pub async fn mint(pool: &AnyPool, req: MintRequest) -> Result<MintedToken, OAuthError> {
    let raw = generate_access_token();
    let hash = hash_token(&raw);
    let id = Uuid::new_v4();
    let now = Utc::now().timestamp_millis();

    sqlx::query(
        "INSERT INTO oauth_access_tokens \
         (id, token_hash, client_id, user_id, scope, kind, name, created_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id.to_string())
    .bind(&hash)
    .bind(req.client_id.to_string())
    .bind(req.user_id.to_string())
    .bind(req.scope.as_str())
    .bind(req.kind.as_str())
    .bind(&req.name)
    .bind(now)
    .execute(pool)
    .await?;

    Ok(MintedToken { id, raw })
}

/// Resolve a raw token to its `AccessToken` row, bumping `last_used_at`.
/// Returns `InvalidGrant` for missing or revoked tokens.
pub async fn resolve(pool: &AnyPool, raw: &str) -> Result<AccessToken, OAuthError> {
    let hash = hash_token(raw);
    let row: Option<(String, String, String, String, String, String, i64, Option<i64>, Option<i64>)> =
        sqlx::query_as(
            "SELECT id, client_id, user_id, scope, kind, name, created_at, last_used_at, revoked_at \
             FROM oauth_access_tokens WHERE token_hash = ?",
        )
        .bind(&hash)
        .fetch_optional(pool)
        .await?;

    let (id, client_id, user_id, scope, kind, name, created_at, last_used_at, revoked_at) =
        row.ok_or(OAuthError::InvalidGrant)?;

    if revoked_at.is_some() {
        return Err(OAuthError::InvalidGrant);
    }

    let _ = sqlx::query("UPDATE oauth_access_tokens SET last_used_at = ? WHERE token_hash = ?")
        .bind(Utc::now().timestamp_millis())
        .bind(&hash)
        .execute(pool)
        .await;

    Ok(AccessToken {
        id: Uuid::parse_str(&id).map_err(|e| OAuthError::Server(e.to_string()))?,
        client_id: Uuid::parse_str(&client_id).map_err(|e| OAuthError::Server(e.to_string()))?,
        user_id: Uuid::parse_str(&user_id).map_err(|e| OAuthError::Server(e.to_string()))?,
        scope: Scope::parse(&scope)?,
        kind: AccessTokenKind::parse(&kind)?,
        name,
        created_at,
        last_used_at,
        revoked_at,
    })
}

pub async fn revoke(pool: &AnyPool, user_id: Uuid, token_id: Uuid) -> Result<bool, OAuthError> {
    let now = Utc::now().timestamp_millis();
    let r = sqlx::query(
        "UPDATE oauth_access_tokens SET revoked_at = ? \
         WHERE id = ? AND user_id = ? AND revoked_at IS NULL",
    )
    .bind(now)
    .bind(token_id.to_string())
    .bind(user_id.to_string())
    .execute(pool)
    .await?;
    Ok(r.rows_affected() > 0)
}

/// Revoke every active token issued to `client_id` for `user_id`. Used by the
/// frontend's "Connected apps → Revoke" button.
pub async fn revoke_for_client(
    pool: &AnyPool,
    user_id: Uuid,
    client_id: Uuid,
) -> Result<u64, OAuthError> {
    let now = Utc::now().timestamp_millis();
    let r = sqlx::query(
        "UPDATE oauth_access_tokens SET revoked_at = ? \
         WHERE user_id = ? AND client_id = ? AND revoked_at IS NULL",
    )
    .bind(now)
    .bind(user_id.to_string())
    .bind(client_id.to_string())
    .execute(pool)
    .await?;
    Ok(r.rows_affected())
}

/// One row per OAuth-issued client the user has granted access to.
#[derive(Debug, Clone)]
pub struct ConnectedApp {
    pub client_id: Uuid,
    pub client_name: String,
    pub token_count: i64,
    pub last_used_at: Option<i64>,
    pub first_authorized_at: i64,
}

/// List the OAuth clients the user has live `Access`-kind tokens for, grouped
/// by `client_id`. PAT-kind tokens are excluded — the Settings UI shows them
/// separately under "Personal access tokens".
pub async fn list_connected_apps(
    pool: &AnyPool,
    user_id: Uuid,
) -> Result<Vec<ConnectedApp>, OAuthError> {
    let rows: Vec<(String, String, i64, Option<i64>, i64)> = sqlx::query_as(
        "SELECT t.client_id, c.name, COUNT(*) AS token_count, \
                MAX(t.last_used_at) AS last_used_at, \
                MIN(t.created_at) AS first_authorized_at \
         FROM oauth_access_tokens t \
         JOIN oauth_clients c ON c.id = t.client_id \
         WHERE t.user_id = ? AND t.kind = ? AND t.revoked_at IS NULL \
         GROUP BY t.client_id, c.name \
         ORDER BY first_authorized_at DESC",
    )
    .bind(user_id.to_string())
    .bind(AccessTokenKind::Access.as_str())
    .fetch_all(pool)
    .await?;

    rows.into_iter()
        .map(|(client_id, client_name, token_count, last_used_at, first_authorized_at)| {
            Ok(ConnectedApp {
                client_id: Uuid::parse_str(&client_id)
                    .map_err(|e| OAuthError::Server(e.to_string()))?,
                client_name,
                token_count,
                last_used_at,
                first_authorized_at,
            })
        })
        .collect()
}

pub async fn list_for_user(
    pool: &AnyPool,
    user_id: Uuid,
    kind: Option<AccessTokenKind>,
) -> Result<Vec<AccessToken>, OAuthError> {
    let rows: Vec<(String, String, String, String, String, String, i64, Option<i64>, Option<i64>)> =
        match kind {
            Some(k) => sqlx::query_as(
                "SELECT id, client_id, user_id, scope, kind, name, created_at, last_used_at, revoked_at \
                 FROM oauth_access_tokens \
                 WHERE user_id = ? AND kind = ? AND revoked_at IS NULL \
                 ORDER BY created_at DESC",
            )
            .bind(user_id.to_string())
            .bind(k.as_str())
            .fetch_all(pool)
            .await?,
            None => sqlx::query_as(
                "SELECT id, client_id, user_id, scope, kind, name, created_at, last_used_at, revoked_at \
                 FROM oauth_access_tokens \
                 WHERE user_id = ? AND revoked_at IS NULL \
                 ORDER BY created_at DESC",
            )
            .bind(user_id.to_string())
            .fetch_all(pool)
            .await?,
        };

    rows.into_iter()
        .map(|(id, client_id, user_id, scope, kind, name, created_at, last_used_at, revoked_at)| {
            Ok(AccessToken {
                id: Uuid::parse_str(&id).map_err(|e| OAuthError::Server(e.to_string()))?,
                client_id: Uuid::parse_str(&client_id)
                    .map_err(|e| OAuthError::Server(e.to_string()))?,
                user_id: Uuid::parse_str(&user_id)
                    .map_err(|e| OAuthError::Server(e.to_string()))?,
                scope: Scope::parse(&scope)?,
                kind: AccessTokenKind::parse(&kind)?,
                name,
                created_at,
                last_used_at,
                revoked_at,
            })
        })
        .collect()
}
