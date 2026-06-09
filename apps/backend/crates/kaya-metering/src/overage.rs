// Copyright 2024 Kaya Suites. Licensed under the Apache License, Version 2.0.

use chrono::NaiveDate;
use sqlx::{AnyPool, Row};
use tracing::info;
use uuid::Uuid;

use crate::error::MeteringError;

const COST_PER_OVERAGE_INVOCATION_USD: f64 = 0.10;

pub async fn report_period_overage(
    pool: &AnyPool,
    user_id: Uuid,
    period_start: NaiveDate,
    included_invocations: i64,
) -> Result<(), MeteringError> {
    let row = sqlx::query(
        "SELECT agent_invocations FROM usage_counters
         WHERE user_id = $1 AND period_start = $2
         LIMIT 1",
    )
    .bind(user_id.to_string())
    .bind(period_start.to_string())
    .fetch_optional(pool)
    .await?;

    let Some(row) = row else {
        info!(%user_id, "no usage data for period — no overage to report");
        return Ok(());
    };

    let invocations: i64 = row.try_get("agent_invocations").unwrap_or(0);
    let overage = (invocations - included_invocations).max(0);

    if overage == 0 {
        info!(%user_id, "no overage for period {period_start}");
        return Ok(());
    }

    let overage_usd = overage as f64 * COST_PER_OVERAGE_INVOCATION_USD;
    info!(%user_id, invocations, included = included_invocations, overage, overage_usd, "overage detected");
    Ok(())
}
