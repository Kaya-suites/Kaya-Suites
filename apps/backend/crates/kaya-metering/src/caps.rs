// Copyright 2024 Kaya Suites. Licensed under the Apache License, Version 2.0.
//!
//! Per-user monthly spend cap enforcement (FR-35).
//!
//! Uses `AnyPool` and `?` placeholders for portability.

use chrono::{DateTime, Utc};
use sqlx::AnyPool;
use uuid::Uuid;

use crate::error::MeteringError;
use crate::events::current_period_start;

/// Check whether `user_id` has reached their monthly spend cap.
///
/// The period is the current calendar month.  Returns
/// `MeteringError::SpendCapReached` if the cap has been hit.
pub async fn check_spend_cap(
    pool: &AnyPool,
    user_id: Uuid,
    cap_usd: f64,
) -> Result<(), MeteringError> {
    let period_start: DateTime<Utc> = current_period_start()
        .and_hms_opt(0, 0, 0)
        .expect("valid hms")
        .and_utc();

    let spent: f64 = sqlx::query_scalar::<_, f64>(
        "SELECT COALESCE(SUM(cost_usd), 0.0) FROM usage_events WHERE user_id = ? AND recorded_at >= ?",
    )
    .bind(user_id.to_string())
    .bind(period_start.to_rfc3339())
    .fetch_one(pool)
    .await?;

    if spent >= cap_usd {
        return Err(MeteringError::SpendCapReached {
            spent_usd: spent,
            cap_usd,
        });
    }

    Ok(())
}

/// Returns the current-period spend for a user without enforcing the cap.
/// Used for dashboard display and alert thresholds.
pub async fn current_period_spend(pool: &AnyPool, user_id: Uuid) -> Result<f64, MeteringError> {
    let period_start: DateTime<Utc> = current_period_start()
        .and_hms_opt(0, 0, 0)
        .expect("valid hms")
        .and_utc();

    let spent: f64 = sqlx::query_scalar::<_, f64>(
        "SELECT COALESCE(SUM(cost_usd), 0.0) FROM usage_events WHERE user_id = ? AND recorded_at >= ?",
    )
    .bind(user_id.to_string())
    .bind(period_start.to_rfc3339())
    .fetch_one(pool)
    .await?;

    Ok(spent)
}
