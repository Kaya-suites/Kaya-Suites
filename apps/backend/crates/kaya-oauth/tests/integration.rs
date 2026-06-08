// Copyright 2024 Kaya Suites. Licensed under the Apache License, Version 2.0.
//! Integration tests for `kaya-oauth`.
//!
//! Covers: client register/authenticate, PKCE-bound auth-code one-shot consume,
//! access-token mint/resolve/revoke + cascading revoke-for-client.

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use kaya_db::Dialect;
use kaya_oauth::{
    AccessTokenKind, ClientType, OAuthError, PkceMethod, RegistrationKind, Scope, clients,
    codes, crypto, tokens,
};
use sha2::{Digest, Sha256};
use sqlx::AnyPool;
use uuid::Uuid;

async fn fresh_pool() -> (tempfile::TempDir, AnyPool) {
    sqlx::any::install_default_drivers();
    let dir = tempfile::tempdir().expect("tempdir");
    let url = format!("sqlite://{}/kaya.db?mode=rwc", dir.path().display());
    let pool = AnyPool::connect(&url).await.expect("connect");
    kaya_db::run_migrations(&pool, Dialect::Sqlite)
        .await
        .expect("migrate");
    (dir, pool)
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

// ── Client register + authenticate ──────────────────────────────────────────

#[tokio::test]
async fn confidential_client_authenticates_with_secret() {
    let (_dir, pool) = fresh_pool().await;
    let admin = seed_user(&pool).await;

    let reg = clients::register(
        &pool,
        clients::RegisterRequest {
            name: "test-app".into(),
            redirect_uris: vec!["http://localhost:9000/cb".into()],
            client_type: ClientType::Confidential,
            registration_kind: RegistrationKind::Manual,
            owner_user_id: Some(admin),
        },
    )
    .await
    .expect("register");

    let raw_secret = reg.client_secret.clone().expect("confidential → secret");
    assert!(raw_secret.starts_with("kaya_sec_"));

    clients::authenticate(&pool, reg.client.id, Some(&raw_secret))
        .await
        .expect("auth with correct secret");

    assert!(matches!(
        clients::authenticate(&pool, reg.client.id, Some("wrong")).await,
        Err(OAuthError::InvalidClient)
    ));

    // Confidential client must NOT auth without a secret.
    assert!(matches!(
        clients::authenticate(&pool, reg.client.id, None).await,
        Err(OAuthError::InvalidClient)
    ));
}

#[tokio::test]
async fn public_client_authenticates_without_secret() {
    let (_dir, pool) = fresh_pool().await;

    let reg = clients::register(
        &pool,
        clients::RegisterRequest {
            name: "claude-desktop".into(),
            redirect_uris: vec!["http://127.0.0.1:7321/cb".into()],
            client_type: ClientType::Public,
            registration_kind: RegistrationKind::Dcr,
            owner_user_id: None,
        },
    )
    .await
    .expect("register");

    assert!(reg.client_secret.is_none(), "public client → no secret");
    assert!(
        reg.registration_access_token.is_some(),
        "DCR client → RAT issued"
    );

    clients::authenticate(&pool, reg.client.id, None)
        .await
        .expect("public auth no secret");
}

// ── Authorization code lifecycle ────────────────────────────────────────────

#[tokio::test]
async fn auth_code_full_dance_with_pkce() {
    let (_dir, pool) = fresh_pool().await;
    let user = seed_user(&pool).await;

    let reg = clients::register(
        &pool,
        clients::RegisterRequest {
            name: "client".into(),
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

    let minted = codes::mint(
        &pool,
        codes::MintRequest {
            client_id: reg.client.id,
            user_id: user,
            redirect_uri: "http://localhost/cb".into(),
            scope: Scope::mcp(),
            code_challenge: challenge.clone(),
            code_challenge_method: PkceMethod::S256,
        },
    )
    .await
    .expect("mint code");

    // peek doesn't consume.
    let peeked = codes::peek(&pool, &minted.raw).await.expect("peek");
    assert_eq!(peeked.user_id, user);
    assert_eq!(peeked.client_id, reg.client.id);
    crypto::verify_pkce(PkceMethod::S256, verifier, &peeked.code_challenge)
        .expect("pkce verifies");

    // consume succeeds once.
    let consumed = codes::consume(&pool, &minted.raw).await.expect("consume");
    assert_eq!(consumed.client_id, reg.client.id);

    // consume again → InvalidGrant. Replay protection is structural via the
    // `consumed_at IS NULL` guard in the UPDATE.
    assert!(matches!(
        codes::consume(&pool, &minted.raw).await,
        Err(OAuthError::InvalidGrant)
    ));
}

#[tokio::test]
async fn pkce_wrong_verifier_rejected() {
    let challenge = challenge_for("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
    assert!(matches!(
        crypto::verify_pkce(
            PkceMethod::S256,
            "ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ",
            &challenge,
        ),
        Err(OAuthError::InvalidGrant)
    ));
}

// ── Access token lifecycle ──────────────────────────────────────────────────

#[tokio::test]
async fn access_token_round_trip() {
    let (_dir, pool) = fresh_pool().await;
    let user = seed_user(&pool).await;
    let reg = clients::register(
        &pool,
        clients::RegisterRequest {
            name: "client".into(),
            redirect_uris: vec!["http://localhost/cb".into()],
            client_type: ClientType::Public,
            registration_kind: RegistrationKind::Dcr,
            owner_user_id: None,
        },
    )
    .await
    .unwrap();

    let minted = tokens::mint(
        &pool,
        tokens::MintRequest {
            client_id: reg.client.id,
            user_id: user,
            scope: Scope::mcp(),
            kind: AccessTokenKind::Access,
            name: String::new(),
        },
    )
    .await
    .unwrap();
    assert!(minted.raw.starts_with("kaya_oat_"));

    let resolved = tokens::resolve(&pool, &minted.raw).await.expect("resolve");
    assert_eq!(resolved.user_id, user);
    assert_eq!(resolved.client_id, reg.client.id);
    assert!(resolved.is_active());

    // Single-token revoke.
    assert!(tokens::revoke(&pool, user, minted.id).await.unwrap());
    assert!(matches!(
        tokens::resolve(&pool, &minted.raw).await,
        Err(OAuthError::InvalidGrant)
    ));
}

#[tokio::test]
async fn revoke_for_client_kills_all_tokens_for_user() {
    let (_dir, pool) = fresh_pool().await;
    let user = seed_user(&pool).await;
    let reg = clients::register(
        &pool,
        clients::RegisterRequest {
            name: "client".into(),
            redirect_uris: vec!["http://localhost/cb".into()],
            client_type: ClientType::Public,
            registration_kind: RegistrationKind::Dcr,
            owner_user_id: None,
        },
    )
    .await
    .unwrap();

    let t1 = tokens::mint(
        &pool,
        tokens::MintRequest {
            client_id: reg.client.id,
            user_id: user,
            scope: Scope::mcp(),
            kind: AccessTokenKind::Access,
            name: String::new(),
        },
    )
    .await
    .unwrap();
    let t2 = tokens::mint(
        &pool,
        tokens::MintRequest {
            client_id: reg.client.id,
            user_id: user,
            scope: Scope::mcp(),
            kind: AccessTokenKind::Access,
            name: String::new(),
        },
    )
    .await
    .unwrap();

    let killed = tokens::revoke_for_client(&pool, user, reg.client.id)
        .await
        .unwrap();
    assert_eq!(killed, 2, "both tokens revoked in one call");

    for raw in [&t1.raw, &t2.raw] {
        assert!(matches!(
            tokens::resolve(&pool, raw).await,
            Err(OAuthError::InvalidGrant)
        ));
    }
}

#[tokio::test]
async fn revoke_only_affects_owner() {
    let (_dir, pool) = fresh_pool().await;
    let alice = seed_user(&pool).await;
    let bob = seed_user(&pool).await;
    let reg = clients::register(
        &pool,
        clients::RegisterRequest {
            name: "client".into(),
            redirect_uris: vec!["http://localhost/cb".into()],
            client_type: ClientType::Public,
            registration_kind: RegistrationKind::Dcr,
            owner_user_id: None,
        },
    )
    .await
    .unwrap();

    let t = tokens::mint(
        &pool,
        tokens::MintRequest {
            client_id: reg.client.id,
            user_id: alice,
            scope: Scope::mcp(),
            kind: AccessTokenKind::Pat,
            name: "alice-laptop".into(),
        },
    )
    .await
    .unwrap();

    // Bob cannot revoke Alice's token.
    assert!(!tokens::revoke(&pool, bob, t.id).await.unwrap());
    tokens::resolve(&pool, &t.raw).await.expect("still resolves");
}
