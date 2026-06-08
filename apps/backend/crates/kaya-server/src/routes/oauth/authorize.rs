// Copyright 2024 Kaya Suites. Licensed under the Apache License, Version 2.0.
//! `GET /oauth/authorize` — entry point for the OAuth 2.1 code flow.
//!
//! Cookie-authed. If unauthenticated, the request is bounced to the Next.js
//! sign-in page with a `next=` param so the user lands back here after login.
//!
//! Validates the request and, on success, stashes a [`ConsentRequest`] in the
//! [`ConsentRequestStore`] and 302s the user to `/oauth/consent/{req_id}` where
//! the Next.js consent page renders.

use axum::{
    Extension,
    extract::Query,
    http::{StatusCode, header::LOCATION},
    response::{IntoResponse, Response},
};
use axum_login::AuthSession;
use chrono::Utc;
use kaya_auth::KayaAuthBackend;
use kaya_oauth::{PkceMethod, Scope, clients};
use serde::{Deserialize, Serialize};
use sqlx::AnyPool;
use uuid::Uuid;

use super::state::{CONSENT_TTL_SECS, ConsentRequest, ConsentRequestStore};

#[derive(Deserialize, Serialize)]
pub struct AuthorizeQuery {
    pub response_type: String,
    pub client_id: String,
    pub redirect_uri: String,
    #[serde(default)]
    pub scope: Option<String>,
    #[serde(default)]
    pub state: Option<String>,
    pub code_challenge: String,
    pub code_challenge_method: String,
}

pub async fn authorize(
    auth: AuthSession<KayaAuthBackend>,
    Extension(pool): Extension<AnyPool>,
    Extension(store): Extension<ConsentRequestStore>,
    Extension(issuer): Extension<super::OAuthIssuer>,
    Query(q): Query<AuthorizeQuery>,
) -> Response {
    // 1) Sign-in gate. We bounce to the Next.js sign-in page with the original
    //    authorize URL as `next`, so the user lands back here after login.
    if auth.user.is_none() {
        let next = format!(
            "{}/oauth/authorize?{}",
            issuer.url(),
            serde_urlencoded::to_string(&q).unwrap_or_default()
        );
        let signin = format!(
            "/auth/signin?next={}",
            urlencoding::encode(&next),
        );
        return redirect(&signin);
    }

    // 2) Validate response_type and PKCE method up front.
    if q.response_type != "code" {
        return redirect_with_error(&q.redirect_uri, q.state.as_deref(), "unsupported_response_type");
    }
    let pkce_method = match PkceMethod::parse(&q.code_challenge_method) {
        Ok(m) => m,
        Err(_) => return redirect_with_error(&q.redirect_uri, q.state.as_deref(), "invalid_request"),
    };
    if q.code_challenge.is_empty() {
        return redirect_with_error(&q.redirect_uri, q.state.as_deref(), "invalid_request");
    }
    let scope = match q.scope.as_deref().map(Scope::parse).transpose() {
        Ok(Some(s)) => s,
        Ok(None) => Scope::mcp(),
        Err(_) => return redirect_with_error(&q.redirect_uri, q.state.as_deref(), "invalid_scope"),
    };

    // 3) Look up the client and validate the redirect_uri.
    let client_id = match Uuid::parse_str(&q.client_id) {
        Ok(id) => id,
        Err(_) => return error_page(StatusCode::BAD_REQUEST, "unknown client"),
    };
    let client = match clients::get(&pool, client_id).await {
        Ok(Some(c)) => c,
        Ok(None) | Err(_) => return error_page(StatusCode::BAD_REQUEST, "unknown client"),
    };
    if !client.matches_redirect(&q.redirect_uri) {
        // Per OAuth 2.1 we MUST NOT redirect back when the redirect_uri itself
        // is unrecognised — render an inline error instead.
        return error_page(StatusCode::BAD_REQUEST, "redirect_uri not registered");
    }

    // 4) Stash the request and bounce to the consent UI.
    let now = Utc::now().timestamp_millis();
    let req_id = store
        .insert(ConsentRequest {
            client_id,
            redirect_uri: q.redirect_uri,
            scope,
            state: q.state,
            code_challenge: q.code_challenge,
            code_challenge_method: pkce_method,
            created_at: now,
            expires_at: now + CONSENT_TTL_SECS * 1000,
        })
        .await;

    redirect(&format!("/oauth/consent/{req_id}"))
}

fn redirect(location: &str) -> Response {
    (StatusCode::FOUND, [(LOCATION, location.to_owned())]).into_response()
}

fn redirect_with_error(redirect_uri: &str, state: Option<&str>, code: &str) -> Response {
    let mut url = redirect_uri.to_owned();
    let sep = if url.contains('?') { '&' } else { '?' };
    url.push(sep);
    url.push_str(&format!("error={code}"));
    if let Some(s) = state {
        url.push_str(&format!("&state={}", urlencoding::encode(s)));
    }
    redirect(&url)
}

fn error_page(status: StatusCode, msg: &str) -> Response {
    (status, msg.to_owned()).into_response()
}
