// Copyright 2024 Kaya Suites. Licensed under the Apache License, Version 2.0.
//!
//! Monthly usage summaries and admin aggregate stats.
//!
//! Uses `AnyPool` and `?` placeholders for Postgres/SQLite/MySQL portability.

use chrono::NaiveDate;
use serde::Serialize;
use sqlx::{AnyPool, Row};
use uuid::Uuid;

use crate::error::MeteringError;
use crate::events::current_period_start;

/// Per-user summary for the current billing period.
#[derive(Debug, Clone, Serialize)]
pub struct UsageSummary {
    pub period_start: NaiveDate,
    pub tokens_in: i64,
    pub tokens_out: i64,
    pub cost_usd: f64,
    pub agent_invocations: i64,
}

/// Per-user stats row for the admin dashboard.
#[derive(Debug, Clone, Serialize)]
pub struct UserStats {
    pub user_id: String,
    pub email: String,
    pub monthly_cost_usd: f64,
    pub agent_invocations: i64,
}

/// Aggregate stats for the founder dashboard.
#[derive(Debug, Clone, Serialize)]
pub struct AdminStats {
    pub aggregate_daily_spend_usd: f64,
    pub aggregate_monthly_spend_usd: f64,
    pub circuit_breaker_active: bool,
    pub top_users: Vec<UserStats>,
    pub total_users: i64,
    pub active_subscriptions: i64,
}

/// Fetch the current-period usage summary for one user.
pub async fn monthly_summary(pool: &AnyPool, user_id: Uuid) -> Result<UsageSummary, MeteringError> {
    let period_start = current_period_start();
    let period_start_str = period_start.to_string();

    let row = sqlx::query(
        "SELECT COALESCE(tokens_in, 0)         AS tokens_in,
                COALESCE(tokens_out, 0)        AS tokens_out,
                COALESCE(agent_invocations, 0) AS agent_invocations
         FROM usage_counters
         WHERE user_id = ? AND period_start = ?",
    )
    .bind(user_id.to_string())
    .bind(&period_start_str)
    .fetch_optional(pool)
    .await?;

    let (tokens_in, tokens_out, agent_invocations) = row
        .map(|r| {
            (
                r.try_get::<i64, _>("tokens_in").unwrap_or(0),
                r.try_get::<i64, _>("tokens_out").unwrap_or(0),
                r.try_get::<i64, _>("agent_invocations").unwrap_or(0),
            )
        })
        .unwrap_or((0, 0, 0));

    let period_dt = period_start
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_utc();

    let cost_usd: f64 = sqlx::query_scalar::<_, f64>(
        "SELECT COALESCE(SUM(cost_usd), 0.0) FROM usage_events WHERE user_id = ? AND recorded_at >= ?",
    )
    .bind(user_id.to_string())
    .bind(period_dt.to_rfc3339())
    .fetch_one(pool)
    .await?;

    Ok(UsageSummary {
        period_start,
        tokens_in,
        tokens_out,
        cost_usd,
        agent_invocations,
    })
}

/// Aggregate stats for the founder admin dashboard.
pub async fn admin_stats(pool: &AnyPool, circuit_active: bool) -> Result<AdminStats, MeteringError> {
    let period_start = current_period_start();
    let period_dt = period_start.and_hms_opt(0, 0, 0).unwrap().and_utc();
    let day_start = chrono::Utc::now()
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_utc();

    let daily_spend: f64 = sqlx::query_scalar::<_, f64>(
        "SELECT COALESCE(SUM(cost_usd), 0.0) FROM usage_events WHERE recorded_at >= ?",
    )
    .bind(day_start.to_rfc3339())
    .fetch_one(pool)
    .await?;

    let monthly_spend: f64 = sqlx::query_scalar::<_, f64>(
        "SELECT COALESCE(SUM(cost_usd), 0.0) FROM usage_events WHERE recorded_at >= ?",
    )
    .bind(period_dt.to_rfc3339())
    .fetch_one(pool)
    .await?;

    let total_users: i64 = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM users")
        .fetch_one(pool)
        .await?;

    let active_subscriptions: i64 = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM subscriptions WHERE status = 'active'",
    )
    .fetch_one(pool)
    .await?;

    let top_rows = sqlx::query(
        "SELECT u.id, u.email,
                COALESCE(SUM(e.cost_usd), 0.0) AS monthly_cost,
                COALESCE(MAX(uc.agent_invocations), 0) AS agent_invocations
         FROM users u
         LEFT JOIN usage_events e ON e.user_id = u.id AND e.recorded_at >= ?
         LEFT JOIN usage_counters uc ON uc.user_id = u.id AND uc.period_start = ?
         GROUP BY u.id, u.email
         ORDER BY monthly_cost DESC
         LIMIT 20",
    )
    .bind(period_dt.to_rfc3339())
    .bind(period_start.to_string())
    .fetch_all(pool)
    .await?;

    let top_users = top_rows
        .iter()
        .map(|r| UserStats {
            user_id: r.try_get::<String, _>("id").unwrap_or_default(),
            email: r.try_get("email").unwrap_or_default(),
            monthly_cost_usd: r.try_get::<f64, _>("monthly_cost").unwrap_or(0.0),
            agent_invocations: r.try_get::<i64, _>("agent_invocations").unwrap_or(0),
        })
        .collect();

    Ok(AdminStats {
        aggregate_daily_spend_usd: daily_spend,
        aggregate_monthly_spend_usd: monthly_spend,
        circuit_breaker_active: circuit_active,
        top_users,
        total_users,
        active_subscriptions,
    })
}
