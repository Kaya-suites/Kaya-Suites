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
    DocumentEmbeddingStatus, EmbeddingTaskContext, ProposedEdit, ProposedEditKind,
    SessionStorage, StorageAdapter,
    auth::UserSession,
    diff::{ParagraphChange, ParagraphDiff},
    edit::commit_edit,
    model_router::ModelRouter,
    retrieval::{chunk_document, index_document_chunks},
    session::EditHistoryEntry,
    storage::Folder,
};

use crate::error::ApiError;
use crate::state::StoredEdit;

/// Drain the pending edit from the first available source:
/// 1. the in-memory map (hot path during a single backend lifetime),
/// 2. the `pending_edits` table (mirrored on insert; survives a restart),
/// 3. as a last resort, reconstructed from `chat_messages.proposals` (the
///    display projection persisted long before pending_edits existed).
///
/// (3) handles edits proposed by an older build that never wrote the full
/// `StoredEdit` payload anywhere — we have enough information in the
/// display projection (kind/docId/paragraphId/original/proposed) to rebuild
/// a `ProposedEdit` that `commit_edit` will accept. Returns 404 only when
/// no source has it.
async fn take_pending_edit(
    pending_edits: &Arc<Mutex<HashMap<Uuid, StoredEdit>>>,
    storage: &Arc<dyn StorageAdapter>,
    sessions: &Arc<dyn SessionStorage>,
    edit_id: Uuid,
) -> Result<StoredEdit, ApiError> {
    if let Some(stored) = pending_edits.lock().await.remove(&edit_id) {
        let _ = sessions.take_pending_edit(edit_id).await;
        return Ok(stored);
    }

    if let Some(payload) = sessions
        .take_pending_edit(edit_id)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?
    {
        return serde_json::from_str::<StoredEdit>(&payload)
            .map_err(|e| ApiError::internal(format!("deserialize pending edit: {e}")));
    }

    if let Some(stored) = reconstruct_from_proposal(storage, sessions, edit_id).await? {
        tracing::info!(%edit_id, "reconstructed pending edit from chat_messages.proposals");
        return Ok(stored);
    }

    Err(ApiError::not_found(format!("edit {edit_id}")))
}

/// Recovery path for proposals that predate the `pending_edits` table.
/// Reads the display-projection record (`{kind, docId, paragraphId, original,
/// proposed, ...}`) out of `chat_messages.proposals`, and rebuilds the
/// `StoredEdit` the approve handler needs. `kind` covers `edit` (Modify when
/// docId is set, Create when null), `delete`, and `folderCreate`.
async fn reconstruct_from_proposal(
    storage: &Arc<dyn StorageAdapter>,
    sessions: &Arc<dyn SessionStorage>,
    edit_id: Uuid,
) -> Result<Option<StoredEdit>, ApiError> {
    let Some(lookup) = sessions
        .find_proposal_by_edit_id(edit_id)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?
    else {
        return Ok(None);
    };

    let proposal: serde_json::Value = serde_json::from_str(&lookup.proposal_json)
        .map_err(|e| ApiError::internal(format!("parse proposal: {e}")))?;
    let kind = proposal.get("kind").and_then(|v| v.as_str()).unwrap_or("");
    let doc_id_str = proposal.get("docId").and_then(|v| v.as_str());
    let paragraph_id = proposal
        .get("paragraphId")
        .and_then(|v| v.as_str())
        .unwrap_or("p0")
        .to_string();
    let original = proposal
        .get("original")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let proposed = proposal
        .get("proposed")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let (edit, doc_title) = match kind {
        "edit" => match doc_id_str {
            Some(s) => {
                let document_id = Uuid::parse_str(s)
                    .map_err(|e| ApiError::internal(format!("docId: {e}")))?;
                let doc = storage
                    .get_document(document_id)
                    .await
                    .map_err(|e| ApiError::internal(format!("get_document for reconstruct: {e}")))?;
                let new_body = if original.is_empty() {
                    proposed.clone()
                } else {
                    doc.body.replacen(&original, &proposed, 1)
                };
                let diff = ParagraphDiff {
                    changes: vec![ParagraphChange::Modify {
                        paragraph_id: paragraph_id.clone(),
                        old_text: original.clone(),
                        new_text: proposed.clone(),
                    }],
                };
                let pe = ProposedEdit {
                    id: edit_id,
                    kind: ProposedEditKind::Modify {
                        document_id,
                        diff,
                        new_body,
                    },
                };
                (pe, doc.title)
            }
            None => {
                let title = extract_title(&proposed);
                let pe = ProposedEdit {
                    id: edit_id,
                    kind: ProposedEditKind::Create {
                        title: title.clone(),
                        body: proposed.clone(),
                        folder_id: None,
                    },
                };
                (pe, title)
            }
        },
        "delete" => {
            let s = doc_id_str.ok_or_else(|| {
                ApiError::internal("delete proposal missing docId for reconstruct")
            })?;
            let document_id = Uuid::parse_str(s)
                .map_err(|e| ApiError::internal(format!("docId: {e}")))?;
            let doc_title = proposal
                .get("docTitle")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let pe = ProposedEdit {
                id: edit_id,
                kind: ProposedEditKind::DeleteDocument { document_id },
            };
            (pe, doc_title)
        }
        "folderCreate" => {
            let name = proposal
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("Untitled folder")
                .to_string();
            let parent_id = proposal
                .get("parentId")
                .and_then(|v| v.as_str())
                .and_then(|s| Uuid::parse_str(s).ok());
            let pe = ProposedEdit {
                id: edit_id,
                kind: ProposedEditKind::CreateFolder {
                    name: name.clone(),
                    parent_id,
                },
            };
            (pe, String::new())
        }
        other => {
            tracing::warn!(%edit_id, kind = %other, "unknown proposal kind in reconstruct");
            return Ok(None);
        }
    };

    Ok(Some(StoredEdit {
        session_id: lookup.session_id,
        message_id: lookup.message_id,
        edit,
        doc_title,
        first_paragraph_id: paragraph_id,
        original_paragraph: original,
        proposed_paragraph: proposed,
    }))
}

/// Pick a title for a reconstructed Create: first `# ` heading line, else
/// the first non-empty line, else `"Untitled"`.
fn extract_title(body: &str) -> String {
    for line in body.lines() {
        let l = line.trim();
        if let Some(rest) = l.strip_prefix("# ") {
            let t = rest.trim();
            if !t.is_empty() {
                return t.to_string();
            }
        }
    }
    for line in body.lines() {
        let l = line.trim();
        if !l.is_empty() {
            return truncate_text(l, 80);
        }
    }
    "Untitled".to_string()
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
    let stored = take_pending_edit(&pending_edits, &storage, &sessions, edit_id).await?;

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
    Extension(storage): Extension<Arc<dyn StorageAdapter>>,
    Extension(sessions): Extension<Arc<dyn SessionStorage>>,
    Extension(pending_edits): Extension<Arc<Mutex<HashMap<Uuid, StoredEdit>>>>,
    Path(edit_id): Path<Uuid>,
    Json(body): Json<RejectBody>,
) -> Result<Json<Value>, ApiError> {
    let stored = take_pending_edit(&pending_edits, &storage, &sessions, edit_id).await?;

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
