// Copyright 2024 Kaya Suites. Licensed under the Apache License, Version 2.0.
//! In-process fixed-window rate limiter for unauthenticated abuse-prone routes.
//!
//! Keyed by client IP (from `ConnectInfo<SocketAddr>` or the first entry of
//! `X-Forwarded-For` when behind a trusted reverse proxy). Single-node only —
//! a clustered deployment should swap this for Redis-backed throttling.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::{
    extract::{ConnectInfo, Request, State},
    http::{HeaderMap, StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Response},
};
use tokio::sync::Mutex;

#[derive(Clone)]
pub struct RateLimiter {
    inner: Arc<Mutex<Inner>>,
    max_hits: u32,
    window: Duration,
}

struct Inner {
    buckets: HashMap<String, Bucket>,
    last_sweep: Instant,
}

struct Bucket {
    window_start: Instant,
    hits: u32,
}

impl RateLimiter {
    pub fn new(max_hits: u32, window: Duration) -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner {
                buckets: HashMap::new(),
                last_sweep: Instant::now(),
            })),
            max_hits,
            window,
        }
    }

    /// `Ok(())` if under the limit; `Err(retry_after_secs)` if over.
    async fn check(&self, key: &str) -> Result<(), u64> {
        let now = Instant::now();
        let mut g = self.inner.lock().await;

        // Periodic GC so the map can't grow without bound under attack.
        if now.duration_since(g.last_sweep) > self.window {
            g.buckets
                .retain(|_, b| now.duration_since(b.window_start) < self.window);
            g.last_sweep = now;
        }

        let bucket = g.buckets.entry(key.to_string()).or_insert(Bucket {
            window_start: now,
            hits: 0,
        });
        if now.duration_since(bucket.window_start) >= self.window {
            bucket.window_start = now;
            bucket.hits = 0;
        }
        bucket.hits += 1;
        if bucket.hits > self.max_hits {
            let elapsed = now.duration_since(bucket.window_start);
            let retry = self.window.saturating_sub(elapsed).as_secs().max(1);
            return Err(retry);
        }
        Ok(())
    }
}

fn client_key(headers: &HeaderMap, addr: Option<&SocketAddr>) -> String {
    // Trust X-Forwarded-For only if explicitly configured. For OSS default,
    // prefer the direct peer address to avoid spoofing.
    if let Some(addr) = addr {
        return addr.ip().to_string();
    }
    headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "unknown".into())
}

/// Tower middleware. Mount with `axum::middleware::from_fn_with_state`.
///
/// Requires the server to be started with
/// `into_make_service_with_connect_info::<SocketAddr>()` so `ConnectInfo`
/// extraction can succeed.
pub async fn enforce(
    State(limiter): State<RateLimiter>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    request: Request,
    next: Next,
) -> Response {
    let key = client_key(request.headers(), Some(&addr));
    match limiter.check(&key).await {
        Ok(()) => next.run(request).await,
        Err(retry_after) => {
            let body = serde_json::json!({
                "error": "rate_limited",
                "retry_after": retry_after,
            });
            (
                StatusCode::TOO_MANY_REQUESTS,
                [(header::RETRY_AFTER, retry_after.to_string())],
                axum::Json(body),
            )
                .into_response()
        }
    }
}
