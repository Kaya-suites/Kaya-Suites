// Copyright 2024 Kaya Suites. Licensed under the Apache License, Version 2.0.
//!
//! Persist a single LLM token-usage record to `usage_events` and roll it up
//! into the monthly `usage_counters` aggregate.
//!
//! Uses `AnyPool` and `?` placeholders for Postgres/SQLite/MySQL portability.
//! Replaces `ON CONFLICT ... EXCLUDED` with a transaction-based upsert.

use chrono::{Datelike, NaiveDate, Utc};
use kaya_core::{OperationType, TokenUsage};
use sqlx::{AnyPool, Row};
use uuid::Uuid;

use crate::error::MeteringError;
use crate::pricing::PricingConfig;

/// Map an [`OperationType`] to its snake_case DB string.
pub fn operation_to_str(op: &OperationType) -> &'static str {
    match op {
        OperationType::RetrievalClassification => "retrieval_classification",
        OperationType::DocumentGeneration => "document_generation",
        OperationType::EditProposal => "edit_proposal",
        OperationType::StaleDetection => "stale_detection",
        OperationType::Embedding => "embedding",
        OperationType::IntentClassification => "intent_classification",
        OperationType::ResearchSynthesis => "research_synthesis",
    }
}

/// Returns true for operations that count against the D-12 agent invocation quota.
pub fn is_agent_invocation(op: &OperationType) -> bool {
    matches!(
        op,
        OperationType::EditProposal | OperationType::DocumentGeneration
    )
}

/// First day of the current calendar month — used as the period key.
pub fn current_period_start() -> NaiveDate {
    let now = Utc::now();
    NaiveDate::from_ymd_opt(now.year(), now.month(), 1).expect("valid date")
}

/// Persist one LLM call to `usage_events` and roll it up into `usage_counters`.
///
/// Uses a transaction-based SELECT + INSERT/UPDATE upsert that works on all
/// three database backends (Postgres, SQLite, MySQL).
pub async fn persist_event(
    pool: &AnyPool,
    pricing: &PricingConfig,
    user_id: Uuid,
    usage: &TokenUsage,
) -> Result<(), MeteringError> {
    let cost = pricing.compute_cost(&usage.model, usage.input_tokens, usage.output_tokens);
    let op_str = operation_to_str(&usage.operation);
    let is_invocation = is_agent_invocation(&usage.operation);
    let event_id = Uuid::new_v4();

    sqlx::query(
        "INSERT INTO usage_events (id, user_id, operation, model, input_tokens, output_tokens, cost_usd)
         VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(event_id.to_string())
    .bind(user_id.to_string())
    .bind(op_str)
    .bind(&usage.model)
    .bind(usage.input_tokens as i32)
    .bind(usage.output_tokens as i32)
    .bind(cost)
    .execute(pool)
    .await?;

    let period_start = current_period_start();
    let invocation_delta: i64 = if is_invocation { 1 } else { 0 };
    let period_start_str = period_start.to_string(); // "YYYY-MM-DD"

    // Portable upsert via transaction (works on Postgres, SQLite, MySQL)
    let mut tx = pool.begin().await?;

    let existing = sqlx::query(
        "SELECT id, tokens_in, tokens_out, agent_invocations FROM usage_counters
         WHERE user_id = $1 AND period_start = $2",
    )
    .bind(user_id.to_string())
    .bind(&period_start_str)
    .fetch_optional(&mut *tx)
    .await?;

    if let Some(row) = existing {
        let existing_id: String = row.try_get("id").unwrap_or_default();
        let prev_in: i64 = row.try_get("tokens_in").unwrap_or(0);
        let prev_out: i64 = row.try_get("tokens_out").unwrap_or(0);
        let prev_inv: i64 = row.try_get("agent_invocations").unwrap_or(0);
        sqlx::query(
            "UPDATE usage_counters SET tokens_in = $1, tokens_out = $2, agent_invocations = $3
             WHERE id = $4",
        )
        .bind(prev_in + usage.input_tokens as i64)
        .bind(prev_out + usage.output_tokens as i64)
        .bind(prev_inv + invocation_delta)
        .bind(existing_id)
        .execute(&mut *tx)
        .await?;
    } else {
        let counter_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO usage_counters (id, user_id, period_start, tokens_in, tokens_out, agent_invocations)
             VALUES ($1, $2, $3, $4, $5, $6)",
        )
        .bind(counter_id.to_string())
        .bind(user_id.to_string())
        .bind(&period_start_str)
        .bind(usage.input_tokens as i64)
        .bind(usage.output_tokens as i64)
        .bind(invocation_delta)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(())
}
