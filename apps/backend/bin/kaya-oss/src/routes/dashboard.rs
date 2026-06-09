// Copyright 2024 Kaya Suites. Licensed under the Apache License, Version 2.0.
//!
//! User-facing dashboard routes.
//!
//! - `GET /metering/summary` — current-period usage vs limits

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};
use chrono::Datelike as _;
use kaya_auth::{AuthSession, KayaAuthBackend};
use kaya_metering::MeteringService;
use serde::Serialize;

use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/metering/summary", get(metering_summary))
}

#[derive(Serialize)]
struct MeteringSummary {
    agent_invocations_used: i64,
    agent_invocations_limit: i64,
    spend_usd: f64,
    spend_cap_usd: f64,
    period_start: String,
}

async fn metering_summary(
    State(metering_svc): State<Arc<MeteringService>>,
    auth: AuthSession<KayaAuthBackend>,
) -> Response {
    let user = match auth.user {
        Some(u) => u,
        None => return StatusCode::UNAUTHORIZED.into_response(),
    };

    match metering_svc.monthly_summary(user.id).await {
        Ok(summary) => {
            let now = chrono::Utc::now();
            let period_start = chrono::NaiveDate::from_ymd_opt(now.year(), now.month(), 1)
                .unwrap()
                .to_string();

            (
                StatusCode::OK,
                Json(MeteringSummary {
                    agent_invocations_used: summary.agent_invocations,
                    agent_invocations_limit: metering_svc.included_invocations(),
                    spend_usd: summary.cost_usd,
                    spend_cap_usd: metering_svc.spend_cap_usd(),
                    period_start,
                }),
            )
                .into_response()
        }
        Err(e) => {
            tracing::error!(user_id = %user.id, error = %e, "metering summary query failed");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": format!("metering summary: {e}") })),
            )
                .into_response()
        }
    }
}
