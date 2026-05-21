// Copyright 2024 Kaya Suites. Licensed under the Apache License, Version 2.0.
//!
//! Global daily spend circuit breaker (BRD §12.5).
//!
//! Uses `AnyPool` and `?` placeholders for portability across
//! Postgres, SQLite, and MySQL.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use sqlx::AnyPool;
use tracing::{error, info, warn};

use crate::error::MeteringError;

pub struct CircuitBreaker {
    tripped: Arc<AtomicBool>,
    threshold_usd: f64,
    last_check: Arc<Mutex<Option<Instant>>>,
    check_interval: Duration,
}

impl CircuitBreaker {
    pub fn new(threshold_usd: f64) -> Self {
        Self {
            tripped: Arc::new(AtomicBool::new(false)),
            threshold_usd,
            last_check: Arc::new(Mutex::new(None)),
            check_interval: Duration::from_secs(60),
        }
    }

    /// Check the circuit breaker.  Returns `MeteringError::CircuitBreakerOpen`
    /// if the daily aggregate spend has breached the threshold.
    pub async fn check(&self, pool: &AnyPool) -> Result<(), MeteringError> {
        if self.tripped.load(Ordering::Relaxed) {
            let daily = self.daily_spend(pool).await.unwrap_or(f64::MAX);
            return Err(MeteringError::CircuitBreakerOpen {
                daily_usd: daily,
                threshold_usd: self.threshold_usd,
            });
        }

        let needs_refresh = {
            let last = self.last_check.lock().expect("circuit lock poisoned");
            last.map_or(true, |t| t.elapsed() > self.check_interval)
        };

        if !needs_refresh {
            return Ok(());
        }

        let daily = self.daily_spend(pool).await?;
        *self.last_check.lock().expect("circuit lock poisoned") = Some(Instant::now());

        if daily >= self.threshold_usd {
            self.tripped.store(true, Ordering::Relaxed);
            warn!(
                daily_usd = daily,
                threshold_usd = self.threshold_usd,
                "circuit breaker TRIPPED — blocking new agent invocations"
            );
            self.persist_trip(pool, daily).await;
            return Err(MeteringError::CircuitBreakerOpen {
                daily_usd: daily,
                threshold_usd: self.threshold_usd,
            });
        }

        Ok(())
    }

    /// Reset the circuit breaker (founder-initiated, after investigating the anomaly).
    pub async fn reset(&self, pool: &AnyPool) {
        self.tripped.store(false, Ordering::Relaxed);
        *self.last_check.lock().expect("circuit lock poisoned") = None;
        let _ = sqlx::query(
            "DELETE FROM system_flags WHERE key = 'circuit_breaker_tripped'",
        )
        .execute(pool)
        .await;
        info!("circuit breaker reset");
    }

    pub fn is_tripped(&self) -> bool {
        self.tripped.load(Ordering::Relaxed)
    }

    async fn daily_spend(&self, pool: &AnyPool) -> Result<f64, MeteringError> {
        // Compute day boundary in Rust to avoid DB-specific date functions
        let day_start = chrono::Utc::now()
            .date_naive()
            .and_hms_opt(0, 0, 0)
            .unwrap()
            .and_utc();

        let spend: f64 = sqlx::query_scalar::<_, f64>(
            "SELECT COALESCE(SUM(cost_usd), 0.0) FROM usage_events WHERE recorded_at >= ?",
        )
        .bind(day_start.to_rfc3339())
        .fetch_one(pool)
        .await?;
        Ok(spend)
    }

    async fn persist_trip(&self, pool: &AnyPool, daily_usd: f64) {
        let value = format!("{:.6}", daily_usd);
        let now = chrono::Utc::now();

        // Transaction-based upsert (works on all 3 DBs)
        let res = async {
            let mut tx = pool.begin().await?;
            let existing = sqlx::query(
                "SELECT key FROM system_flags WHERE key = 'circuit_breaker_tripped'",
            )
            .fetch_optional(&mut *tx)
            .await?;

            let now_str = now.to_rfc3339();
            if existing.is_some() {
                sqlx::query(
                    "UPDATE system_flags SET value = ?, updated_at = ? WHERE key = 'circuit_breaker_tripped'",
                )
                .bind(&value)
                .bind(&now_str)
                .execute(&mut *tx)
                .await?;
            } else {
                sqlx::query(
                    "INSERT INTO system_flags (key, value, updated_at) VALUES ('circuit_breaker_tripped', ?, ?)",
                )
                .bind(&value)
                .bind(&now_str)
                .execute(&mut *tx)
                .await?;
            }
            tx.commit().await?;
            Ok::<_, sqlx::Error>(())
        }
        .await;

        if let Err(e) = res {
            error!(error = %e, "failed to persist circuit breaker state");
        }
    }
}
