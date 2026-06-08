// Copyright 2024 Kaya Suites. Licensed under the Apache License, Version 2.0.
//! OAuth 2.1 authorization-server primitives for Kaya Suites.
//!
//! Pure logic — no HTTP layer. Backend routes (in `kaya-server::routes::oauth`)
//! call into the modules here.
//!
//! # Module map
//!
//! - [`crypto`] — PKCE, secret hashing, opaque-token generation.
//! - [`model`]  — domain types (`Client`, `AccessToken`, `AuthorizationCode`,
//!   scopes, errors).
//! - [`clients`] — `oauth_clients` CRUD.
//! - [`codes`]   — `oauth_authorization_codes` mint + one-shot consume.
//! - [`tokens`]  — `oauth_access_tokens` mint + resolve + revoke + list.

pub mod clients;
pub mod codes;
pub mod crypto;
pub mod model;
pub mod tokens;

pub use model::{
    AccessToken, AccessTokenKind, AuthorizationCode, Client, ClientType, OAuthError,
    PkceMethod, RegistrationKind, Scope,
};
