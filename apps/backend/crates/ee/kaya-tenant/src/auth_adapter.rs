// Copyright 2024 Kaya Suites. All rights reserved. — BSL 1.1
//!
//! axum-login backend and `CloudAuthAdapter`.
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
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::error::AuthError;

// ── AuthUser ──────────────────────────────────────────────────────────────────

/// The authenticated user stored in the tower-sessions session store.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthUser {
    pub id: Uuid,
    pub email: String,
    pub username: Option<String>,
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
/// `authenticate` is the credential-based path (email + password → user).
/// `get_user` is the session-restore path (user_id → user, called on every request).
#[derive(Clone)]
pub struct KayaAuthBackend {
    pool: PgPool,
}

impl KayaAuthBackend {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

/// Credentials used when logging in with email and password.
#[derive(Debug, Clone, Deserialize)]
pub struct PasswordCredentials {
    pub email: String,
    pub password: String,
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
        let row = sqlx::query(
            "SELECT id, email, username, password_hash FROM users WHERE email = $1",
        )
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
            id: row.try_get("id").unwrap(),
            email: row.try_get("email").unwrap(),
            username: row.try_get("username").unwrap_or(None),
        }))
    }

    async fn get_user(
        &self,
        user_id: &axum_login::UserId<Self>,
    ) -> Result<Option<Self::User>, Self::Error> {
        let row = sqlx::query(
            "SELECT id, email, username FROM users WHERE id = $1",
        )
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|r| AuthUser {
            id: r.try_get("id").unwrap(),
            email: r.try_get("email").unwrap(),
            username: r.try_get("username").unwrap_or(None),
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
        Ok(self.session.user.as_ref().map(|u| UserSession { user_id: u.id }))
    }

    async fn require_auth(&self) -> Result<UserSession, KayaError> {
        self.current_user()
            .await?
            .ok_or(KayaError::Unauthenticated)
    }
}
