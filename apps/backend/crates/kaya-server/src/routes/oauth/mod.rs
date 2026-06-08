// Copyright 2024 Kaya Suites. Licensed under the Apache License, Version 2.0.
//! OAuth 2.1 authorization-server endpoints.
//!
//! Two routers are exported:
//!
//! - [`public_router`] — `/.well-known/oauth-authorization-server`,
//!   `/.well-known/oauth-protected-resource`, `POST /oauth/register`,
//!   `POST /oauth/token`. No cookie auth.
//! - [`authenticated_router`] — `GET /oauth/authorize` and the
//!   `/oauth/consent/*` family. Mounted under the cookie-auth layer.

use axum::{Router, routing::{get, post}};

pub mod authorize;
pub mod consent;
pub mod discovery;
pub mod issuer;
pub mod pat;
pub mod register;
pub mod state;
pub mod token;

pub use issuer::OAuthIssuer;
pub use state::{ConsentRequest, ConsentRequestStore};

/// Public OAuth endpoints (no cookie auth). Mount outside the auth layer.
pub fn public_router<S: Clone + Send + Sync + 'static>() -> Router<S> {
    Router::new()
        .route(
            "/.well-known/oauth-authorization-server",
            get(discovery::authorization_server),
        )
        .route(
            "/.well-known/oauth-protected-resource",
            get(discovery::protected_resource),
        )
        .route("/oauth/register", post(register::register))
        .route("/oauth/token", post(token::token))
}

/// Authenticated OAuth endpoints (cookie auth). Mounted inside the shared
/// router by `routes::router()` so they pick up the existing `inject_storage`
/// layer.
pub fn authenticated_routes<S: Clone + Send + Sync + 'static>(router: Router<S>) -> Router<S> {
    router
        .route("/oauth/authorize", get(authorize::authorize))
        .route(
            "/oauth/consent/{req_id}",
            get(consent::get_consent_request).post(consent::decide),
        )
        .route(
            "/oauth/personal-tokens",
            get(pat::list_pats).post(pat::create_pat),
        )
        .route(
            "/oauth/personal-tokens/{id}",
            axum::routing::delete(pat::delete_pat),
        )
        .route("/oauth/connected-apps", get(pat::list_connected_apps))
        .route(
            "/oauth/connected-apps/{client_id}",
            axum::routing::delete(pat::revoke_connected_app),
        )
}
