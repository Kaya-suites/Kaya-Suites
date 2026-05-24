// Copyright 2024 Kaya Suites. Licensed under the Apache License, Version 2.0.
//!
//! Founder admin routes — auth-gated to `ADMIN_EMAIL` or superadmin flag.
//!
//! - `GET  /admin/stats`                 — aggregate spend, top users, circuit state
//! - `POST /admin/circuit-breaker/reset` — reset a tripped circuit breaker
//! - `GET  /admin/users`                 — list all users (superadmin only)
//! - `POST /admin/users`                 — create a user (superadmin only)
//! - `DELETE /admin/users/:id`           — delete a user (superadmin only)
//! - `GET  /admin/tables`                — list browsable table names (founder only)
//! - `GET  /admin/table/:name`           — paginated table rows (founder only)
//! - `POST /admin/query`                 — execute a read-only SELECT (founder only)

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{delete, get, post},
};
use kaya_auth::{AuthSession, AuthUser, KayaAuthBackend, PasswordAuthService};
use kaya_metering::MeteringService;
use serde::{Deserialize, Serialize};
use sqlx::{Column, Row, TypeInfo as _};
use uuid::Uuid;

use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/admin/stats", get(admin_stats))
        .route("/admin/circuit-breaker/reset", post(reset_circuit_breaker))
        .route("/admin/users", get(list_users))
        .route("/admin/users", post(create_user))
        .route("/admin/users/{id}", delete(delete_user))
        .route("/admin/tables", get(list_tables))
        .route("/admin/table/{name}", get(browse_table))
        .route("/admin/query", post(run_query))
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

// ── Database browser routes (founder only) ────────────────────────────────────

const BROWSABLE_TABLES: &[&str] = &[
    "users",
    "documents",
    "chat_sessions",
    "chat_messages",
    "usage_events",
    "usage_counters",
    "subscriptions",
    "system_flags",
];

// Tables that have a created_at column for deterministic ordering.
const TABLES_WITH_CREATED_AT: &[&str] = &[
    "users",
    "documents",
    "chat_sessions",
    "chat_messages",
    "usage_events",
    "usage_counters",
    "subscriptions",
];

fn any_row_to_json(row: &sqlx::any::AnyRow) -> Vec<serde_json::Value> {
    row.columns()
        .iter()
        .map(|col| {
            let name = col.name();
            let type_name = col.type_info().name().to_ascii_lowercase();
            // Try integer types first, then float, then bool, then string, then null.
            if type_name.contains("int") || type_name == "bigint" || type_name == "integer" {
                if let Ok(v) = row.try_get::<i64, _>(name) {
                    return serde_json::Value::Number(v.into());
                }
            }
            if type_name.contains("real") || type_name.contains("float") || type_name.contains("double") || type_name.contains("numeric") || type_name.contains("decimal") {
                if let Ok(v) = row.try_get::<f64, _>(name) {
                    if let Some(n) = serde_json::Number::from_f64(v) {
                        return serde_json::Value::Number(n);
                    }
                }
            }
            if type_name == "bool" || type_name == "boolean" {
                if let Ok(v) = row.try_get::<bool, _>(name) {
                    return serde_json::Value::Bool(v);
                }
            }
            // Fallback: try i64 generically (catches booleans stored as ints).
            if let Ok(v) = row.try_get::<i64, _>(name) {
                return serde_json::Value::Number(v.into());
            }
            if let Ok(v) = row.try_get::<f64, _>(name) {
                if let Some(n) = serde_json::Number::from_f64(v) {
                    return serde_json::Value::Number(n);
                }
            }
            if let Ok(v) = row.try_get::<String, _>(name) {
                return serde_json::Value::String(v);
            }
            serde_json::Value::Null
        })
        .collect()
}

async fn list_tables(State(state): State<AppState>, auth: AuthSession<KayaAuthBackend>) -> Response {
    let user = match auth.user {
        Some(u) => u,
        None => return StatusCode::UNAUTHORIZED.into_response(),
    };
    if !is_founder(&user, &state.admin_email) {
        return StatusCode::FORBIDDEN.into_response();
    }

    (StatusCode::OK, Json(serde_json::json!({ "tables": BROWSABLE_TABLES }))).into_response()
}

#[derive(Deserialize)]
struct PaginationParams {
    #[serde(default = "default_page")]
    page: u32,
    #[serde(default = "default_page_size")]
    page_size: u32,
}

fn default_page() -> u32 { 1 }
fn default_page_size() -> u32 { 50 }

#[derive(Serialize)]
struct TableResponse {
    columns: Vec<String>,
    rows: Vec<Vec<serde_json::Value>>,
    total: i64,
    page: u32,
    page_size: u32,
}

async fn browse_table(
    State(state): State<AppState>,
    auth: AuthSession<KayaAuthBackend>,
    Path(table_name): Path<String>,
    Query(params): Query<PaginationParams>,
) -> Response {
    let user = match auth.user {
        Some(u) => u,
        None => return StatusCode::UNAUTHORIZED.into_response(),
    };
    if !is_founder(&user, &state.admin_email) {
        return StatusCode::FORBIDDEN.into_response();
    }
    if !BROWSABLE_TABLES.contains(&table_name.as_str()) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "unknown_table"})),
        )
            .into_response();
    }

    let page_size = params.page_size.clamp(1, 200);
    let page = params.page.max(1);
    let offset = (page - 1) * page_size;

    let order = if TABLES_WITH_CREATED_AT.contains(&table_name.as_str()) {
        "ORDER BY created_at DESC"
    } else {
        ""
    };

    let select_sql = format!(
        "SELECT * FROM {table_name} {order} LIMIT {page_size} OFFSET {offset}"
    );
    let count_sql = format!("SELECT COUNT(*) as n FROM {table_name}");

    let rows_result = sqlx::query(&select_sql).fetch_all(&state.pool).await;
    let count_result = sqlx::query(&count_sql).fetch_one(&state.pool).await;

    match (rows_result, count_result) {
        (Ok(rows), Ok(count_row)) => {
            let total: i64 = count_row.try_get::<i64, _>("n")
                .or_else(|_| count_row.try_get::<i64, _>(0))
                .unwrap_or(0);

            let columns: Vec<String> = rows
                .first()
                .map(|r| r.columns().iter().map(|c| c.name().to_string()).collect())
                .unwrap_or_default();

            let data: Vec<Vec<serde_json::Value>> = rows.iter().map(any_row_to_json).collect();

            (
                StatusCode::OK,
                Json(TableResponse {
                    columns,
                    rows: data,
                    total,
                    page,
                    page_size,
                }),
            )
                .into_response()
        }
        (Err(e), _) | (_, Err(e)) => {
            tracing::error!(error = %e, table = %table_name, "browse_table failed");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

#[derive(Deserialize)]
struct QueryBody {
    sql: String,
}

#[derive(Serialize)]
struct QueryResponse {
    columns: Vec<String>,
    rows: Vec<Vec<serde_json::Value>>,
}

fn validate_select_only(sql: &str) -> Result<(), &'static str> {
    let upper = sql.trim().to_ascii_uppercase();

    if !upper.starts_with("SELECT") {
        return Err("Only SELECT statements are allowed.");
    }
    if upper.contains(';') {
        return Err("Multi-statement queries are not allowed.");
    }
    // Split on non-alpha chars and check each token against the banned list.
    let tokens: Vec<&str> = upper
        .split(|c: char| !c.is_ascii_alphabetic())
        .filter(|t| !t.is_empty())
        .collect();
    const BANNED: &[&str] = &[
        "INSERT", "UPDATE", "DELETE", "DROP", "CREATE", "ALTER",
        "TRUNCATE", "GRANT", "REVOKE",
    ];
    for banned in BANNED {
        if tokens.contains(banned) {
            return Err("DML and DDL statements are not allowed.");
        }
    }
    Ok(())
}

async fn run_query(
    State(state): State<AppState>,
    auth: AuthSession<KayaAuthBackend>,
    Json(body): Json<QueryBody>,
) -> Response {
    let user = match auth.user {
        Some(u) => u,
        None => return StatusCode::UNAUTHORIZED.into_response(),
    };
    if !is_founder(&user, &state.admin_email) {
        return StatusCode::FORBIDDEN.into_response();
    }

    if let Err(msg) = validate_select_only(body.sql.trim()) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": msg})),
        )
            .into_response();
    }

    match sqlx::query(body.sql.trim()).fetch_all(&state.pool).await {
        Ok(rows) => {
            let columns: Vec<String> = rows
                .first()
                .map(|r| r.columns().iter().map(|c| c.name().to_string()).collect())
                .unwrap_or_default();

            let data: Vec<Vec<serde_json::Value>> = rows.iter().map(any_row_to_json).collect();

            (StatusCode::OK, Json(QueryResponse { columns, rows: data })).into_response()
        }
        Err(e) => {
            tracing::warn!(error = %e, "admin query failed");
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": e.to_string()})),
            )
                .into_response()
        }
    }
}
