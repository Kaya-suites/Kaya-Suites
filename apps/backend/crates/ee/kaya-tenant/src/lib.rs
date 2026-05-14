// Copyright 2024 Kaya Suites. All rights reserved. — BSL 1.1
//!
//! Password-based authentication and multi-tenant context for Kaya Suites cloud.
//!
//! # Crate layout
//!
//! - [`UserContext`] — per-request tenant identifier used by `PostgresAdapter`.
//! - [`password_auth`] — user registration with argon2 password hashing.
//! - [`auth_adapter`] — axum-login backend + `CloudAuthAdapter`.
//! - [`error`] — `RegisterError` and `AuthError`.

use uuid::Uuid;

pub mod auth_adapter;
pub mod error;
pub mod password_auth;

// ── Public re-exports ─────────────────────────────────────────────────────────

pub use auth_adapter::{AuthUser, CloudAuthAdapter, KayaAuthBackend, PasswordCredentials};
pub use error::{AuthError, RegisterError};
pub use password_auth::PasswordAuthService;

// ── Re-export session types used by callers ───────────────────────────────────

pub use axum_login::AuthSession;
pub use tower_sessions::{Expiry, SessionManagerLayer};
pub use tower_sessions_sqlx_store::PostgresStore;

// ── UserContext ───────────────────────────────────────────────────────────────

/// Per-request tenant context passed into `PostgresAdapter`.
///
/// An instance without a pool-scoped `UserContext` cannot exist —
/// `PostgresAdapter::new` takes this by value, enforcing the
/// multi-tenancy seam described in CLAUDE.md NFR §6.3.
#[derive(Debug, Clone)]
pub struct UserContext {
    pub tenant_id: Uuid,
    pub user_id: Uuid,
}
