// Copyright 2024 Kaya Suites. Licensed under the Apache License, Version 2.0.
//! PKCE verification, secret hashing, opaque-token generation.

use argon2::{
    Argon2,
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString, rand_core::OsRng},
};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use rand::RngCore;
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

use crate::model::{OAuthError, PkceMethod};

// ── Opaque-token generation ─────────────────────────────────────────────────

fn random_bytes(n: usize) -> Vec<u8> {
    let mut buf = vec![0u8; n];
    rand::rng().fill_bytes(&mut buf);
    buf
}

/// `kaya_oat_<48 hex chars>` — an OAuth access token (or PAT).
pub fn generate_access_token() -> String {
    format!("kaya_oat_{}", hex::encode(random_bytes(24)))
}

/// `kaya_oac_<32 hex chars>` — an authorization code.
pub fn generate_authorization_code() -> String {
    format!("kaya_oac_{}", hex::encode(random_bytes(16)))
}

/// `kaya_rat_<48 hex chars>` — a DCR registration-access-token.
pub fn generate_registration_access_token() -> String {
    format!("kaya_rat_{}", hex::encode(random_bytes(24)))
}

/// `kaya_sec_<48 hex chars>` — a client secret (raw form, shown once).
pub fn generate_client_secret() -> String {
    format!("kaya_sec_{}", hex::encode(random_bytes(24)))
}

// ── Hashing ─────────────────────────────────────────────────────────────────

/// SHA-256 of an opaque token, hex-encoded. Used for everything except client
/// secrets — fast lookups in indexed columns.
pub fn hash_token(raw: &str) -> String {
    let mut h = Sha256::new();
    h.update(raw.as_bytes());
    hex::encode(h.finalize())
}

/// Argon2id hash of a client secret. We use argon2 (slower) here because the
/// `/oauth/token` endpoint is a credential-checking surface — brute-force
/// resistance matters even though the secret is high-entropy.
pub fn hash_secret(raw: &str) -> Result<String, OAuthError> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(raw.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| OAuthError::Server(format!("argon2 hash: {e}")))
}

/// Constant-time check of a raw client secret against the stored argon2 hash.
pub fn verify_secret(raw: &str, hash: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(hash) else {
        return false;
    };
    Argon2::default()
        .verify_password(raw.as_bytes(), &parsed)
        .is_ok()
}

// ── PKCE ────────────────────────────────────────────────────────────────────

/// Verify a PKCE `code_verifier` against a stored `code_challenge`.
///
/// We accept only `S256`. `plain` is forbidden by OAuth 2.1.
pub fn verify_pkce(
    method: PkceMethod,
    verifier: &str,
    challenge: &str,
) -> Result<(), OAuthError> {
    // Per RFC 7636 §4.1: verifier must be 43–128 chars from the unreserved set.
    if verifier.len() < 43
        || verifier.len() > 128
        || !verifier
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~'))
    {
        return Err(OAuthError::InvalidGrant);
    }

    match method {
        PkceMethod::S256 => {
            let mut h = Sha256::new();
            h.update(verifier.as_bytes());
            let digest = h.finalize();
            let computed = URL_SAFE_NO_PAD.encode(digest);

            // Constant-time compare so a malicious client can't binary-search
            // the challenge by timing.
            let a = computed.as_bytes();
            let b = challenge.as_bytes();
            if a.len() != b.len() || a.ct_eq(b).unwrap_u8() == 0 {
                return Err(OAuthError::InvalidGrant);
            }
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_s256_roundtrip() {
        // 43-char verifier, generated once.
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        let mut h = Sha256::new();
        h.update(verifier.as_bytes());
        let challenge = URL_SAFE_NO_PAD.encode(h.finalize());

        verify_pkce(PkceMethod::S256, verifier, &challenge).expect("ok");

        // Wrong challenge → InvalidGrant.
        let bad = format!("{}A", &challenge[..challenge.len() - 1]);
        assert!(matches!(
            verify_pkce(PkceMethod::S256, verifier, &bad),
            Err(OAuthError::InvalidGrant)
        ));
    }

    #[test]
    fn pkce_rejects_short_verifier() {
        let too_short = "short";
        assert!(matches!(
            verify_pkce(PkceMethod::S256, too_short, "anything"),
            Err(OAuthError::InvalidGrant)
        ));
    }

    #[test]
    fn pkce_rejects_invalid_chars() {
        // Has a space — not in the allowed unreserved set.
        let bad = "dBjftJeZ4CVP mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        assert!(matches!(
            verify_pkce(PkceMethod::S256, bad, "anything"),
            Err(OAuthError::InvalidGrant)
        ));
    }

    #[test]
    fn secret_hash_verifies() {
        let raw = generate_client_secret();
        let h = hash_secret(&raw).expect("hash");
        assert!(verify_secret(&raw, &h));
        assert!(!verify_secret("not-the-secret", &h));
    }

    #[test]
    fn token_hash_is_stable() {
        let t = generate_access_token();
        assert_eq!(hash_token(&t), hash_token(&t));
        assert_ne!(hash_token(&t), hash_token("kaya_oat_other"));
    }
}
