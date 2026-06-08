// Copyright 2024 Kaya Suites. Licensed under the Apache License, Version 2.0.
//!
//! axum-login backend and `CloudAuthAdapter`.
//!
//! Uses `AnyPool` so it works with Postgres, SQLite, and MySQL.
//!
//! # Type map
//!
//! ```text
//! AuthUser          — the value stored in the session cookie (implements axum_login::AuthUser)
//! KayaAuthBackend   — implements axum_login::AuthnBackend; mounted as a tower layer
//! CloudAuthAdapter  — per-request wrapper around AuthSession<KayaAuthBackend>;
//!                     implements kaya_core::AuthAdapter for the application layer
//! ```

use argon2::{Argon2, PasswordHash, PasswordVerifier};
use async_trait::async_trait;
use axum_login::{AuthSession, AuthUser as AxumAuthUser};
use kaya_core::{AuthAdapter, KayaError, UserSession};
use serde::{Deserialize, Serialize};
use sqlx::{AnyPool, Row};
use uuid::Uuid;

use crate::error::AuthError;
use crate::password_auth::Backend;

// ── AuthUser ──────────────────────────────────────────────────────────────────

/// The authenticated user stored in the tower-sessions session store.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthUser {
    pub id: Uuid,
    pub email: String,
    pub username: Option<String>,
    pub is_superadmin: bool,
}

impl AxumAuthUser for AuthUser {
    type Id = Uuid;

    fn id(&self) -> Self::Id {
        self.id
    }

    /// Changing a user's email invalidates all existing sessions automatically.
    fn session_auth_hash(&self) -> &[u8] {
        self.email.as_bytes()
    }
}

// ── KayaAuthBackend ───────────────────────────────────────────────────────────

/// axum-login backend wired into the tower layer stack.
///
/// Uses `AnyPool` for database-agnostic operation (Postgres, SQLite, MySQL).
#[derive(Clone)]
pub struct KayaAuthBackend {
    pool: AnyPool,
    backend: Backend,
}

impl KayaAuthBackend {
    pub fn new(pool: AnyPool, backend: Backend) -> Self {
        Self { pool, backend }
    }
}

/// Credentials used when logging in with email and password.
#[derive(Debug, Clone, Deserialize)]
pub struct PasswordCredentials {
    pub email: String,
    pub password: String,
}

/// Decode a bool column that may be stored as BOOLEAN, INTEGER (SQLite), or TINYINT (MySQL).
fn decode_bool(row: &sqlx::any::AnyRow, col: &str) -> bool {
    row.try_get::<bool, _>(col)
        .or_else(|_| row.try_get::<i64, _>(col).map(|n| n != 0))
        .or_else(|_| row.try_get::<i32, _>(col).map(|n| n != 0))
        .unwrap_or(false)
}

/// Decode a UUID column stored as VARCHAR(36) / TEXT.
fn decode_uuid(row: &sqlx::any::AnyRow, col: &str) -> Uuid {
    row.try_get::<String, _>(col)
        .ok()
        .and_then(|s| Uuid::parse_str(&s).ok())
        .unwrap_or_default()
}

#[async_trait]
impl axum_login::AuthnBackend for KayaAuthBackend {
    type User = AuthUser;
    type Credentials = PasswordCredentials;
    type Error = AuthError;

    async fn authenticate(
        &self,
        creds: Self::Credentials,
    ) -> Result<Option<Self::User>, Self::Error> {
        let row = sqlx::query(&self.backend.prepare(
            "SELECT id, email, username, password_hash, is_superadmin FROM users WHERE email = ?",
        ))
        .bind(&creds.email)
        .fetch_optional(&self.pool)
        .await?;

        let Some(row) = row else {
            return Ok(None);
        };

        let hash: Option<String> = row.try_get("password_hash").unwrap_or(None);
        let Some(hash) = hash else {
            return Ok(None);
        };

        let parsed =
            PasswordHash::new(&hash).map_err(|e| AuthError::PasswordHash(e.to_string()))?;

        if Argon2::default()
            .verify_password(creds.password.as_bytes(), &parsed)
            .is_err()
        {
            return Ok(None);
        }

        Ok(Some(AuthUser {
            id: decode_uuid(&row, "id"),
            email: row.try_get("email").unwrap_or_default(),
            username: row.try_get("username").unwrap_or(None),
            is_superadmin: decode_bool(&row, "is_superadmin"),
        }))
    }

    async fn get_user(
        &self,
        user_id: &axum_login::UserId<Self>,
    ) -> Result<Option<Self::User>, Self::Error> {
        let row = sqlx::query(
            &self.backend.prepare("SELECT id, email, username, is_superadmin FROM users WHERE id = ?"),
        )
        .bind(user_id.to_string())
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|r| AuthUser {
            id: decode_uuid(&r, "id"),
            email: r.try_get("email").unwrap_or_default(),
            username: r.try_get("username").unwrap_or(None),
            is_superadmin: decode_bool(&r, "is_superadmin"),
        }))
    }
}

// ── CloudAuthAdapter ──────────────────────────────────────────────────────────

/// Per-request wrapper around `AuthSession<KayaAuthBackend>` that implements
/// the `kaya_core::AuthAdapter` trait consumed by business-logic handlers.
pub struct CloudAuthAdapter {
    session: AuthSession<KayaAuthBackend>,
}

impl CloudAuthAdapter {
    pub fn new(session: AuthSession<KayaAuthBackend>) -> Self {
        Self { session }
    }
}

#[async_trait]
impl AuthAdapter for CloudAuthAdapter {
    async fn current_user(&self) -> Result<Option<UserSession>, KayaError> {
        Ok(self
            .session
            .user
            .as_ref()
            .map(|u| UserSession { user_id: u.id }))
    }

    async fn require_auth(&self) -> Result<UserSession, KayaError> {
        self.current_user().await?.ok_or(KayaError::Unauthenticated)
    }
}
