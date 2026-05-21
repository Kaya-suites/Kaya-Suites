// Copyright 2024 Kaya Suites. Licensed under the Apache License, Version 2.0.
//!
//! Password registration for Kaya Suites — uses AnyPool for all three backends.

use argon2::{
    Argon2, PasswordHasher,
    password_hash::{SaltString, rand_core::OsRng},
};
use sqlx::AnyPool;
use uuid::Uuid;

use crate::auth_adapter::AuthUser;
use crate::error::RegisterError;

/// Error returned when superadmin seeding fails.
#[derive(Debug, thiserror::Error)]
pub enum SeedError {
    #[error("password hashing failed: {0}")]
    PasswordHash(String),
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
}

/// Service for registering new users with a hashed password.
#[derive(Clone)]
pub struct PasswordAuthService {
    pool: AnyPool,
}

impl PasswordAuthService {
    pub fn new(pool: AnyPool) -> Self {
        Self { pool }
    }

    /// Create a new user record with a hashed password.
    ///
    /// Returns the created `AuthUser` on success. Fails with
    /// `RegisterError::EmailAlreadyExists` or `RegisterError::UsernameTaken`
    /// if the unique constraints are violated.
    pub async fn register(
        &self,
        email: &str,
        username: Option<&str>,
        password: &str,
    ) -> Result<AuthUser, RegisterError> {
        let salt = SaltString::generate(&mut OsRng);
        let hash = Argon2::default()
            .hash_password(password.as_bytes(), &salt)
            .map_err(|e| RegisterError::PasswordHash(e.to_string()))?
            .to_string();

        // Check if email already exists
        let email_count: i64 = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM users WHERE email = ?",
        )
        .bind(email)
        .fetch_one(&self.pool)
        .await
        .unwrap_or(0);
        if email_count > 0 {
            return Err(RegisterError::EmailAlreadyExists);
        }

        // Check if username already exists
        if let Some(uname) = username {
            let uname_count: i64 = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM users WHERE username = ?",
            )
            .bind(uname)
            .fetch_one(&self.pool)
            .await
            .unwrap_or(0);
            if uname_count > 0 {
                return Err(RegisterError::UsernameTaken);
            }
        }

        let id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO users (id, email, username, password_hash) VALUES (?, ?, ?, ?)",
        )
        .bind(id.to_string())
        .bind(email)
        .bind(username)
        .bind(&hash)
        .execute(&self.pool)
        .await
        .map_err(RegisterError::Database)?;

        Ok(AuthUser {
            id,
            email: email.to_string(),
            username: username.map(|s| s.to_string()),
            is_superadmin: false,
        })
    }

    /// Seed the built-in superadmin account if it does not already exist.
    ///
    /// Idempotent — safe to call on every startup.
    pub async fn seed_superadmin(
        &self,
        email: &str,
        username: &str,
        password: &str,
    ) -> Result<(), SeedError> {
        let exists: i64 = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM users WHERE username = ?",
        )
        .bind(username)
        .fetch_one(&self.pool)
        .await
        .unwrap_or(0);

        if exists > 0 {
            return Ok(());
        }

        let salt = SaltString::generate(&mut OsRng);
        let hash = Argon2::default()
            .hash_password(password.as_bytes(), &salt)
            .map_err(|e| SeedError::PasswordHash(e.to_string()))?
            .to_string();

        let id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO users (id, email, username, password_hash, is_superadmin) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(id.to_string())
        .bind(email)
        .bind(username)
        .bind(&hash)
        .bind(true)
        .execute(&self.pool)
        .await?;

        tracing::info!(username, "superadmin account seeded");
        Ok(())
    }
}
