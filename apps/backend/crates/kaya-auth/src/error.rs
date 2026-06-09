// Copyright 2024 Kaya Suites. Licensed under the Apache License, Version 2.0.

/// Errors that can occur when registering a new user.
#[derive(Debug, thiserror::Error)]
pub enum RegisterError {
    #[error("an account with that email already exists")]
    EmailAlreadyExists,

    #[error("that username is already taken")]
    UsernameTaken,

    #[error("password is too weak: {0}")]
    WeakPassword(&'static str),

    #[error("password hashing failed: {0}")]
    PasswordHash(String),

    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
}

/// Errors surfaced by the axum-login auth backend.
#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    #[error("password hash error: {0}")]
    PasswordHash(String),

    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
}
