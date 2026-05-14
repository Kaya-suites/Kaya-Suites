// Copyright 2024 Kaya Suites. All rights reserved. — BSL 1.1

use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::FromRef;
use kaya_billing::BillingService;
use kaya_core::model_router::ModelRouter;
use kaya_metering::MeteringService;
use kaya_server::state::StoredEdit;
use kaya_tenant::PasswordAuthService;
use sqlx::PgPool;
use tokio::sync::Mutex;
use uuid::Uuid;

/// Shared application state for the cloud binary.
#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub password_auth_svc: Arc<PasswordAuthService>,
    pub billing_svc: Arc<BillingService>,
    pub metering_svc: Arc<MeteringService>,
    /// Hardcoded admin email from `ADMIN_EMAIL` env var.
    pub admin_email: String,
    /// LLM router — `None` when API keys are not configured.
    pub llm: Option<Arc<ModelRouter>>,
    /// Pending edits shared between chat SSE stream and approve endpoint.
    pub pending_edits: Arc<Mutex<HashMap<Uuid, StoredEdit>>>,
}

impl FromRef<AppState> for PgPool {
    fn from_ref(s: &AppState) -> Self {
        s.pool.clone()
    }
}

impl FromRef<AppState> for Arc<PasswordAuthService> {
    fn from_ref(s: &AppState) -> Self {
        s.password_auth_svc.clone()
    }
}

impl FromRef<AppState> for Arc<BillingService> {
    fn from_ref(s: &AppState) -> Self {
        s.billing_svc.clone()
    }
}

impl FromRef<AppState> for Arc<MeteringService> {
    fn from_ref(s: &AppState) -> Self {
        s.metering_svc.clone()
    }
}
