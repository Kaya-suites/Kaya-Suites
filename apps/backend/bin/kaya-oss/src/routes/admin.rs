// Copyright 2024 Kaya Suites. Licensed under the Apache License, Version 2.0.
//!
//! Founder admin routes — auth-gated to `ADMIN_EMAIL` or superadmin flag.
//!
//! - `GET  /admin/stats`                 — aggregate spend, top users, circuit state
//! - `POST /admin/circuit-breaker/reset` — reset a tripped circuit breaker
//! - `GET  /admin/users`                 — list all users (superadmin only)
//! - `POST /admin/users`                 — create a user (superadmin only)
//! - `DELETE /admin/users/:id`           — delete a user (superadmin only)

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{delete, get, post},
};
use kaya_metering::MeteringService;
use kaya_auth::{AuthSession, AuthUser, KayaAuthBackend, PasswordAuthService};
use serde::{Deserialize, Serialize};
use sqlx::{AnyPool, Row};
use uuid::Uuid;

use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/admin/stats", get(admin_stats))
        .route("/admin/circuit-breaker/reset", post(reset_circuit_breaker))
        .route("/admin/users", get(list_users))
        .route("/admin/users", post(create_user))
        .route("/admin/users/{id}", delete(delete_user))
}

fn is_founder(user: &AuthUser, admin_email: &str) -> bool {
    user.is_superadmin || user.email == admin_email
}

fn require_superadmin(user: &AuthUser) -> Result<(), Response> {
    if user.is_superadmin {
        Ok(())
    } else {
        Err(StatusCode::FORBIDDEN.into_response())
    }
}

async fn admin_stats(
    State(metering): State<Arc<MeteringService>>,
    State(state): State<AppState>,
    auth: AuthSession<KayaAuthBackend>,
) -> Response {
    let user = match auth.user {
        Some(u) => u,
        None => return StatusCode::UNAUTHORIZED.into_response(),
    };
    if !is_founder(&user, &state.admin_email) {
        return StatusCode::FORBIDDEN.into_response();
    }

    match metering.admin_stats().await {
        Ok(stats) => (StatusCode::OK, Json(stats)).into_response(),
        Err(e) => {
            tracing::error!(error = %e, "admin_stats failed");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

async fn reset_circuit_breaker(
    State(metering): State<Arc<MeteringService>>,
    State(state): State<AppState>,
    auth: AuthSession<KayaAuthBackend>,
) -> Response {
    let user = match auth.user {
        Some(u) => u,
        None => return StatusCode::UNAUTHORIZED.into_response(),
    };
    if !is_founder(&user, &state.admin_email) {
        return StatusCode::FORBIDDEN.into_response();
    }

    metering.reset_circuit_breaker().await;
    (StatusCode::OK, Json(serde_json::json!({"ok": true}))).into_response()
}

// ── User management routes (superadmin only) ──────────────────────────────────

#[derive(Serialize)]
struct UserRecord {
    id: String,
    email: String,
    username: Option<String>,
    is_superadmin: bool,
    created_at: String,
}

fn decode_bool_row(row: &sqlx::any::AnyRow, col: &str) -> bool {
    row.try_get::<bool, _>(col)
        .or_else(|_| row.try_get::<i64, _>(col).map(|n| n != 0))
        .or_else(|_| row.try_get::<i32, _>(col).map(|n| n != 0))
        .unwrap_or(false)
}

async fn list_users(State(state): State<AppState>, auth: AuthSession<KayaAuthBackend>) -> Response {
    let user = match auth.user {
        Some(u) => u,
        None => return StatusCode::UNAUTHORIZED.into_response(),
    };
    if let Err(r) = require_superadmin(&user) {
        return r;
    }

    let result = sqlx::query(
        "SELECT id, email, username, is_superadmin, created_at FROM users ORDER BY created_at",
    )
    .fetch_all(&state.pool)
    .await;

    match result {
        Ok(rows) => {
            let users: Vec<UserRecord> = rows
                .iter()
                .map(|r| UserRecord {
                    id: r.try_get::<String, _>("id").unwrap_or_default(),
                    email: r.try_get("email").unwrap_or_default(),
                    username: r.try_get("username").unwrap_or(None),
                    is_superadmin: decode_bool_row(r, "is_superadmin"),
                    created_at: r.try_get::<String, _>("created_at").unwrap_or_default(),
                })
                .collect();
            (StatusCode::OK, Json(users)).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "list_users failed");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

#[derive(Deserialize)]
struct CreateUserBody {
    email: String,
    username: Option<String>,
    password: String,
    #[serde(default)]
    is_superadmin: bool,
}

async fn create_user(
    State(password_auth_svc): State<Arc<PasswordAuthService>>,
    State(state): State<AppState>,
    auth: AuthSession<KayaAuthBackend>,
    Json(body): Json<CreateUserBody>,
) -> Response {
    let user = match auth.user {
        Some(u) => u,
        None => return StatusCode::UNAUTHORIZED.into_response(),
    };
    if let Err(r) = require_superadmin(&user) {
        return r;
    }

    let created = match password_auth_svc
        .register(&body.email, body.username.as_deref(), &body.password)
        .await
    {
        Ok(u) => u,
        Err(kaya_auth::RegisterError::EmailAlreadyExists) => {
            return (
                StatusCode::CONFLICT,
                Json(serde_json::json!({"error": "email_already_exists"})),
            )
                .into_response();
        }
        Err(kaya_auth::RegisterError::UsernameTaken) => {
            return (
                StatusCode::CONFLICT,
                Json(serde_json::json!({"error": "username_taken"})),
            )
                .into_response();
        }
        Err(e) => {
            tracing::error!(error = %e, "create_user failed");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };

    if body.is_superadmin {
        let _ = sqlx::query("UPDATE users SET is_superadmin = ? WHERE id = ?")
            .bind(true)
            .bind(created.id.to_string())
            .execute(&state.pool)
            .await;
    }

    (
        StatusCode::CREATED,
        Json(serde_json::json!({
            "id": created.id,
            "email": created.email,
            "username": created.username,
            "is_superadmin": body.is_superadmin,
        })),
    )
        .into_response()
}

async fn delete_user(
    State(state): State<AppState>,
    auth: AuthSession<KayaAuthBackend>,
    Path(target_id): Path<Uuid>,
) -> Response {
    let user = match auth.user {
        Some(u) => u,
        None => return StatusCode::UNAUTHORIZED.into_response(),
    };
    if let Err(r) = require_superadmin(&user) {
        return r;
    }

    if user.id == target_id {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "cannot_delete_self"})),
        )
            .into_response();
    }

    // Check if target is superadmin
    let row = sqlx::query("SELECT is_superadmin FROM users WHERE id = ?")
        .bind(target_id.to_string())
        .fetch_optional(&state.pool)
        .await;

    let is_target_superadmin = row
        .ok()
        .flatten()
        .map(|r| decode_bool_row(&r, "is_superadmin"))
        .unwrap_or(false);

    if is_target_superadmin {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "cannot_delete_superadmin"})),
        )
            .into_response();
    }

    match sqlx::query("DELETE FROM users WHERE id = ?")
        .bind(target_id.to_string())
        .execute(&state.pool)
        .await
    {
        Ok(r) if r.rows_affected() == 0 => StatusCode::NOT_FOUND.into_response(),
        Ok(_) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => {
            tracing::error!(error = %e, "delete_user failed");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}
