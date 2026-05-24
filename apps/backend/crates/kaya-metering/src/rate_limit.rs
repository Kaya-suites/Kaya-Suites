// Copyright 2024 Kaya Suites. Licensed under the Apache License, Version 2.0.
//!
//! Hourly and daily token-bucket rate limits (FR-36).
//!
//! Uses `AnyPool` and `?` placeholders for Postgres/SQLite/MySQL portability.
//! Replaces `ON CONFLICT … DO UPDATE` with transaction-based upserts.

use chrono::{DateTime, TimeZone, Utc};
use sqlx::{AnyPool, Row};
use uuid::Uuid;

use crate::error::MeteringError;

fn truncate_to_hour(dt: DateTime<Utc>) -> DateTime<Utc> {
    let ts = dt.timestamp();
    Utc.timestamp_opt(ts - (ts % 3600), 0)
        .single()
        .expect("valid ts")
}

fn truncate_to_day(dt: DateTime<Utc>) -> DateTime<Utc> {
    dt.date_naive()
        .and_hms_opt(0, 0, 0)
        .expect("valid hms")
        .and_utc()
}

async fn window_usage(
    pool: &AnyPool,
    user_id: Uuid,
    window_type: &str,
    window_start: DateTime<Utc>,
) -> Result<i64, MeteringError> {
    let used: i64 = sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE(tokens_used, 0)
         FROM rate_limit_windows
         WHERE user_id = ? AND window_type = ? AND window_start = ?",
    )
    .bind(user_id.to_string())
    .bind(window_type)
    .bind(window_start.to_rfc3339())
    .fetch_one(pool)
    .await
    .unwrap_or(0i64);

    Ok(used)
}

async fn increment_window(
    pool: &AnyPool,
    user_id: Uuid,
    window_type: &str,
    window_start: DateTime<Utc>,
    tokens: i64,
) -> Result<(), MeteringError> {
    let window_start_str = window_start.to_rfc3339();
    let mut tx = pool.begin().await?;

    let existing = sqlx::query(
        "SELECT tokens_used FROM rate_limit_windows
         WHERE user_id = ? AND window_type = ? AND window_start = ?",
    )
    .bind(user_id.to_string())
    .bind(window_type)
    .bind(&window_start_str)
    .fetch_optional(&mut *tx)
    .await?;

    if let Some(row) = existing {
        let prev: i64 = row.try_get("tokens_used").unwrap_or(0);
        sqlx::query(
            "UPDATE rate_limit_windows SET tokens_used = ?
             WHERE user_id = ? AND window_type = ? AND window_start = ?",
        )
        .bind(prev + tokens)
        .bind(user_id.to_string())
        .bind(window_type)
        .bind(&window_start_str)
        .execute(&mut *tx)
        .await?;
    } else {
        sqlx::query(
            "INSERT INTO rate_limit_windows (user_id, window_type, window_start, tokens_used)
             VALUES (?, ?, ?, ?)",
        )
        .bind(user_id.to_string())
        .bind(window_type)
        .bind(&window_start_str)
        .bind(tokens)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(())
}

/// Check whether `user_id` is below both rate limits.
///
/// Does NOT modify any counters.  Call `record_usage` after the LLM call
/// completes to increment the buckets.
pub async fn check_rate_limit(
    pool: &AnyPool,
    user_id: Uuid,
    hourly_limit: i64,
    daily_limit: i64,
) -> Result<(), MeteringError> {
    let now = Utc::now();
    let hour_start = truncate_to_hour(now);
    let day_start = truncate_to_day(now);

    let hourly = window_usage(pool, user_id, "hourly", hour_start).await?;
    if hourly >= hourly_limit {
        return Err(MeteringError::RateLimitExceeded {
            window: "hourly",
            used: hourly,
            limit: hourly_limit,
        });
    }

    let daily = window_usage(pool, user_id, "daily", day_start).await?;
    if daily >= daily_limit {
        return Err(MeteringError::RateLimitExceeded {
            window: "daily",
            used: daily,
            limit: daily_limit,
        });
    }

    Ok(())
}

/// Increment the hourly and daily buckets by the actual token count consumed.
///
/// Call after a successful LLM call to keep buckets accurate.
pub async fn record_usage(pool: &AnyPool, user_id: Uuid, tokens: i64) -> Result<(), MeteringError> {
    let now = Utc::now();
    increment_window(pool, user_id, "hourly", truncate_to_hour(now), tokens).await?;
    increment_window(pool, user_id, "daily", truncate_to_day(now), tokens).await?;
    Ok(())
}
