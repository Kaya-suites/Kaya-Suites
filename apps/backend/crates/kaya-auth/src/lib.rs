// Copyright 2024 Kaya Suites. Licensed under the Apache License, Version 2.0.
//!
//! Password-based authentication for Kaya Suites.
//!
//! # Crate layout
//!
//! - [`password_auth`] — user registration with argon2 password hashing.
//! - [`auth_adapter`] — axum-login backend + `CloudAuthAdapter`.
//! - [`error`] — `RegisterError` and `AuthError`.
//!
//! Uses `AnyPool` so it works with Postgres, SQLite, and MySQL at runtime.
//!
//! [`UserContext`] has moved to `kaya_core::UserContext`.

pub mod auth_adapter;
pub mod error;
pub mod password_auth;

// ── Public re-exports ─────────────────────────────────────────────────────────

pub use auth_adapter::{AuthUser, CloudAuthAdapter, KayaAuthBackend, PasswordCredentials};
pub use error::{AuthError, RegisterError};
pub use password_auth::{Backend, PasswordAuthService, SeedError};

// ── Re-export session types used by callers ───────────────────────────────────

pub use axum_login::AuthSession;
pub use tower_sessions::{Expiry, SessionManagerLayer};
