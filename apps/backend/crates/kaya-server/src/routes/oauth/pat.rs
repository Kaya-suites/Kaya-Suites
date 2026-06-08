// Copyright 2024 Kaya Suites. Licensed under the Apache License, Version 2.0.
//! `/oauth/personal-tokens` + `/oauth/connected-apps` — Settings page endpoints.
//!
//! Personal access tokens (PATs) are long-lived `oauth_access_tokens` rows
//! owned by the synthetic [`PAT_CLIENT_ID`] client. They skip the consent flow
//! — the user is already signed in — and are surfaced separately from real
//! OAuth-issued tokens in the UI.
//!
//! Connected-apps are the OAuth-issued tokens grouped by `client_id`.

use axum::{
    Extension, Json,
    extract::Path,
    http::StatusCode,
};
use axum_login::AuthSession;
use kaya_auth::KayaAuthBackend;
use kaya_oauth::{AccessTokenKind, Scope, clients, tokens};
use serde::{Deserialize, Serialize};
use sqlx::AnyPool;
use uuid::Uuid;

use crate::error::ApiError;

fn user_id(auth: &AuthSession<KayaAuthBackend>) -> Result<Uuid, ApiError> {
    auth.user
        .as_ref()
        .map(|u| u.id)
        .ok_or_else(|| ApiError::bad_request("unauthenticated"))
}

// ── Personal access tokens ──────────────────────────────────────────────────

#[derive(Serialize)]
pub struct PatSummary {
    pub id: Uuid,
    pub name: String,
    pub created_at: i64,
    pub last_used_at: Option<i64>,
}

#[derive(Deserialize)]
pub struct CreatePatBody {
    pub name: String,
}

#[derive(Serialize)]
pub struct CreatedPat {
    pub id: Uuid,
    pub name: String,
    pub token: String,
}

pub async fn list_pats(
    auth: AuthSession<KayaAuthBackend>,
    Extension(pool): Extension<AnyPool>,
) -> Result<Json<Vec<PatSummary>>, ApiError> {
    let uid = user_id(&auth)?;
    let rows = tokens::list_for_user(&pool, uid, Some(AccessTokenKind::Pat))
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(
        rows.into_iter()
            .map(|t| PatSummary {
                id: t.id,
                name: t.name,
                created_at: t.created_at,
                last_used_at: t.last_used_at,
            })
            .collect(),
    ))
}

pub async fn create_pat(
    auth: AuthSession<KayaAuthBackend>,
    Extension(pool): Extension<AnyPool>,
    Json(body): Json<CreatePatBody>,
) -> Result<Json<CreatedPat>, ApiError> {
    let uid = user_id(&auth)?;
    let name = body.name.trim();
    if name.is_empty() {
        return Err(ApiError::bad_request("name must not be empty"));
    }

    let pat_client = clients::ensure_pat_client(&pool)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;

    let minted = tokens::mint(
        &pool,
        tokens::MintRequest {
            client_id: pat_client.id,
            user_id: uid,
            scope: Scope::mcp(),
            kind: AccessTokenKind::Pat,
            name: name.to_owned(),
        },
    )
    .await
    .map_err(|e| ApiError::internal(e.to_string()))?;

    Ok(Json(CreatedPat {
        id: minted.id,
        name: name.to_owned(),
        token: minted.raw,
    }))
}

pub async fn delete_pat(
    auth: AuthSession<KayaAuthBackend>,
    Extension(pool): Extension<AnyPool>,
    Path(id): Path<Uuid>,
) -> Result<(StatusCode, Json<serde_json::Value>), ApiError> {
    let uid = user_id(&auth)?;
    let removed = tokens::revoke(&pool, uid, id)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    if !removed {
        return Err(ApiError::not_found(format!("token {id}")));
    }
    Ok((StatusCode::OK, Json(serde_json::json!({ "ok": true }))))
}

// ── Connected apps ──────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct ConnectedAppSummary {
    pub client_id: Uuid,
    pub client_name: String,
    pub token_count: i64,
    pub last_used_at: Option<i64>,
    pub first_authorized_at: i64,
}

pub async fn list_connected_apps(
    auth: AuthSession<KayaAuthBackend>,
    Extension(pool): Extension<AnyPool>,
) -> Result<Json<Vec<ConnectedAppSummary>>, ApiError> {
    let uid = user_id(&auth)?;
    let rows = tokens::list_connected_apps(&pool, uid)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(
        rows.into_iter()
            .map(|r| ConnectedAppSummary {
                client_id: r.client_id,
                client_name: r.client_name,
                token_count: r.token_count,
                last_used_at: r.last_used_at,
                first_authorized_at: r.first_authorized_at,
            })
            .collect(),
    ))
}

pub async fn revoke_connected_app(
    auth: AuthSession<KayaAuthBackend>,
    Extension(pool): Extension<AnyPool>,
    Path(client_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let uid = user_id(&auth)?;
    let n = tokens::revoke_for_client(&pool, uid, client_id)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(serde_json::json!({ "ok": true, "revoked": n })))
}
