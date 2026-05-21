// Copyright 2024 Kaya Suites. All rights reserved. — BSL 1.1

use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::FromRef;
use kaya_core::model_router::ModelRouter;
use kaya_metering::MeteringService;
use kaya_server::state::StoredEdit;
use kaya_tenant::PasswordAuthService;
use sqlx::PgPool;
use tokio::sync::Mutex;
use uuid::Uuid;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub password_auth_svc: Arc<PasswordAuthService>,
    pub metering_svc: Arc<MeteringService>,
    pub admin_email: String,
    pub llm: Option<Arc<ModelRouter>>,
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

impl FromRef<AppState> for Arc<MeteringService> {
    fn from_ref(s: &AppState) -> Self {
        s.metering_svc.clone()
    }
}
