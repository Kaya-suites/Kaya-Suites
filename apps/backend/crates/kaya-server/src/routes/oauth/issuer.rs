// Copyright 2024 Kaya Suites. Licensed under the Apache License, Version 2.0.
//! Publicly-visible base URL for the OAuth server, e.g. `https://kaya.example.com`.
//!
//! Set once at startup from `KAYA_PUBLIC_URL` (default `http://localhost:3001`)
//! and injected as an Extension into every route. Used to render absolute URLs
//! in discovery docs and the WWW-Authenticate header.

#[derive(Clone, Debug)]
pub struct OAuthIssuer(pub String);

impl OAuthIssuer {
    pub fn new(url: impl Into<String>) -> Self {
        Self(url.into().trim_end_matches('/').to_owned())
    }

    pub fn url(&self) -> &str {
        &self.0
    }

    pub fn join(&self, path: &str) -> String {
        format!("{}{}", self.0, path)
    }
}
