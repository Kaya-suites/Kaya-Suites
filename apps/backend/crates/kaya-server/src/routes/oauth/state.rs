// Copyright 2024 Kaya Suites. Licensed under the Apache License, Version 2.0.
//! In-memory store of pending authorize requests waiting on user consent.
//!
//! The flow:
//!   1. `GET /oauth/authorize` validates the request, calls [`ConsentRequestStore::insert`],
//!      and 302s the user to `/oauth/consent?req_id=<UUID>`.
//!   2. The consent UI calls `GET /oauth/consent/{req_id}` to render the screen.
//!   3. On allow, `POST /oauth/consent/{req_id}/decide` consumes the entry via
//!      [`ConsentRequestStore::take`] and mints the auth code.
//!
//! Entries expire after 15 minutes. There is no background cleanup task; the
//! check is lazy on lookup. Restarting the server invalidates all pending
//! consents — Claude Desktop just retries.

use std::collections::HashMap;
use std::sync::Arc;

use chrono::Utc;
use kaya_oauth::{PkceMethod, Scope};
use tokio::sync::Mutex;
use uuid::Uuid;

pub const CONSENT_TTL_SECS: i64 = 900;

#[derive(Debug, Clone)]
pub struct ConsentRequest {
    pub client_id: Uuid,
    pub redirect_uri: String,
    pub scope: Scope,
    /// The `state` query parameter — round-tripped to the redirect URL so the
    /// client can match it against its own CSRF state.
    pub state: Option<String>,
    pub code_challenge: String,
    pub code_challenge_method: PkceMethod,
    pub created_at: i64,
    pub expires_at: i64,
}

#[derive(Clone, Default)]
pub struct ConsentRequestStore {
    inner: Arc<Mutex<HashMap<Uuid, ConsentRequest>>>,
}

impl ConsentRequestStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn insert(&self, req: ConsentRequest) -> Uuid {
        let id = Uuid::new_v4();
        self.inner.lock().await.insert(id, req);
        id
    }

    /// Peek without consuming. Used by the consent UI to render details.
    pub async fn get(&self, id: Uuid) -> Option<ConsentRequest> {
        let now = Utc::now().timestamp_millis();
        let map = self.inner.lock().await;
        let entry = map.get(&id)?.clone();
        if entry.expires_at < now {
            return None;
        }
        Some(entry)
    }

    /// Remove and return — used at decision time.
    pub async fn take(&self, id: Uuid) -> Option<ConsentRequest> {
        let now = Utc::now().timestamp_millis();
        let entry = self.inner.lock().await.remove(&id)?;
        if entry.expires_at < now {
            return None;
        }
        Some(entry)
    }
}
