use std::collections::HashMap;
use std::sync::Arc;

use axum::{
    Json,
    extract::{Extension, Path},
};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::sync::Mutex;
use uuid::Uuid;

use kaya_core::{
    DocumentEmbeddingStatus, EmbeddingTaskContext, ProposedEditKind, SessionStorage,
    StorageAdapter,
    auth::UserSession,
    edit::commit_edit,
    model_router::ModelRouter,
    retrieval::{chunk_document, index_document_chunks},
    session::EditHistoryEntry,
    storage::Folder,
};

use crate::error::ApiError;
use crate::state::StoredEdit;

/// Drain the pending edit either from the in-memory map (hot path) or — if
/// the process restarted since the proposal — from `pending_edits` storage,
/// where `chat::save_stored_edit` mirrors every insert. Returns 404 only when
/// neither source has it (already consumed, double-click, or unknown id).
async fn take_pending_edit(
    pending_edits: &Arc<Mutex<HashMap<Uuid, StoredEdit>>>,
    sessions: &Arc<dyn SessionStorage>,
    edit_id: Uuid,
) -> Result<StoredEdit, ApiError> {
    if let Some(stored) = pending_edits.lock().await.remove(&edit_id) {
        // The DB row may still exist (write-through, not write-back) — clear it
        // so a future bogus approve can't resurrect a consumed edit.
        let _ = sessions.take_pending_edit(edit_id).await;
        return Ok(stored);
    }
    let payload = sessions
        .take_pending_edit(edit_id)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?
        .ok_or_else(|| ApiError::not_found(format!("edit {edit_id}")))?;
    serde_json::from_str::<StoredEdit>(&payload)
        .map_err(|e| ApiError::internal(format!("deserialize pending edit: {e}")))
}

#[derive(Deserialize)]
pub struct ApproveBody {
    pub proposed: Option<String>,
}

#[derive(Deserialize)]
pub struct RejectBody {
    pub proposed: Option<String>,
}

pub async fn approve_edit(
    Extension(storage): Extension<Arc<dyn StorageAdapter>>,
    Extension(sessions): Extension<Arc<dyn SessionStorage>>,
    Extension(llm): Extension<Option<Arc<ModelRouter>>>,
    Extension(pending_edits): Extension<Arc<Mutex<HashMap<Uuid, StoredEdit>>>>,
    Path(edit_id): Path<Uuid>,
    Json(body): Json<ApproveBody>,
) -> Result<Json<Value>, ApiError> {
    let stored = take_pending_edit(&pending_edits, &sessions, edit_id).await?;

    let final_proposed = body
        .proposed
        .as_deref()
        .unwrap_or(&stored.proposed_paragraph);
    let history_entry = build_edit_history_entry(&stored, "approved", final_proposed);

    let edit = if final_proposed != stored.proposed_paragraph {
        apply_user_modification(stored.edit, &stored.proposed_paragraph, final_proposed)
    } else {
        stored.edit
    };

    // Capture the edit kind before `commit_edit` consumes the value.
    let is_folder_create = matches!(&edit.kind, ProposedEditKind::CreateFolder { .. });

    let session = UserSession {
        user_id: Uuid::nil(),
    };
    let token = session.approve_edit(&edit);

    let affected_id = commit_edit(edit, token, storage.clone())
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    let _ = sessions
        .upsert_edit_history_entry(stored.session_id, &history_entry)
        .await;
    let _ = sessions
        .update_proposal_status(&stored.message_id, edit_id, "approved")
        .await;

    // Folder creates: return the new folder so the frontend can update its tree.
    if is_folder_create {
        if let Some(folder_id) = affected_id {
            if let Ok(folder) = storage.get_folder(folder_id).await {
                return Ok(Json(folder_to_json(&folder)));
            }
        }
        return Ok(Json(json!({"ok": true})));
    }

    // Document changes: trigger background re-indexing.
    if let (Some(doc_id), Some(router)) = (affected_id, llm) {
        let storage = storage.clone();
        let sessions = sessions.clone();
        tokio::spawn(async move {
            match storage.get_document(doc_id).await {
                Ok(doc) => {
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
                        tracing::error!(document_id = %doc_id, error = %e, "reindex failed after approve");
                    }
                }
                Err(e) => {
                    tracing::error!(document_id = %doc_id, error = %e, "get_document failed after approve")
                }
            }
        });
    }

    Ok(Json(json!({"ok": true})))
}

pub async fn reject_edit(
    Extension(sessions): Extension<Arc<dyn SessionStorage>>,
    Extension(pending_edits): Extension<Arc<Mutex<HashMap<Uuid, StoredEdit>>>>,
    Path(edit_id): Path<Uuid>,
    Json(body): Json<RejectBody>,
) -> Result<Json<Value>, ApiError> {
    let stored = take_pending_edit(&pending_edits, &sessions, edit_id).await?;

    let final_proposed = body
        .proposed
        .as_deref()
        .unwrap_or(&stored.proposed_paragraph);

    let _ = sessions
        .upsert_edit_history_entry(
            stored.session_id,
            &build_edit_history_entry(&stored, "rejected", final_proposed),
        )
        .await;
    let _ = sessions
        .update_proposal_status(&stored.message_id, edit_id, "rejected")
        .await;

    Ok(Json(json!({"ok": true})))
}

fn folder_to_json(f: &Folder) -> Value {
    json!({
        "ok": true,
        "folder": {
            "id": f.id,
            "name": f.name,
            "parentId": f.parent_id,
            "createdAt": f.created_at,
            "updatedAt": f.updated_at,
        }
    })
}

fn apply_user_modification(
    mut edit: kaya_core::ProposedEdit,
    original: &str,
    user_text: &str,
) -> kaya_core::ProposedEdit {
    if let ProposedEditKind::Modify {
        ref mut new_body, ..
    } = edit.kind
    {
        *new_body = new_body.replacen(original, user_text, 1);
    }
    edit
}

fn build_edit_history_entry(
    stored: &StoredEdit,
    status: &str,
    proposed_text: &str,
) -> EditHistoryEntry {
    let now = chrono::Utc::now().timestamp_millis();
    EditHistoryEntry {
        edit_id: stored.edit.id.to_string(),
        kind: edit_kind_label(&stored.edit.kind).to_string(),
        status: status.to_string(),
        summary: edit_summary(stored, proposed_text),
        created_at: now,
        updated_at: now,
    }
}

fn edit_kind_label(kind: &ProposedEditKind) -> &'static str {
    match kind {
        ProposedEditKind::Modify { .. } => "modify",
        ProposedEditKind::Create { .. } => "create_document",
        ProposedEditKind::UpdateContent { .. } => "update_content",
        ProposedEditKind::DeleteDocument { .. } => "delete_document",
        ProposedEditKind::CreateFolder { .. } => "create_folder",
    }
}

fn edit_summary(stored: &StoredEdit, proposed_text: &str) -> String {
    match &stored.edit.kind {
        ProposedEditKind::Modify { .. } | ProposedEditKind::UpdateContent { .. } => {
            let doc = if stored.doc_title.is_empty() {
                "document".to_string()
            } else {
                format!("document \"{}\"", truncate_text(&stored.doc_title, 80))
            };
            format!(
                "Updated {doc}. Original: {} Proposed: {}",
                truncate_text(&stored.original_paragraph, 120),
                truncate_text(proposed_text, 120)
            )
        }
        ProposedEditKind::Create { title, body, .. } => format!(
            "Created document \"{}\" with draft content: {}",
            truncate_text(title, 80),
            truncate_text(body, 120)
        ),
        ProposedEditKind::DeleteDocument { .. } => {
            if stored.doc_title.is_empty() {
                "Deleted a document.".to_string()
            } else {
                format!("Deleted document \"{}\".", truncate_text(&stored.doc_title, 80))
            }
        }
        ProposedEditKind::CreateFolder { name, parent_id } => {
            if parent_id.is_some() {
                format!("Created folder \"{}\" inside an existing parent.", truncate_text(name, 80))
            } else {
                format!("Created root folder \"{}\".", truncate_text(name, 80))
            }
        }
    }
}

fn truncate_text(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }

    let mut out = text.chars().take(max_chars).collect::<String>();
    out.push_str("...");
    out
}
