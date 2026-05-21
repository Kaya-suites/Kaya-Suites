// Copyright 2024 Kaya Suites. All rights reserved. — BSL 1.1
//!
//! kaya-cloud — hosted cloud binary (BSL 1.1).
//!
//! # Startup sequence
//!
//! 1. Connect to Postgres (NEON_DATABASE_URL env var).
//! 2. Run storage migrations (kaya-postgres-storage MIGRATOR).
//! 3. Run session-store migration (tower-sessions-sqlx-store).
//! 4. Load pricing config (PRICING_CONFIG_PATH or the bundled default).
//! 5. Build service layer: PasswordAuth, Metering.
//! 6. Mount auth, account, admin, and shared kaya-server routes.
//! 7. Bind and serve.
//!
//! # Environment variables
//!
//! | Variable                  | Description                                              |
//! |---------------------------|----------------------------------------------------------|
//! | `NEON_DATABASE_URL`       | Postgres connection string (required)                    |
//! | `ADMIN_EMAIL`             | Hardcoded admin email for founder dashboard (required)   |
//! | `PRICING_CONFIG_PATH`     | Path to pricing.yaml (default: bin/kaya-cloud/config/pricing.yaml) |
//! | `PORT`                    | Bind port (default: 3001)                               |
//! | `FRONTEND_URL`            | Allowed CORS origin (default: http://localhost:3000)    |
//! | `KAYA_CONFIG`             | Path to kaya.yaml for LLM router (optional)             |
//! | `SUPERADMIN_EMAIL`        | Email for the built-in superadmin (default: admin@kaya.local) |

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use anyhow::Context as _;
use axum::{
    Router,
    extract::{Request, State},
    http::{HeaderName, HeaderValue, Method},
    middleware::Next,
    response::{IntoResponse, Response},
};
use kaya_core::{SessionStorage, StorageAdapter, model_router::ModelRouter};
use kaya_metering::pricing::PricingConfig;
use kaya_metering::service::MeteringConfig;
use kaya_metering::MeteringService;
use kaya_postgres_storage::{PostgresAdapter, PostgresSessionStorage};
use kaya_server::state::StoredEdit;
use kaya_tenant::{KayaAuthBackend, PasswordAuthService, UserContext};
use tokio::sync::Mutex;
use tower_http::cors::CorsLayer;
use tower_sessions::SessionManagerLayer;
use tower_sessions::cookie::SameSite;
use tracing_subscriber::{EnvFilter, fmt, prelude::*};
use uuid::Uuid;

mod routes;
mod state;

use state::AppState;

async fn inject_storage(
    State(state): State<AppState>,
    auth: axum_login::AuthSession<KayaAuthBackend>,
    mut request: Request,
    next: Next,
) -> Response {
    let Some(user) = auth.user else {
        return axum::http::StatusCode::UNAUTHORIZED.into_response();
    };

    let user_ctx = UserContext { user_id: user.id, tenant_id: user.id };

    let storage: Arc<dyn StorageAdapter> =
        Arc::new(PostgresAdapter::new(state.pool.clone(), user_ctx));
    let sessions: Arc<dyn SessionStorage> =
        Arc::new(PostgresSessionStorage::new(state.pool.clone(), user.id));

    request.extensions_mut().insert(storage);
    request.extensions_mut().insert(sessions);
    request.extensions_mut().insert(state.llm.clone());
    request.extensions_mut().insert(state.pending_edits.clone());

    next.run(request).await
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::from_path(concat!(env!("CARGO_MANIFEST_DIR"), "/.env")).ok();
    dotenvy::dotenv().ok();

    tracing_subscriber::registry()
        .with(fmt::layer())
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let database_url = require_env("NEON_DATABASE_URL")?;
    let admin_email = require_env("ADMIN_EMAIL")?;
    let pricing_config_path = std::env::var("PRICING_CONFIG_PATH")
        .unwrap_or_else(|_| concat!(env!("CARGO_MANIFEST_DIR"), "/config/pricing.yaml").into());
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3001);

    let pool = tokio::time::timeout(
        Duration::from_secs(60),
        sqlx::postgres::PgPoolOptions::new()
            .min_connections(0)
            .max_connections(10)
            .acquire_timeout(Duration::from_secs(60))
            .connect(&database_url),
    )
    .await
    .context("timed out connecting to Postgres (is the Neon endpoint awake?)")??;
    tracing::info!("connected to Postgres");

    kaya_postgres_storage::MIGRATOR.run(&pool).await?;
    tracing::info!("storage migrations applied");

    let session_store = kaya_tenant::PostgresStore::new(pool.clone());
    session_store.migrate().await?;
    tracing::info!("session store ready");

    let superadmin_email = std::env::var("SUPERADMIN_EMAIL")
        .unwrap_or_else(|_| "admin@kaya.local".into());
    let password_auth_svc = Arc::new(PasswordAuthService::new(pool.clone()));
    password_auth_svc
        .seed_superadmin(&superadmin_email, "KayaSuperAdmin", "KayaPassword")
        .await
        .context("failed to seed superadmin account")?;
    tracing::info!("superadmin ready");

    let pricing = PricingConfig::from_yaml_file(Path::new(&pricing_config_path))
        .unwrap_or_else(|e| {
            tracing::warn!(error = %e, "pricing config not found, using empty config");
            PricingConfig { models: Default::default() }
        });

    let metering_config = MeteringConfig {
        spend_cap_usd: 6.00,
        alert_threshold: 0.80,
        included_invocations: 50,
        hourly_token_limit: 100_000,
        daily_token_limit: 500_000,
        circuit_threshold_usd: 50.00,
        resend_api_key: std::env::var("RESEND_API_KEY").unwrap_or_default(),
        resend_from: std::env::var("RESEND_FROM").unwrap_or_default(),
        admin_email: admin_email.clone(),
    };
    let metering_svc = Arc::new(MeteringService::new(pool.clone(), pricing, metering_config));

    let config_path = std::env::var("KAYA_CONFIG")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::path::PathBuf::from("kaya.yaml"));

    let llm: Option<Arc<ModelRouter>> = match ModelRouter::from_yaml(&config_path) {
        Ok(r) => {
            tracing::info!("LLM router loaded from {config_path:?}");
            Some(Arc::new(r))
        }
        Err(e) => {
            tracing::warn!(error = %e, "LLM router unavailable; chat will return 503");
            None
        }
    };

    let pending_edits = Arc::new(Mutex::new(HashMap::<Uuid, StoredEdit>::new()));

    let state = AppState {
        pool: pool.clone(),
        password_auth_svc,
        metering_svc,
        admin_email,
        llm,
        pending_edits,
    };

    let session_layer = SessionManagerLayer::new(session_store)
        .with_name("kaya_session")
        .with_http_only(true)
        .with_same_site(SameSite::Lax)
        .with_secure(true)
        .with_expiry(tower_sessions::Expiry::OnInactivity(
            tower_sessions::cookie::time::Duration::days(7),
        ));

    let backend = KayaAuthBackend::new(pool.clone());
    let auth_layer = axum_login::AuthManagerLayerBuilder::new(backend, session_layer).build();

    let frontend_url = std::env::var("FRONTEND_URL")
        .unwrap_or_else(|_| "http://localhost:3000".into());
    let cors_origin: HeaderValue = frontend_url
        .parse()
        .context("FRONTEND_URL is not a valid HTTP origin")?;

    let cors = CorsLayer::new()
        .allow_origin(cors_origin)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([
            HeaderName::from_static("content-type"),
            HeaderName::from_static("authorization"),
            HeaderName::from_static("x-requested-with"),
        ])
        .allow_credentials(true);

    let shared_routes = kaya_server::router()
        .route_layer(axum::middleware::from_fn_with_state(
            state.clone(),
            inject_storage,
        ));

    let app = Router::new()
        .merge(routes::auth::router())
        .merge(routes::account::router())
        .merge(routes::dashboard::router())
        .merge(routes::admin::router())
        .merge(shared_routes)
        .layer(auth_layer)
        .layer(cors)
        .layer(tower_http::trace::TraceLayer::new_for_http())
        .with_state(state);

    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!(port = port, "kaya-cloud listening");

    axum::serve(listener, app).await?;
    Ok(())
}

fn require_env(key: &str) -> anyhow::Result<String> {
    std::env::var(key).map_err(|_| anyhow::anyhow!("missing required env var: {key}"))
}
