// Copyright 2024 Kaya Suites. All rights reserved. — BSL 1.1
//!
//! Document routes.
//!
//! - `POST /documents` — create a new document (requires auth)

use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
};
use kaya_tenant::{AuthSession, KayaAuthBackend};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/documents", post(create_document))
}

#[derive(Deserialize)]
struct CreateDocumentBody {
    title: String,
    content: String,
    #[serde(default)]
    tags: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentResponse {
    id: String,
    title: String,
    body: String,
    tags: Vec<String>,
}

async fn create_document(
    auth: AuthSession<KayaAuthBackend>,
    State(pool): State<PgPool>,
    Json(body): Json<CreateDocumentBody>,
) -> Response {
    let user = match auth.user {
        Some(u) => u,
        None => return StatusCode::UNAUTHORIZED.into_response(),
    };

    let id = Uuid::new_v4();

    let result = sqlx::query(
        "INSERT INTO documents (id, user_id, title, body, tags) VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(id)
    .bind(user.id)
    .bind(&body.title)
    .bind(&body.content)
    .bind(&body.tags)
    .execute(&pool)
    .await;

    match result {
        Ok(_) => (
            StatusCode::CREATED,
            Json(DocumentResponse {
                id: id.to_string(),
                title: body.title,
                body: body.content,
                tags: body.tags,
            }),
        )
            .into_response(),
        Err(e) => {
            tracing::error!(error = %e, "create_document failed");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}
