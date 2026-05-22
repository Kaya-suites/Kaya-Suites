use std::sync::Arc;

use axum::{
    Json,
    extract::{Extension, Path},
    http::StatusCode,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use kaya_core::StorageAdapter;

use crate::error::ApiError;

// ── Shared response type ──────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FolderResponse {
    id: Uuid,
    name: String,
    parent_id: Option<Uuid>,
    created_at: String,
    updated_at: String,
}

impl From<kaya_core::storage::Folder> for FolderResponse {
    fn from(f: kaya_core::storage::Folder) -> Self {
        Self {
            id: f.id,
            name: f.name,
            parent_id: f.parent_id,
            created_at: f.created_at,
            updated_at: f.updated_at,
        }
    }
}

// ── GET /folders ──────────────────────────────────────────────────────────────

pub async fn list_folders(
    Extension(storage): Extension<Arc<dyn StorageAdapter>>,
) -> Result<Json<Vec<FolderResponse>>, ApiError> {
    let folders = storage
        .list_folders()
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;

    Ok(Json(folders.into_iter().map(FolderResponse::from).collect()))
}

// ── POST /folders ─────────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateFolderBody {
    pub name: String,
    pub parent_id: Option<Uuid>,
}

pub async fn create_folder(
    Extension(storage): Extension<Arc<dyn StorageAdapter>>,
    Json(body): Json<CreateFolderBody>,
) -> Result<(StatusCode, Json<FolderResponse>), ApiError> {
    if body.name.trim().is_empty() {
        return Err(ApiError::bad_request("folder name cannot be empty"));
    }

    let folder = storage
        .create_folder(body.name.trim(), body.parent_id)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;

    Ok((StatusCode::CREATED, Json(FolderResponse::from(folder))))
}

// ── GET /folders/:id ──────────────────────────────────────────────────────────

pub async fn get_folder(
    Extension(storage): Extension<Arc<dyn StorageAdapter>>,
    Path(id): Path<Uuid>,
) -> Result<Json<FolderResponse>, ApiError> {
    let folder = storage
        .get_folder(id)
        .await
        .map_err(|_| ApiError::not_found(format!("folder {id}")))?;

    Ok(Json(FolderResponse::from(folder)))
}

// ── PUT /folders/:id ──────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateFolderBody {
    pub name: Option<String>,
    /// Use `null` explicitly in JSON to move to root; omit the field to leave unchanged.
    pub parent_id: Option<Option<Uuid>>,
}

pub async fn update_folder(
    Extension(storage): Extension<Arc<dyn StorageAdapter>>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateFolderBody>,
) -> Result<Json<FolderResponse>, ApiError> {
    if let Some(ref name) = body.name {
        if name.trim().is_empty() {
            return Err(ApiError::bad_request("folder name cannot be empty"));
        }
        storage
            .rename_folder(id, name.trim())
            .await
            .map_err(|_| ApiError::not_found(format!("folder {id}")))?;
    }

    if let Some(new_parent) = body.parent_id {
        storage
            .move_folder(id, new_parent)
            .await
            .map_err(|_| ApiError::not_found(format!("folder {id}")))?;
    }

    let folder = storage
        .get_folder(id)
        .await
        .map_err(|_| ApiError::not_found(format!("folder {id}")))?;

    Ok(Json(FolderResponse::from(folder)))
}

// ── DELETE /folders/:id ───────────────────────────────────────────────────────

pub async fn delete_folder(
    Extension(storage): Extension<Arc<dyn StorageAdapter>>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    storage
        .delete_folder(id)
        .await
        .map_err(|_| ApiError::not_found(format!("folder {id}")))?;

    Ok(StatusCode::NO_CONTENT)
}

// ── PUT /documents/:id/folder ─────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveDocumentBody {
    /// `null` moves the document to root.
    pub folder_id: Option<Uuid>,
}

pub async fn move_document_to_folder(
    Extension(storage): Extension<Arc<dyn StorageAdapter>>,
    Path(doc_id): Path<Uuid>,
    Json(body): Json<MoveDocumentBody>,
) -> Result<StatusCode, ApiError> {
    // Verify the document exists.
    storage
        .get_document(doc_id)
        .await
        .map_err(|_| ApiError::not_found(format!("document {doc_id}")))?;

    // Verify the target folder exists (if non-root).
    if let Some(fid) = body.folder_id {
        storage
            .get_folder(fid)
            .await
            .map_err(|_| ApiError::not_found(format!("folder {fid}")))?;
    }

    storage
        .move_document_to_folder(doc_id, body.folder_id)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;

    Ok(StatusCode::NO_CONTENT)
}

// ── GET /documents?folderId=… ─────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderFilterQuery {
    pub folder_id: Option<String>,
}

/// Returns `Some(None)` for `?folderId=root`, `Some(Some(uuid))` for a specific
/// folder, and `None` when the query param is absent (caller should list all).
pub fn parse_folder_filter(
    query: &FolderFilterQuery,
) -> Result<Option<Option<Uuid>>, ApiError> {
    match query.folder_id.as_deref() {
        None => Ok(None),
        Some("root") => Ok(Some(None)),
        Some(s) => {
            let id = Uuid::parse_str(s)
                .map_err(|_| ApiError::bad_request(format!("invalid folderId: {s}")))?;
            Ok(Some(Some(id)))
        }
    }
}
