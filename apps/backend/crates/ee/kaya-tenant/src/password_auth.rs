// Copyright 2024 Kaya Suites. All rights reserved. — BSL 1.1
//!
//! Password registration for Kaya Suites cloud.

use argon2::{
    Argon2, PasswordHasher,
    password_hash::{SaltString, rand_core::OsRng},
};
use sqlx::{PgPool, Row};

use crate::auth_adapter::AuthUser;
use crate::error::RegisterError;

/// Service for registering new users with a hashed password.
#[derive(Clone)]
pub struct PasswordAuthService {
    pool: PgPool,
}

impl PasswordAuthService {
    pub fn new(pool: PgPool) -> Self {
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

        let row = sqlx::query(
            "INSERT INTO users (email, username, password_hash)
             VALUES ($1, $2, $3)
             RETURNING id, email, username",
        )
        .bind(email)
        .bind(username)
        .bind(&hash)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| {
            if let sqlx::Error::Database(ref db_err) = e {
                match db_err.constraint() {
                    Some("users_email_key") => return RegisterError::EmailAlreadyExists,
                    Some("users_username_key") => return RegisterError::UsernameTaken,
                    _ => {}
                }
            }
            RegisterError::Database(e)
        })?;

        Ok(AuthUser {
            id: row.try_get("id").unwrap(),
            email: row.try_get("email").unwrap(),
            username: row.try_get("username").unwrap_or(None),
        })
    }
}
