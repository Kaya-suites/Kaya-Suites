use axum::{
    Router,
    routing::{get, patch, post, put},
};

mod chat;
mod documents;
mod edits;
mod folders;
pub mod oauth;
mod sessions;

pub use oauth::{ConsentRequest, ConsentRequestStore, OAuthIssuer};

/// Build the shared API router, generic over the host binary's state type.
///
/// All handlers read their dependencies from Axum [`Extension`]s rather than
/// `State`, so the router is compatible with any `S`. The caller must inject
/// the following extensions before requests reach these routes:
///
/// - `Arc<dyn StorageAdapter>` — per-request storage (scoped to user in cloud)
/// - `Arc<dyn SessionStorage>` — per-request session storage
/// - `Option<Arc<ModelRouter>>` — LLM router (None → 503 on chat routes)
/// - `Arc<Mutex<HashMap<Uuid, StoredEdit>>>` — pending edit map
pub fn router<S>() -> Router<S>
where
    S: Clone + Send + Sync + 'static,
{
    let r = Router::new()
        .route(
            "/documents",
            get(documents::list_documents).post(documents::create_document),
        )
        .route(
            "/documents/{id}",
            get(documents::get_document)
                .put(documents::update_document)
                .delete(documents::delete_document),
        )
        .route(
            "/documents/{id}/export.pdf",
            get(documents::export_document_pdf),
        )
        .route(
            "/documents/{id}/folder",
            put(folders::move_document_to_folder),
        )
        .route(
            "/documents/{id}/order",
            put(documents::reorder_document),
        )
        .route(
            "/folders",
            get(folders::list_folders).post(folders::create_folder),
        )
        .route(
            "/folders/{id}",
            get(folders::get_folder)
                .put(folders::update_folder)
                .delete(folders::delete_folder),
        )
        .route(
            "/sessions",
            get(sessions::list_sessions).post(sessions::create_session),
        )
        .route("/sessions/usage", get(sessions::get_usage_summary))
        .route(
            "/sessions/preferences/folder-sidebar",
            get(sessions::get_folder_sidebar_state).put(sessions::update_folder_sidebar_state),
        )
        .route(
            "/sessions/{id}",
            patch(sessions::rename_session).delete(sessions::delete_session),
        )
        .route("/sessions/{id}/pin", post(sessions::pin_session))
        .route(
            "/sessions/{id}/messages",
            get(sessions::get_session_messages),
        )
        .route("/sessions/{id}/chat", post(chat::chat_stream))
        .route("/edits/{id}/approve", post(edits::approve_edit))
        .route("/edits/{id}/reject", post(edits::reject_edit));
    r
}

/// Public OAuth router (no cookie auth required). Mount outside `inject_storage`.
pub use oauth::public_router as oauth_public_router;

/// Authenticated OAuth router. Uses cookie auth via `AuthSession` but does NOT
/// require an authenticated user at the middleware level — `/oauth/authorize`
/// handles signed-out users by redirecting to sign-in. Mount outside
/// `inject_storage` (which would 401 before the handler ran).
pub fn oauth_authenticated_router<S: Clone + Send + Sync + 'static>() -> axum::Router<S> {
    oauth::authenticated_routes(axum::Router::new())
}
