pub mod error;
pub mod routes;
pub mod state;

pub use routes::{
    ConsentRequest, ConsentRequestStore, OAuthIssuer, oauth_authenticated_router,
    oauth_public_router, router,
};

/// Re-export so callers can call `kaya_server::router::<S>()`.
pub use axum::Router;
