// Copyright 2024 Kaya Suites. Licensed under the Apache License, Version 2.0.
//! In-memory store for `ProposedEdit` awaiting Claude's confirmation.
//!
//! Each MCP server instance (stdio binary OR `/mcp` HTTP route) keeps its own
//! map. Pending edits do not survive process restart — Claude is expected to
//! `propose_* → preview → commit` within one chat session.

use std::collections::HashMap;
use std::sync::Arc;

use kaya_core::ProposedEdit;
use tokio::sync::Mutex;
use uuid::Uuid;

#[derive(Clone, Default)]
pub struct PendingEditStore {
    inner: Arc<Mutex<HashMap<Uuid, ProposedEdit>>>,
}

impl PendingEditStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn insert(&self, edit: ProposedEdit) -> Uuid {
        let id = edit.id;
        self.inner.lock().await.insert(id, edit);
        id
    }

    pub async fn take(&self, id: Uuid) -> Option<ProposedEdit> {
        self.inner.lock().await.remove(&id)
    }
}
