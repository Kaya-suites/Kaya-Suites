// Copyright 2024 Kaya Suites. Licensed under the Apache License, Version 2.0.
//!
//! Password-based auth routes.
//!
//! - `POST /auth/register` — create a new account
//! - `POST /auth/login`    — authenticate and create a session
//! - `GET  /auth/me`       — return current user (for session-check proxy)
//! - `POST /auth/logout`   — destroy session

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use kaya_auth::{AuthSession, KayaAuthBackend, PasswordAuthService, RegisterError};
use serde::{Deserialize, Serialize};

use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/register", post(register))
        .route("/auth/login", post(login))
        .route("/auth/me", get(me))
        .route("/auth/logout", post(logout))
}

#[derive(Deserialize)]
struct RegisterBody {
    email: String,
    username: Option<String>,
    password: String,
}

#[derive(Serialize)]
struct UserResponse {
    user_id: String,
    email: String,
    username: Option<String>,
    is_superadmin: bool,
}

async fn register(
    State(svc): State<Arc<PasswordAuthService>>,
    mut auth: AuthSession<KayaAuthBackend>,
    Json(body): Json<RegisterBody>,
) -> Response {
    match svc
        .register(&body.email, body.username.as_deref(), &body.password)
        .await
    {
        Ok(user) => {
            let response = UserResponse {
                user_id: user.id.to_string(),
                email: user.email.clone(),
                username: user.username.clone(),
                is_superadmin: user.is_superadmin,
            };
            if let Err(e) = auth.login(&user).await {
                tracing::error!(error = %e, "session login failed after register");
                return StatusCode::INTERNAL_SERVER_ERROR.into_response();
            }
            (StatusCode::CREATED, Json(response)).into_response()
        }
        Err(RegisterError::EmailAlreadyExists) => (
            StatusCode::CONFLICT,
            Json(serde_json::json!({ "error": "email_already_exists" })),
        )
            .into_response(),
        Err(RegisterError::UsernameTaken) => (
            StatusCode::CONFLICT,
            Json(serde_json::json!({ "error": "username_taken" })),
        )
            .into_response(),
        Err(RegisterError::WeakPassword(reason)) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "weak_password", "reason": reason })),
        )
            .into_response(),
        Err(e) => {
            tracing::error!(error = %e, "register failed");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

#[derive(Deserialize)]
struct LoginBody {
    email: String,
    password: String,
}

async fn login(mut auth: AuthSession<KayaAuthBackend>, Json(body): Json<LoginBody>) -> Response {
    use kaya_auth::PasswordCredentials;

    let creds = PasswordCredentials {
        email: body.email,
        password: body.password,
    };

    match auth.authenticate(creds).await {
        Ok(Some(user)) => {
            let response = UserResponse {
                user_id: user.id.to_string(),
                email: user.email.clone(),
                username: user.username.clone(),
                is_superadmin: user.is_superadmin,
            };
            if let Err(e) = auth.login(&user).await {
                tracing::error!(error = %e, "session login failed");
                return StatusCode::INTERNAL_SERVER_ERROR.into_response();
            }
            Json(response).into_response()
        }
        Ok(None) => (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "error": "invalid_credentials" })),
        )
            .into_response(),
        Err(e) => {
            tracing::error!(error = %e, "login failed");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

async fn me(auth: AuthSession<KayaAuthBackend>) -> Response {
    match auth.user {
        Some(user) => Json(UserResponse {
            user_id: user.id.to_string(),
            email: user.email,
            username: user.username,
            is_superadmin: user.is_superadmin,
        })
        .into_response(),
        None => StatusCode::UNAUTHORIZED.into_response(),
    }
}

async fn logout(mut auth: AuthSession<KayaAuthBackend>) -> Response {
    if let Err(e) = auth.logout().await {
        tracing::error!(error = %e, "logout failed");
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    StatusCode::NO_CONTENT.into_response()
}
