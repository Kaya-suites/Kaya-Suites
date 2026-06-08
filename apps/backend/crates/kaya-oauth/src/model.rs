// Copyright 2024 Kaya Suites. Licensed under the Apache License, Version 2.0.
//! Domain types for the OAuth server.

use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

// ── Scopes ──────────────────────────────────────────────────────────────────

/// The set of granted scopes.
///
/// Per the design lock: a single `mcp` scope covers all read + propose +
/// commit MCP tools. This type is an opaque wrapper so we can introduce a
/// split (`mcp.read` / `mcp.write`) later without churn at the call sites.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Scope(String);

impl Scope {
    pub const MCP: &'static str = "mcp";

    pub fn mcp() -> Self {
        Self(Self::MCP.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Parse a space-separated scope string. Unknown scopes are rejected.
    pub fn parse(raw: &str) -> Result<Self, OAuthError> {
        let mut tokens = raw.split_whitespace().collect::<Vec<_>>();
        tokens.sort();
        tokens.dedup();
        if tokens.iter().any(|t| *t != Self::MCP) {
            return Err(OAuthError::InvalidScope);
        }
        Ok(Self::mcp())
    }
}

// ── Client ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ClientType {
    /// Has a secret. Used by server-side clients (rare for MCP).
    Confidential,
    /// No secret. Used by native apps / CLIs that can't keep one (PKCE-only).
    Public,
}

impl ClientType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Confidential => "confidential",
            Self::Public => "public",
        }
    }

    pub fn parse(s: &str) -> Result<Self, OAuthError> {
        match s {
            "confidential" => Ok(Self::Confidential),
            "public" => Ok(Self::Public),
            _ => Err(OAuthError::InvalidRequest),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RegistrationKind {
    /// Created via the `POST /oauth/register` DCR endpoint.
    Dcr,
    /// Created by a Kaya admin from the Connected-apps page.
    Manual,
}

impl RegistrationKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Dcr => "dcr",
            Self::Manual => "manual",
        }
    }

    pub fn parse(s: &str) -> Result<Self, OAuthError> {
        match s {
            "dcr" => Ok(Self::Dcr),
            "manual" => Ok(Self::Manual),
            _ => Err(OAuthError::InvalidRequest),
        }
    }
}

#[derive(Debug, Clone)]
pub struct Client {
    pub id: Uuid,
    pub name: String,
    /// Argon2 hash of the secret. `None` for public clients.
    pub secret_hash: Option<String>,
    pub redirect_uris: Vec<String>,
    pub client_type: ClientType,
    pub registration_kind: RegistrationKind,
    /// Set only for `Manual` clients — the admin who created them.
    pub owner_user_id: Option<Uuid>,
    /// SHA-256 of the registration-access-token issued to a DCR client so it
    /// can later update/delete its own registration. `None` for manual clients.
    pub registration_access_token_hash: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl Client {
    /// Returns true if this `redirect_uri` matches one of the registered URIs
    /// (exact-match per OAuth 2.1 §3.1.2).
    pub fn matches_redirect(&self, candidate: &str) -> bool {
        self.redirect_uris.iter().any(|u| u == candidate)
    }
}

// ── Authorization code ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum PkceMethod {
    /// SHA-256(code_verifier) base64url-encoded — the only method we accept.
    S256,
}

impl PkceMethod {
    pub fn as_str(&self) -> &'static str {
        "S256"
    }

    pub fn parse(s: &str) -> Result<Self, OAuthError> {
        match s {
            "S256" => Ok(Self::S256),
            _ => Err(OAuthError::InvalidRequest),
        }
    }
}

#[derive(Debug, Clone)]
pub struct AuthorizationCode {
    pub client_id: Uuid,
    pub user_id: Uuid,
    pub redirect_uri: String,
    pub scope: Scope,
    pub code_challenge: String,
    pub code_challenge_method: PkceMethod,
    pub expires_at: i64,
    pub consumed_at: Option<i64>,
}

// ── Access token ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AccessTokenKind {
    /// Issued by the auth-code flow to a registered OAuth client.
    Access,
    /// Long-lived "personal access token" minted by a user from Settings,
    /// owned by the synthetic `kaya-pat` client. Functionally identical to
    /// `Access`, kept separate so the UI can group them.
    Pat,
}

impl AccessTokenKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Access => "access",
            Self::Pat => "pat",
        }
    }

    pub fn parse(s: &str) -> Result<Self, OAuthError> {
        match s {
            "access" => Ok(Self::Access),
            "pat" => Ok(Self::Pat),
            _ => Err(OAuthError::InvalidRequest),
        }
    }
}

#[derive(Debug, Clone)]
pub struct AccessToken {
    pub id: Uuid,
    pub client_id: Uuid,
    pub user_id: Uuid,
    pub scope: Scope,
    pub kind: AccessTokenKind,
    /// User-supplied label (PATs only; empty for OAuth-issued tokens).
    pub name: String,
    pub created_at: i64,
    pub last_used_at: Option<i64>,
    pub revoked_at: Option<i64>,
}

impl AccessToken {
    pub fn is_active(&self) -> bool {
        self.revoked_at.is_none()
    }
}

// ── Errors ──────────────────────────────────────────────────────────────────

#[derive(Debug, Error)]
pub enum OAuthError {
    #[error("invalid_request")]
    InvalidRequest,
    #[error("invalid_client")]
    InvalidClient,
    #[error("invalid_grant")]
    InvalidGrant,
    #[error("invalid_scope")]
    InvalidScope,
    #[error("unauthorized_client")]
    UnauthorizedClient,
    #[error("access_denied")]
    AccessDenied,
    #[error("unsupported_grant_type")]
    UnsupportedGrantType,
    #[error("server_error: {0}")]
    Server(String),
    #[error(transparent)]
    Db(#[from] sqlx::Error),
}

impl OAuthError {
    /// Stable error code string for `{"error": ...}` JSON responses.
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidRequest => "invalid_request",
            Self::InvalidClient => "invalid_client",
            Self::InvalidGrant => "invalid_grant",
            Self::InvalidScope => "invalid_scope",
            Self::UnauthorizedClient => "unauthorized_client",
            Self::AccessDenied => "access_denied",
            Self::UnsupportedGrantType => "unsupported_grant_type",
            Self::Server(_) | Self::Db(_) => "server_error",
        }
    }
}
