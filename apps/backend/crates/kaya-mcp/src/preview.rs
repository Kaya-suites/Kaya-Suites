// Copyright 2024 Kaya Suites. Licensed under the Apache License, Version 2.0.
//! Render a `ProposedEdit` into a JSON preview Claude can display to the user.
//!
//! Filled in by chunk 2 (tool registry).

use kaya_core::{ProposedEdit, ProposedEditKind};
use serde_json::{Value, json};

/// Build a `{ edit_id, kind, preview }` payload from a pending edit.
pub fn render(edit: &ProposedEdit) -> Value {
    let (kind, preview) = match &edit.kind {
        ProposedEditKind::Create { title, body, folder_id } => (
            "create_document",
            json!({ "title": title, "body": body, "folder_id": folder_id }),
        ),
        ProposedEditKind::UpdateContent { document_id, new_content } => (
            "update_document",
            json!({ "document_id": document_id, "new_content": new_content }),
        ),
        ProposedEditKind::Modify { document_id, new_body, .. } => (
            "modify_document",
            json!({ "document_id": document_id, "new_body": new_body }),
        ),
        ProposedEditKind::DeleteDocument { document_id } => (
            "delete_document",
            json!({ "document_id": document_id }),
        ),
        ProposedEditKind::CreateFolder { name, parent_id } => (
            "create_folder",
            json!({ "name": name, "parent_id": parent_id }),
        ),
    };
    json!({ "edit_id": edit.id, "kind": kind, "preview": preview })
}
