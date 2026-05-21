// Copyright 2024 Kaya Suites. Licensed under the Apache License, Version 2.0.
//!
//! Password-based authentication and multi-tenant context for Kaya Suites.
//!
//! # Crate layout
//!
//! - [`UserContext`] — per-request tenant identifier used by `PostgresAdapter`.
//! - [`password_auth`] — user registration with argon2 password hashing.
//! - [`auth_adapter`] — axum-login backend + `CloudAuthAdapter`.
//! - [`error`] — `RegisterError` and `AuthError`.
//!
//! Uses `AnyPool` so it works with Postgres, SQLite, and MySQL at runtime.

use uuid::Uuid;

pub mod auth_adapter;
pub mod error;
pub mod password_auth;

// ── Public re-exports ─────────────────────────────────────────────────────────

pub use auth_adapter::{AuthUser, CloudAuthAdapter, KayaAuthBackend, PasswordCredentials};
pub use error::{AuthError, RegisterError};
pub use password_auth::{PasswordAuthService, SeedError};

// ── Re-export session types used by callers ───────────────────────────────────

pub use axum_login::AuthSession;
pub use tower_sessions::{Expiry, SessionManagerLayer};
// Note: PostgresStore is no longer re-exported here; import from
// tower_sessions_sqlx_store directly in the binary.

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
