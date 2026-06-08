// Copyright 2024 Kaya Suites. Licensed under the Apache License, Version 2.0.
//! End-to-end HTTP test of the OAuth public router.
//!
//! Builds `kaya_server::oauth_public_router` in-process with a real sqlite
//! `AnyPool`, mints an authorization code through `kaya_oauth::codes::mint`,
//! POSTs `/oauth/token`, and asserts the returned access token resolves.

use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode, header::CONTENT_TYPE},
};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use http_body_util::BodyExt;
use kaya_db::Dialect;
use kaya_oauth::{
    ClientType, PkceMethod, RegistrationKind, Scope, clients, codes, tokens,
};
use kaya_server::OAuthIssuer;
use sha2::{Digest, Sha256};
use sqlx::AnyPool;
use tower::ServiceExt;
use uuid::Uuid;

async fn fresh_app() -> (tempfile::TempDir, AnyPool, Router) {
    sqlx::any::install_default_drivers();
    let dir = tempfile::tempdir().expect("tempdir");
    let url = format!("sqlite://{}/kaya.db?mode=rwc", dir.path().display());
    let pool = AnyPool::connect(&url).await.expect("connect");
    kaya_db::run_migrations(&pool, Dialect::Sqlite)
        .await
        .expect("migrate");

    let app: Router = kaya_server::oauth_public_router()
        .layer(axum::Extension(pool.clone()))
        .layer(axum::Extension(OAuthIssuer::new("http://localhost:3001")));
    (dir, pool, app)
}

async fn seed_user(pool: &AnyPool) -> Uuid {
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO users (id, email, password_hash, is_superadmin, created_at, updated_at) \
         VALUES (?, ?, ?, 0, strftime('%Y-%m-%dT%H:%M:%SZ','now'), strftime('%Y-%m-%dT%H:%M:%SZ','now'))",
    )
    .bind(id.to_string())
    .bind(format!("{id}@example.test"))
    .bind("placeholder")
    .execute(pool)
    .await
    .expect("seed user");
    id
}

fn challenge_for(verifier: &str) -> String {
    let mut h = Sha256::new();
    h.update(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(h.finalize())
}

async fn read_json(resp: axum::response::Response) -> serde_json::Value {
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).unwrap()
}

// ── /oauth/token — full auth-code dance ─────────────────────────────────────

#[tokio::test]
async fn token_endpoint_exchanges_code_for_access_token() {
    let (_dir, pool, app) = fresh_app().await;
    let user = seed_user(&pool).await;

    let reg = clients::register(
        &pool,
        clients::RegisterRequest {
            name: "test-client".into(),
            redirect_uris: vec!["http://localhost/cb".into()],
            client_type: ClientType::Public,
            registration_kind: RegistrationKind::Dcr,
            owner_user_id: None,
        },
    )
    .await
    .expect("register");

    let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    let challenge = challenge_for(verifier);

    let code = codes::mint(
        &pool,
        codes::MintRequest {
            client_id: reg.client.id,
            user_id: user,
            redirect_uri: "http://localhost/cb".into(),
            scope: Scope::mcp(),
            code_challenge: challenge,
            code_challenge_method: PkceMethod::S256,
        },
    )
    .await
    .expect("mint code");

    let body = serde_urlencoded::to_string([
        ("grant_type", "authorization_code"),
        ("code", &code.raw),
        ("redirect_uri", "http://localhost/cb"),
        ("code_verifier", verifier),
        ("client_id", &reg.client.id.to_string()),
    ])
    .unwrap();

    let req = Request::builder()
        .method("POST")
        .uri("/oauth/token")
        .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
        .body(Body::from(body))
        .unwrap();

    let resp = app.clone().oneshot(req).await.expect("oneshot");
    assert_eq!(resp.status(), StatusCode::OK);

    let json = read_json(resp).await;
    let access_token = json["access_token"].as_str().expect("access_token");
    assert!(access_token.starts_with("kaya_oat_"));
    assert_eq!(json["token_type"], "Bearer");
    assert_eq!(json["scope"], "mcp");

    // The returned token resolves against the DB and binds to the right user.
    let resolved = tokens::resolve(&pool, access_token).await.expect("resolve");
    assert_eq!(resolved.user_id, user);
    assert_eq!(resolved.client_id, reg.client.id);
}

#[tokio::test]
async fn token_endpoint_rejects_replayed_code() {
    let (_dir, pool, app) = fresh_app().await;
    let user = seed_user(&pool).await;
    let reg = clients::register(
        &pool,
        clients::RegisterRequest {
            name: "rep".into(),
            redirect_uris: vec!["http://localhost/cb".into()],
            client_type: ClientType::Public,
            registration_kind: RegistrationKind::Dcr,
            owner_user_id: None,
        },
    )
    .await
    .unwrap();

    let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    let challenge = challenge_for(verifier);
    let code = codes::mint(
        &pool,
        codes::MintRequest {
            client_id: reg.client.id,
            user_id: user,
            redirect_uri: "http://localhost/cb".into(),
            scope: Scope::mcp(),
            code_challenge: challenge,
            code_challenge_method: PkceMethod::S256,
        },
    )
    .await
    .unwrap();

    let make_req = || {
        let body = serde_urlencoded::to_string([
            ("grant_type", "authorization_code"),
            ("code", &code.raw),
            ("redirect_uri", "http://localhost/cb"),
            ("code_verifier", verifier),
            ("client_id", &reg.client.id.to_string()),
        ])
        .unwrap();
        Request::builder()
            .method("POST")
            .uri("/oauth/token")
            .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
            .body(Body::from(body))
            .unwrap()
    };

    assert_eq!(app.clone().oneshot(make_req()).await.unwrap().status(), StatusCode::OK);
    let replay = app.clone().oneshot(make_req()).await.unwrap();
    assert_eq!(replay.status(), StatusCode::BAD_REQUEST);
    let body = read_json(replay).await;
    assert_eq!(body["error"], "invalid_grant");
}

// ── /.well-known discovery ──────────────────────────────────────────────────

#[tokio::test]
async fn discovery_doc_exposes_required_endpoints() {
    let (_dir, _pool, app) = fresh_app().await;
    let req = Request::builder()
        .method("GET")
        .uri("/.well-known/oauth-authorization-server")
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let json = read_json(resp).await;
    assert_eq!(json["issuer"], "http://localhost:3001");
    assert_eq!(
        json["authorization_endpoint"],
        "http://localhost:3001/oauth/authorize"
    );
    assert_eq!(json["token_endpoint"], "http://localhost:3001/oauth/token");
    assert_eq!(
        json["registration_endpoint"],
        "http://localhost:3001/oauth/register"
    );
    assert_eq!(json["code_challenge_methods_supported"][0], "S256");
    assert_eq!(json["scopes_supported"][0], "mcp");
}

// ── /oauth/register — DCR end to end ────────────────────────────────────────

#[tokio::test]
async fn dcr_round_trip_produces_usable_client() {
    let (_dir, pool, app) = fresh_app().await;
    let body = serde_json::json!({
        "redirect_uris": ["http://localhost:7321/cb"],
        "client_name": "Claude Desktop",
        "token_endpoint_auth_method": "none"
    });
    let req = Request::builder()
        .method("POST")
        .uri("/oauth/register")
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let json = read_json(resp).await;
    let client_id = json["client_id"].as_str().unwrap();
    assert_eq!(json["client_name"], "Claude Desktop");
    assert!(json["client_secret"].is_null(), "public client → no secret");
    assert!(
        json["registration_access_token"].as_str().unwrap().starts_with("kaya_rat_"),
        "DCR → registration_access_token issued"
    );

    // The registration is real — the client authenticates against the DB.
    let id = Uuid::parse_str(client_id).unwrap();
    clients::authenticate(&pool, id, None)
        .await
        .expect("public client authenticates without secret");
}
