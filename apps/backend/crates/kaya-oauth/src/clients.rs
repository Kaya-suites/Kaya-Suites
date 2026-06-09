// Copyright 2024 Kaya Suites. Licensed under the Apache License, Version 2.0.
//! `oauth_clients` CRUD.

use chrono::Utc;
use sqlx::AnyPool;
use uuid::Uuid;

use crate::crypto::{
    generate_client_secret, generate_registration_access_token, hash_secret, hash_token,
    verify_secret,
};
use crate::model::{Client, ClientType, OAuthError, RegistrationKind};

/// What a caller wants to register.
pub struct RegisterRequest {
    pub name: String,
    pub redirect_uris: Vec<String>,
    pub client_type: ClientType,
    pub registration_kind: RegistrationKind,
    pub owner_user_id: Option<Uuid>,
}

/// What's handed back to the caller exactly once.
pub struct RegisteredClient {
    pub client: Client,
    /// `Some` for confidential clients; `None` for public (PKCE-only).
    pub client_secret: Option<String>,
    /// `Some` for DCR; `None` for manual.
    pub registration_access_token: Option<String>,
}

pub async fn register(
    pool: &AnyPool,
    req: RegisterRequest,
) -> Result<RegisteredClient, OAuthError> {
    if req.name.trim().is_empty() {
        return Err(OAuthError::InvalidRequest);
    }
    if req.redirect_uris.is_empty() {
        return Err(OAuthError::InvalidRequest);
    }

    let id = Uuid::new_v4();
    let now = Utc::now().timestamp_millis();

    let (secret_hash, raw_secret) = match req.client_type {
        ClientType::Confidential => {
            let raw = generate_client_secret();
            (Some(hash_secret(&raw)?), Some(raw))
        }
        ClientType::Public => (None, None),
    };

    let (rat_hash, raw_rat) = match req.registration_kind {
        RegistrationKind::Dcr => {
            let raw = generate_registration_access_token();
            (Some(hash_token(&raw)), Some(raw))
        }
        RegistrationKind::Manual => (None, None),
    };

    let redirect_uris_json =
        serde_json::to_string(&req.redirect_uris).map_err(|e| OAuthError::Server(e.to_string()))?;

    sqlx::query(
        "INSERT INTO oauth_clients \
         (id, name, secret_hash, redirect_uris, client_type, registration_kind, \
          owner_user_id, registration_access_token_hash, created_at, updated_at) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
    )
    .bind(id.to_string())
    .bind(&req.name)
    .bind(&secret_hash)
    .bind(&redirect_uris_json)
    .bind(req.client_type.as_str())
    .bind(req.registration_kind.as_str())
    .bind(req.owner_user_id.map(|u| u.to_string()))
    .bind(&rat_hash)
    .bind(now)
    .bind(now)
    .execute(pool)
    .await?;

    Ok(RegisteredClient {
        client: Client {
            id,
            name: req.name,
            secret_hash,
            redirect_uris: req.redirect_uris,
            client_type: req.client_type,
            registration_kind: req.registration_kind,
            owner_user_id: req.owner_user_id,
            registration_access_token_hash: rat_hash,
            created_at: now,
            updated_at: now,
        },
        client_secret: raw_secret,
        registration_access_token: raw_rat,
    })
}

pub async fn get(pool: &AnyPool, id: Uuid) -> Result<Option<Client>, OAuthError> {
    let row: Option<(
        String,
        String,
        Option<String>,
        String,
        String,
        String,
        Option<String>,
        Option<String>,
        i64,
        i64,
    )> = sqlx::query_as(
        "SELECT id, name, secret_hash, redirect_uris, client_type, registration_kind, \
                owner_user_id, registration_access_token_hash, created_at, updated_at \
         FROM oauth_clients WHERE id = ?",
    )
    .bind(id.to_string())
    .fetch_optional(pool)
    .await?;
    row.map(decode_client).transpose()
}

pub async fn list_by_kind(
    pool: &AnyPool,
    kind: RegistrationKind,
) -> Result<Vec<Client>, OAuthError> {
    let rows: Vec<(
        String,
        String,
        Option<String>,
        String,
        String,
        String,
        Option<String>,
        Option<String>,
        i64,
        i64,
    )> = sqlx::query_as(
        "SELECT id, name, secret_hash, redirect_uris, client_type, registration_kind, \
                owner_user_id, registration_access_token_hash, created_at, updated_at \
         FROM oauth_clients WHERE registration_kind = ? ORDER BY created_at DESC",
    )
    .bind(kind.as_str())
    .fetch_all(pool)
    .await?;
    rows.into_iter().map(decode_client).collect()
}

pub async fn list_for_owner(
    pool: &AnyPool,
    owner: Uuid,
) -> Result<Vec<Client>, OAuthError> {
    let rows: Vec<(
        String,
        String,
        Option<String>,
        String,
        String,
        String,
        Option<String>,
        Option<String>,
        i64,
        i64,
    )> = sqlx::query_as(
        "SELECT id, name, secret_hash, redirect_uris, client_type, registration_kind, \
                owner_user_id, registration_access_token_hash, created_at, updated_at \
         FROM oauth_clients WHERE owner_user_id = ? ORDER BY created_at DESC",
    )
    .bind(owner.to_string())
    .fetch_all(pool)
    .await?;
    rows.into_iter().map(decode_client).collect()
}

pub async fn delete(pool: &AnyPool, id: Uuid) -> Result<bool, OAuthError> {
    let r = sqlx::query("DELETE FROM oauth_clients WHERE id = $1")
        .bind(id.to_string())
        .execute(pool)
        .await?;
    Ok(r.rows_affected() > 0)
}

/// Singleton client used to own Personal Access Tokens minted from the
/// Settings page. PATs do not go through the OAuth code flow, so this client's
/// `redirect_uris` is a placeholder and is never actually dereferenced.
pub const PAT_CLIENT_ID: uuid::Uuid =
    uuid::uuid!("00000000-0000-0000-0000-0000000a7100");

/// Look up (or lazily create) the synthetic PAT client. Idempotent.
pub async fn ensure_pat_client(pool: &AnyPool) -> Result<Client, OAuthError> {
    if let Some(c) = get(pool, PAT_CLIENT_ID).await? {
        return Ok(c);
    }
    let now = chrono::Utc::now().timestamp_millis();
    let redirect_uris_json = serde_json::to_string(&vec!["urn:kaya:pat".to_string()])
        .map_err(|e| OAuthError::Server(e.to_string()))?;
    sqlx::query(
        "INSERT INTO oauth_clients \
         (id, name, secret_hash, redirect_uris, client_type, registration_kind, \
          owner_user_id, registration_access_token_hash, created_at, updated_at) \
         VALUES ($1, $2, NULL, $3, $4, $5, NULL, NULL, $6, $7)",
    )
    .bind(PAT_CLIENT_ID.to_string())
    .bind("Personal access tokens")
    .bind(&redirect_uris_json)
    .bind(ClientType::Public.as_str())
    .bind(RegistrationKind::Manual.as_str())
    .bind(now)
    .bind(now)
    .execute(pool)
    .await?;
    Ok(Client {
        id: PAT_CLIENT_ID,
        name: "Personal access tokens".into(),
        secret_hash: None,
        redirect_uris: vec!["urn:kaya:pat".into()],
        client_type: ClientType::Public,
        registration_kind: RegistrationKind::Manual,
        owner_user_id: None,
        registration_access_token_hash: None,
        created_at: now,
        updated_at: now,
    })
}

/// Authenticate a client by id + secret (confidential) or id alone (public).
///
/// Returns the `Client` on success, `InvalidClient` otherwise.
pub async fn authenticate(
    pool: &AnyPool,
    client_id: Uuid,
    client_secret: Option<&str>,
) -> Result<Client, OAuthError> {
    let client = get(pool, client_id).await?.ok_or(OAuthError::InvalidClient)?;

    match (client.client_type, &client.secret_hash, client_secret) {
        (ClientType::Public, _, _) => Ok(client),
        (ClientType::Confidential, Some(hash), Some(raw)) => {
            if verify_secret(raw, hash) {
                Ok(client)
            } else {
                Err(OAuthError::InvalidClient)
            }
        }
        _ => Err(OAuthError::InvalidClient),
    }
}

#[allow(clippy::type_complexity)]
fn decode_client(
    (
        id,
        name,
        secret_hash,
        redirect_uris,
        client_type,
        registration_kind,
        owner_user_id,
        registration_access_token_hash,
        created_at,
        updated_at,
    ): (
        String,
        String,
        Option<String>,
        String,
        String,
        String,
        Option<String>,
        Option<String>,
        i64,
        i64,
    ),
) -> Result<Client, OAuthError> {
    let id = Uuid::parse_str(&id).map_err(|e| OAuthError::Server(e.to_string()))?;
    let redirect_uris: Vec<String> =
        serde_json::from_str(&redirect_uris).map_err(|e| OAuthError::Server(e.to_string()))?;
    let owner_user_id = owner_user_id
        .as_deref()
        .map(Uuid::parse_str)
        .transpose()
        .map_err(|e| OAuthError::Server(e.to_string()))?;
    Ok(Client {
        id,
        name,
        secret_hash,
        redirect_uris,
        client_type: ClientType::parse(&client_type)?,
        registration_kind: RegistrationKind::parse(&registration_kind)?,
        owner_user_id,
        registration_access_token_hash,
        created_at,
        updated_at,
    })
}
