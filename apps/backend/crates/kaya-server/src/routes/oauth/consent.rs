// Copyright 2024 Kaya Suites. Licensed under the Apache License, Version 2.0.
//! Consent endpoints — cookie-authed.
//!
//! - `GET /oauth/consent/{req_id}` — returns enough data for the Next.js page
//!   to render the "X wants access to your knowledge base" screen.
//! - `POST /oauth/consent/{req_id}` `{ decision }` — on allow, mints the auth
//!   code and 302s to `redirect_uri?code=…&state=…`; on deny, 302s with `error`.

use axum::{
    Extension, Json,
    extract::Path,
    http::{StatusCode, header::LOCATION},
    response::{IntoResponse, Response},
};
use axum_login::AuthSession;
use kaya_auth::KayaAuthBackend;
use kaya_oauth::{clients, codes};
use serde::{Deserialize, Serialize};
use sqlx::AnyPool;
use uuid::Uuid;

use super::state::ConsentRequestStore;

#[derive(Serialize)]
pub struct ConsentDetails {
    pub req_id: String,
    pub client_id: String,
    pub client_name: String,
    pub redirect_uri: String,
    pub scope: String,
    pub expires_at: i64,
}

pub async fn get_consent_request(
    auth: AuthSession<KayaAuthBackend>,
    Extension(pool): Extension<AnyPool>,
    Extension(store): Extension<ConsentRequestStore>,
    Path(req_id): Path<Uuid>,
) -> Result<Json<ConsentDetails>, (StatusCode, &'static str)> {
    if auth.user.is_none() {
        return Err((StatusCode::UNAUTHORIZED, "unauthenticated"));
    }
    let req = store
        .get(req_id)
        .await
        .ok_or((StatusCode::NOT_FOUND, "consent request expired"))?;
    let client = clients::get(&pool, req.client_id)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "lookup failed"))?
        .ok_or((StatusCode::NOT_FOUND, "client missing"))?;

    Ok(Json(ConsentDetails {
        req_id: req_id.to_string(),
        client_id: req.client_id.to_string(),
        client_name: client.name,
        redirect_uri: req.redirect_uri,
        scope: req.scope.as_str().to_owned(),
        expires_at: req.expires_at,
    }))
}

#[derive(Deserialize)]
pub struct DecideBody {
    /// `"allow"` or `"deny"`.
    pub decision: String,
}

pub async fn decide(
    auth: AuthSession<KayaAuthBackend>,
    Extension(pool): Extension<AnyPool>,
    Extension(store): Extension<ConsentRequestStore>,
    Path(req_id): Path<Uuid>,
    Json(body): Json<DecideBody>,
) -> Response {
    let Some(user) = auth.user.as_ref() else {
        return (StatusCode::UNAUTHORIZED, "unauthenticated").into_response();
    };
    let Some(req) = store.take(req_id).await else {
        return (StatusCode::NOT_FOUND, "consent request expired").into_response();
    };

    let allow = body.decision.as_str() == "allow";

    if !allow {
        return Json(serde_json::json!({
            "redirect": redirect_with_error(&req.redirect_uri, req.state.as_deref(), "access_denied"),
        }))
        .into_response();
    }

    // Mint the auth code.
    let minted = match codes::mint(
        &pool,
        codes::MintRequest {
            client_id: req.client_id,
            user_id: user.id,
            redirect_uri: req.redirect_uri.clone(),
            scope: req.scope.clone(),
            code_challenge: req.code_challenge.clone(),
            code_challenge_method: req.code_challenge_method,
        },
    )
    .await
    {
        Ok(m) => m,
        Err(e) => {
            tracing::error!(error = %e, "mint auth code failed");
            return (StatusCode::INTERNAL_SERVER_ERROR, "mint failed").into_response();
        }
    };

    let mut url = req.redirect_uri;
    let sep = if url.contains('?') { '&' } else { '?' };
    url.push(sep);
    url.push_str(&format!("code={}", urlencoding::encode(&minted.raw)));
    if let Some(s) = &req.state {
        url.push_str(&format!("&state={}", urlencoding::encode(s)));
    }

    // We return a JSON redirect target rather than a 302 so the frontend can
    // navigate cleanly (avoids CORS/redirect quirks across origins).
    (
        StatusCode::OK,
        [(LOCATION, url.clone())],
        Json(serde_json::json!({ "redirect": url })),
    )
        .into_response()
}

fn redirect_with_error(redirect_uri: &str, state: Option<&str>, code: &str) -> String {
    let mut url = redirect_uri.to_owned();
    let sep = if url.contains('?') { '&' } else { '?' };
    url.push(sep);
    url.push_str(&format!("error={code}"));
    if let Some(s) = state {
        url.push_str(&format!("&state={}", urlencoding::encode(s)));
    }
    url
}
