//! kaya-oss — unified self-hosted binary (Apache 2.0)
//!
//! Supports Postgres, SQLite, and MySQL via `DATABASE_URL`.
//! Pass `--schema` to print the OpenAPI JSON and exit (CI codegen).
//!
//! # Environment variables
//!
//! | Variable              | Description                                              |
//! |-----------------------|----------------------------------------------------------|
//! | `DATABASE_URL`        | Connection string (required)                             |
//! | `ADMIN_EMAIL`         | Hardcoded admin email for founder dashboard              |
//! | `SUPERADMIN_EMAIL`    | Email for the built-in superadmin (default: admin@kaya.local) |
//! | `KAYA_PORT`           | Bind port (default: 3001)                                |
//! | `FRONTEND_URL`        | Allowed CORS origin (default: http://localhost:3000)     |
//! | `KAYA_CONFIG`         | Path to kaya.yaml for LLM router (optional)              |
//! | `PRICING_CONFIG_PATH` | Path to pricing.yaml (optional)                          |

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use anyhow::Context as _;
use axum::{
    Json,
    body::Body,
    extract::{Request, State},
    http::{HeaderName, HeaderValue, Method, StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Response},
};
use kaya_auth::{Backend as AuthBackend, KayaAuthBackend, PasswordAuthService};
use kaya_core::UserContext;
use kaya_core::model_router::ModelRouter;
use kaya_db::Dialect;
use kaya_metering::{MeteringService, pricing::PricingConfig, service::MeteringConfig};
use kaya_server::state::StoredEdit;
use kaya_storage::{MySqlAdapter, MySqlSessionStorage, SqliteAdapter, SqliteSessionStorage};
use rust_embed::RustEmbed;
use serde_json::{Value, json};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::{AnyPool, MySqlPool, PgPool};
use tokio::sync::Mutex;
use tower_http::cors::CorsLayer;
use tower_sessions::cookie::SameSite;
use tower_sessions::{Expiry, SessionManagerLayer};
use tower_sessions_sqlx_store::{MySqlStore, PostgresStore, SqliteStore};
use tracing_subscriber::{EnvFilter, fmt, prelude::*};
use utoipa::OpenApi;
use utoipa_axum::{router::OpenApiRouter, routes};
use uuid::Uuid;

mod routes;
mod session_store;
mod state;

use session_store::AnySessionStore;
use state::{AppState, DbBackend};

// ── OpenAPI ───────────────────────────────────────────────────────────────────

#[derive(OpenApi)]
#[openapi(info(title = "Kaya Suites API", version = "0.1.0"))]
struct ApiDoc;

#[utoipa::path(get, path = "/health", responses((status = 200, body = Value)), tag = "ops")]
async fn health() -> Json<Value> {
    Json(json!({"status": "ok"}))
}

// ── Embedded static frontend ──────────────────────────────────────────────────

#[derive(RustEmbed)]
#[folder = "frontend/"]
struct Assets;

async fn static_handler(uri: axum::http::Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    for candidate in &[
        path.to_string(),
        format!("{path}.html"),
        "index.html".to_string(),
    ] {
        if let Some(content) = Assets::get(candidate) {
            let mime = mime_guess::from_path(candidate)
                .first_or_octet_stream()
                .to_string();
            return Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, mime)
                .body(Body::from(content.data.to_vec()))
                .unwrap();
        }
    }
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .body(Body::from("not found"))
        .unwrap()
}

// ── inject_storage middleware ─────────────────────────────────────────────────

async fn inject_storage(
    State(state): State<AppState>,
    auth: axum_login::AuthSession<KayaAuthBackend>,
    mut request: Request,
    next: Next,
) -> Response {
    let Some(user) = auth.user else {
        return StatusCode::UNAUTHORIZED.into_response();
    };

    let user_ctx = UserContext {
        user_id: user.id,
        tenant_id: user.id,
    };

    let (storage, sessions) =
        match kaya_storage::build_user_adapters(&state.db_backend, user_ctx).await {
            Ok(pair) => pair,
            Err(e) => {
                tracing::error!(error = %e, "build_user_adapters failed");
                return StatusCode::INTERNAL_SERVER_ERROR.into_response();
            }
        };

    request.extensions_mut().insert(storage);
    request.extensions_mut().insert(sessions);
    request.extensions_mut().insert(state.llm.clone());
    request.extensions_mut().insert(state.pending_edits.clone());
    request.extensions_mut().insert(state.pool.clone());

    next.run(request).await
}

// ── main ──────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Init tracing before anything else.
    tracing_subscriber::registry()
        .with(fmt::layer())
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    // -- OpenAPI schema generation (early exit) --------------------------------
    let (oa_router, api) = OpenApiRouter::with_openapi(ApiDoc::openapi())
        .routes(routes!(health))
        .split_for_parts();

    if std::env::args().any(|a| a == "--schema") {
        println!("{}", api.to_pretty_json().expect("serialize"));
        return Ok(());
    }

    // -- Load .env if present --------------------------------------------------
    dotenvy::dotenv().ok();

    // -- Required env vars -----------------------------------------------------
    let database_url = std::env::var("DATABASE_URL").context("DATABASE_URL is required")?;
    let admin_email = std::env::var("ADMIN_EMAIL").unwrap_or_else(|_| "admin@kaya.local".into());
    let superadmin_email =
        std::env::var("SUPERADMIN_EMAIL").unwrap_or_else(|_| "admin@kaya.local".into());
    let port: u16 = std::env::var("KAYA_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(3001);
    let frontend_url =
        std::env::var("FRONTEND_URL").unwrap_or_else(|_| "http://localhost:3000".into());
    let pricing_config_path = std::env::var("PRICING_CONFIG_PATH")
        .unwrap_or_else(|_| concat!(env!("CARGO_MANIFEST_DIR"), "/config/pricing.yaml").into());

    // -- Detect database dialect -----------------------------------------------
    sqlx::any::install_default_drivers();
    let dialect = Dialect::from_url(&database_url)?;
    tracing::info!(?dialect, "database backend selected");

    // -- Connect & run universal migrations ------------------------------------
    let any_pool = AnyPool::connect(&database_url)
        .await
        .context("failed to connect to database")?;
    kaya_db::run_migrations(&any_pool, dialect)
        .await
        .context("failed to run migrations")?;
    tracing::info!("migrations applied");

    // -- Build typed pool for storage adapter ----------------------------------
    let db_backend = match dialect {
        Dialect::Postgres => {
            let pg = PgPool::connect(&database_url).await?;
            DbBackend::Postgres(pg)
        }
        Dialect::Sqlite => {
            let db_file = database_url
                .strip_prefix("sqlite://")
                .or_else(|| database_url.strip_prefix("sqlite:"))
                .unwrap_or(&database_url);
            let opts = SqliteConnectOptions::new()
                .filename(db_file)
                .create_if_missing(true)
                .journal_mode(SqliteJournalMode::Wal);
            let sqlite = SqlitePoolOptions::new().connect_with(opts).await?;
            SqliteAdapter::run_migrations(&sqlite)
                .await
                .context("sqlite storage migrations")?;
            SqliteSessionStorage::run_migrations(&sqlite)
                .await
                .context("sqlite session migrations")?;
            DbBackend::Sqlite(sqlite)
        }
        Dialect::Mysql => {
            let mysql = MySqlPool::connect(&database_url).await?;
            MySqlAdapter::run_migrations(&mysql)
                .await
                .context("mysql storage migrations")?;
            MySqlSessionStorage::run_migrations(&mysql)
                .await
                .context("mysql session migrations")?;
            DbBackend::Mysql(mysql)
        }
    };

    // -- Session store ---------------------------------------------------------
    let session_store: AnySessionStore = match &db_backend {
        DbBackend::Postgres(pg) => {
            let store = PostgresStore::new(pg.clone());
            store
                .migrate()
                .await
                .context("postgres session store migrate")?;
            AnySessionStore::Postgres(store)
        }
        DbBackend::Sqlite(sqlite) => {
            let store = SqliteStore::new(sqlite.clone());
            store
                .migrate()
                .await
                .context("sqlite session store migrate")?;
            AnySessionStore::Sqlite(store)
        }
        DbBackend::Mysql(mysql) => {
            let store = MySqlStore::new(mysql.clone());
            store
                .migrate()
                .await
                .context("mysql session store migrate")?;
            AnySessionStore::Mysql(store)
        }
    };

    // -- Services --------------------------------------------------------------
    let auth_backend_kind = match dialect {
        Dialect::Postgres => AuthBackend::Postgres,
        Dialect::Sqlite => AuthBackend::Sqlite,
        Dialect::Mysql => AuthBackend::Mysql,
    };
    let password_auth_svc = Arc::new(PasswordAuthService::new(
        any_pool.clone(),
        auth_backend_kind,
    ));
    password_auth_svc
        .seed_superadmin(&superadmin_email, "KayaSuperAdmin", "KayaPassword")
        .await
        .context("seed superadmin")?;
    tracing::info!("superadmin ready");

    let pricing_path = std::path::Path::new(&pricing_config_path);
    let pricing = PricingConfig::from_yaml_file(pricing_path).unwrap_or_else(|e| {
        tracing::warn!(error = %e, "pricing config not found, using empty config");
        PricingConfig {
            models: Default::default(),
        }
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
    let metering_svc = Arc::new(MeteringService::new(
        any_pool.clone(),
        pricing,
        metering_config,
    ));

    // -- LLM router (optional) ------------------------------------------------
    let config_path = std::env::var("KAYA_CONFIG")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("kaya.yaml"));
    let llm: Option<Arc<ModelRouter>> = match ModelRouter::from_yaml(&config_path) {
        Ok(r) => {
            tracing::info!("LLM router loaded");
            Some(Arc::new(r))
        }
        Err(e) => {
            tracing::warn!(error = %e, "LLM router unavailable; chat will return 503");
            None
        }
    };

    let pending_edits = Arc::new(Mutex::new(HashMap::<Uuid, StoredEdit>::new()));
    let mcp_cache: routes::mcp::McpCache = Arc::new(tokio::sync::RwLock::new(HashMap::new()));

    // -- App state -------------------------------------------------------------
    let state = AppState {
        pool: any_pool.clone(),
        db_backend: db_backend.clone(),
        password_auth_svc,
        metering_svc,
        admin_email,
        llm,
        pending_edits,
    };

    // -- Auth layer ------------------------------------------------------------
    let session_layer = SessionManagerLayer::new(session_store)
        .with_name("kaya_session")
        .with_http_only(true)
        .with_same_site(SameSite::Lax)
        .with_expiry(Expiry::OnInactivity(
            tower_sessions::cookie::time::Duration::days(7),
        ));

    let auth_backend = KayaAuthBackend::new(any_pool.clone());
    let auth_layer = axum_login::AuthManagerLayerBuilder::new(auth_backend, session_layer).build();

    // -- CORS ------------------------------------------------------------------
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

    // -- Shared routes (auth-gated) --------------------------------------------
    let shared_routes = kaya_server::router().route_layer(axum::middleware::from_fn_with_state(
        state.clone(),
        inject_storage,
    ));

    // -- OAuth routes (mounted OUTSIDE inject_storage) -------------------------
    // The public ones (well-known, register, token) need no cookie auth.
    // The authenticated ones (authorize, consent/*) use `AuthSession` directly
    // — `/oauth/authorize` redirects signed-out users to sign-in, so we
    // cannot let `inject_storage` 401 first.
    let oauth_issuer = kaya_server::OAuthIssuer::new(
        std::env::var("KAYA_PUBLIC_URL").unwrap_or_else(|_| format!("http://localhost:{port}")),
    );
    let consent_store = kaya_server::ConsentRequestStore::new();
    let oauth_routes = kaya_server::oauth_public_router()
        .merge(kaya_server::oauth_authenticated_router())
        .layer(axum::Extension(any_pool.clone()))
        .layer(axum::Extension(oauth_issuer.clone()))
        .layer(axum::Extension(consent_store.clone()));

    // -- /mcp HTTP route — needs a configured ModelRouter only ---------------
    let mcp_router = match &state.llm {
        Some(llm) => {
            let mcp_state = routes::mcp::McpState {
                pool: any_pool.clone(),
                db_backend: state.db_backend.clone(),
                router: llm.clone(),
                cache: mcp_cache,
                issuer: oauth_issuer.clone(),
            };
            Some(
                axum::Router::<AppState>::new()
                    .route("/mcp", axum::routing::any(routes::mcp::handle))
                    .layer(axum::Extension(mcp_state)),
            )
        }
        None => {
            tracing::warn!("/mcp HTTP route disabled — KAYA_CONFIG / ModelRouter not loaded");
            None
        }
    };

    // -- Full router ----------------------------------------------------------
    let mut app = oa_router
        .merge(routes::auth::router())
        .merge(routes::account::router())
        .merge(routes::dashboard::router())
        .merge(routes::admin::router())
        .merge(shared_routes)
        .merge(oauth_routes);
    if let Some(r) = mcp_router {
        app = app.merge(r);
    }
    let app = app
        .layer(auth_layer)
        .layer(cors)
        .layer(tower_http::trace::TraceLayer::new_for_http())
        .with_state(state)
        .fallback(static_handler);

    let addr = format!("0.0.0.0:{port}");
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .with_context(|| format!("bind {addr}"))?;
    tracing::info!(port, "kaya-oss listening");
    axum::serve(listener, app).await?;
    Ok(())
}
