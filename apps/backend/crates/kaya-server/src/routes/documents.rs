use std::sync::Arc;

use axum::{
    Json,
    body::Body,
    extract::{Extension, Path, Query},
    http::{StatusCode, header},
    response::Response,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use kaya_core::{
    DocumentEmbeddingStatus, EmbeddingTaskContext, SessionStorage, StorageAdapter,
    model_router::ModelRouter,
    retrieval::{chunk_document, index_document_chunks},
};

use crate::error::ApiError;
use crate::routes::folders::{FolderFilterQuery, parse_folder_filter};

// ── GET /documents ────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DocumentSummary {
    id: Uuid,
    title: String,
    tags: Vec<String>,
    last_reviewed: Option<String>,
    folder_id: Option<Uuid>,
}

pub async fn list_documents(
    Extension(storage): Extension<Arc<dyn StorageAdapter>>,
    Query(query): Query<FolderFilterQuery>,
) -> Result<Json<Vec<DocumentSummary>>, ApiError> {
    let folder_filter = parse_folder_filter(&query)?;

    let docs = match folder_filter {
        None => storage.list_documents().await,
        Some(folder_id) => storage.list_documents_in_folder(folder_id).await,
    }
    .map_err(|e| ApiError::internal(e.to_string()))?;

    Ok(Json(
        docs.into_iter()
            .map(|d| DocumentSummary {
                id: d.id,
                title: d.title,
                tags: d.tags,
                last_reviewed: d.last_reviewed.map(|dt| dt.to_string()),
                folder_id: d.folder_id,
            })
            .collect(),
    ))
}

// ── POST /documents ───────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct CreateDocumentBody {
    pub title: String,
    pub content: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub folder_id: Option<Uuid>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DocumentResponse {
    id: Uuid,
    title: String,
    body: String,
    tags: Vec<String>,
    last_reviewed: Option<String>,
    folder_id: Option<Uuid>,
}

pub async fn create_document(
    Extension(storage): Extension<Arc<dyn StorageAdapter>>,
    Extension(sessions): Extension<Arc<dyn SessionStorage>>,
    Extension(llm): Extension<Option<Arc<ModelRouter>>>,
    Json(body): Json<CreateDocumentBody>,
) -> Result<(StatusCode, Json<DocumentResponse>), ApiError> {
    let doc = kaya_core::storage::Document {
        id: Uuid::new_v4(),
        title: body.title,
        body: body.content,
        tags: body.tags,
        owner: None,
        last_reviewed: None,
        related_docs: vec![],
        folder_id: body.folder_id,
    };

    storage
        .save_document(&doc)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;

    let response = DocumentResponse {
        id: doc.id,
        title: doc.title.clone(),
        body: doc.body.clone(),
        tags: doc.tags.clone(),
        last_reviewed: None,
        folder_id: doc.folder_id,
    };

    if let Some(router) = llm {
        let storage = storage.clone();
        let sessions = sessions.clone();
        let id = doc.id;
        let task_id = Uuid::new_v4().to_string();
        let _ = sessions
            .upsert_document_embedding_status(&DocumentEmbeddingStatus {
                document_id: doc.id,
                task_id: Some(task_id.clone()),
                status: "queued".to_string(),
                expected_chunks: chunk_document(&doc).len() as u32,
                embedded_chunks: 0,
                last_error: None,
                updated_at: chrono::Utc::now().timestamp_millis(),
                last_indexed_at: None,
            })
            .await;
        tokio::spawn(async move {
            if let Err(e) = index_document_chunks(
                &doc,
                &storage,
                &router,
                Some(sessions.as_ref()),
                Some(&EmbeddingTaskContext {
                    task_id: Some(task_id),
                    task_type: "document_index".to_string(),
                    session_id: None,
                    document_id: Some(doc.id),
                }),
            )
            .await
            {
                tracing::error!(document_id = %id, error = %e, "reindex failed after create");
            }
        });
    }

    Ok((StatusCode::CREATED, Json(response)))
}

// ── GET /documents/:id ────────────────────────────────────────────────────────

pub async fn get_document(
    Extension(storage): Extension<Arc<dyn StorageAdapter>>,
    Path(id): Path<Uuid>,
) -> Result<Json<DocumentResponse>, ApiError> {
    let doc = storage
        .get_document(id)
        .await
        .map_err(|_| ApiError::not_found(format!("document {id}")))?;

    Ok(Json(DocumentResponse {
        id: doc.id,
        title: doc.title,
        body: doc.body,
        tags: doc.tags,
        last_reviewed: doc.last_reviewed.map(|dt| dt.to_string()),
        folder_id: doc.folder_id,
    }))
}

// ── PUT /documents/:id ────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct UpdateDocumentBody {
    pub title: Option<String>,
    pub body: Option<String>,
    pub tags: Option<Vec<String>>,
}

pub async fn update_document(
    Extension(storage): Extension<Arc<dyn StorageAdapter>>,
    Extension(sessions): Extension<Arc<dyn SessionStorage>>,
    Extension(llm): Extension<Option<Arc<ModelRouter>>>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateDocumentBody>,
) -> Result<Json<DocumentResponse>, ApiError> {
    let mut doc = storage
        .get_document(id)
        .await
        .map_err(|_| ApiError::not_found(format!("document {id}")))?;

    if let Some(title) = body.title {
        doc.title = title;
    }
    if let Some(new_body) = body.body {
        doc.body = new_body;
    }
    if let Some(tags) = body.tags {
        doc.tags = tags;
    }

    storage
        .save_document(&doc)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;

    let response = Json(DocumentResponse {
        id: doc.id,
        title: doc.title.clone(),
        body: doc.body.clone(),
        tags: doc.tags.clone(),
        last_reviewed: doc.last_reviewed.map(|dt| dt.to_string()),
        folder_id: doc.folder_id,
    });

    if let Some(router) = llm {
        let storage = storage.clone();
        let sessions = sessions.clone();
        let task_id = Uuid::new_v4().to_string();
        let _ = sessions
            .upsert_document_embedding_status(&DocumentEmbeddingStatus {
                document_id: doc.id,
                task_id: Some(task_id.clone()),
                status: "queued".to_string(),
                expected_chunks: chunk_document(&doc).len() as u32,
                embedded_chunks: 0,
                last_error: None,
                updated_at: chrono::Utc::now().timestamp_millis(),
                last_indexed_at: None,
            })
            .await;
        tokio::spawn(async move {
            if let Err(e) = index_document_chunks(
                &doc,
                &storage,
                &router,
                Some(sessions.as_ref()),
                Some(&EmbeddingTaskContext {
                    task_id: Some(task_id),
                    task_type: "document_index".to_string(),
                    session_id: None,
                    document_id: Some(doc.id),
                }),
            )
            .await
            {
                tracing::error!(document_id = %id, error = %e, "reindex failed after update");
            }
        });
    }

    Ok(response)
}

// ── DELETE /documents/:id ─────────────────────────────────────────────────────

pub async fn delete_document(
    Extension(storage): Extension<Arc<dyn StorageAdapter>>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    storage
        .get_document(id)
        .await
        .map_err(|_| ApiError::not_found(format!("document {id}")))?;
    storage
        .delete_document(id)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;

    let cleanup_storage = Arc::clone(&storage);
    tokio::spawn(async move {
        if let Err(err) = cleanup_storage.cleanup_deleted_document(id).await {
            tracing::error!(document_id = %id, error = %err, "background document cleanup failed");
        }
    });

    Ok(StatusCode::NO_CONTENT)
}

// ── GET /documents/:id/export.pdf ─────────────────────────────────────────────

pub async fn export_document_pdf(
    Extension(storage): Extension<Arc<dyn StorageAdapter>>,
    Path(id): Path<Uuid>,
) -> Result<Response, ApiError> {
    let doc = storage
        .get_document(id)
        .await
        .map_err(|_| ApiError::not_found(format!("document {id}")))?;

    let pdf = minimal_pdf(&doc.title, &doc.body);
    let filename = sanitize_filename(&doc.title) + ".pdf";

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/pdf")
        .header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{filename}\""),
        )
        .body(Body::from(pdf))
        .unwrap())
}

// ── PDF helpers ───────────────────────────────────────────────────────────────

fn minimal_pdf(title: &str, body: &str) -> Vec<u8> {
    let safe_title = title.replace(['(', ')', '\\', '\n', '\r'], " ");
    let safe_body: String = body
        .chars()
        .take(300)
        .map(|c| {
            if c == '(' || c == ')' || c == '\\' {
                ' '
            } else {
                c
            }
        })
        .collect();

    let stream_text =
        format!("BT /F1 14 Tf 50 750 Td ({safe_title}) Tj 0 -20 Td /F1 10 Tf ({safe_body}) Tj ET");
    let header = format!(
        "%PDF-1.4\n\
         1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n\
         2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n\
         3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R\
                   /Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj\n\
         4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n"
    );
    let content = format!(
        "5 0 obj\n<</Length {}>>\nstream\n{stream_text}\nendstream\nendobj\n",
        stream_text.len()
    );
    let body_str = header + &content;
    let xref_offset = body_str.len();
    let trailer = format!(
        "\nxref\n0 6\n0000000000 65535 f \n\
         trailer\n<</Size 6/Root 1 0 R>>\nstartxref\n{xref_offset}\n%%EOF"
    );
    (body_str + &trailer).into_bytes()
}

fn sanitize_filename(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect::<String>()
        .to_lowercase()
}
