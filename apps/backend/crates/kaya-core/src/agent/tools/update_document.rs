//! `update_document` — replace a document's full body, producing a [`ProposedEdit::UpdateContent`].

use async_trait::async_trait;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::agent::{
    AgentContext,
    tool::{Tool, ToolOutput},
};
use crate::diff::compute_paragraph_diff;
use crate::edit::{ProposedEdit, ProposedEditKind};
use crate::error::KayaError;

pub struct UpdateDocument;

#[async_trait]
impl Tool for UpdateDocument {
    fn name(&self) -> &'static str {
        "update_document"
    }

    fn description(&self) -> &'static str {
        "Propose replacing the full body of an existing document. Use this when \
         propose_edit cannot match exact text (e.g. removing a whole section or \
         a Mermaid/code block). Read the document first, make your changes to the \
         body, then call this tool with the complete new body. The change is NOT \
         applied until the user explicitly approves the proposal."
    }

    fn schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["document_id", "new_body"],
            "properties": {
                "document_id": {
                    "type": "string",
                    "format": "uuid",
                    "description": "UUID of the document to update."
                },
                "new_body": {
                    "type": "string",
                    "description": "Complete new Markdown body for the document."
                },
                "reason": {
                    "type": "string",
                    "description": "Short explanation of why this change is being proposed."
                }
            }
        })
    }

    async fn invoke(&self, input: Value, ctx: &AgentContext) -> Result<ToolOutput, KayaError> {
        let id_str = input["document_id"]
            .as_str()
            .ok_or_else(|| KayaError::Internal("update_document: missing 'document_id'".into()))?;
        let document_id: Uuid = id_str.parse().map_err(|_| {
            KayaError::Internal(format!("update_document: invalid UUID '{id_str}'"))
        })?;
        let new_content = input["new_body"]
            .as_str()
            .ok_or_else(|| KayaError::Internal("update_document: missing 'new_body'".into()))?
            .to_owned();
        let reason = input["reason"].as_str().unwrap_or("").to_owned();

        let current = ctx.storage.get_document(document_id).await?;
        let diff = compute_paragraph_diff(&current.body, &new_content);
        let changes = diff.changes.len();

        let edit = ProposedEdit {
            id: Uuid::new_v4(),
            kind: ProposedEditKind::UpdateContent {
                document_id,
                new_content,
            },
        };
        let edit_id = edit.id;

        Ok(ToolOutput::with_edit(
            json!({
                "proposed_edit_id": edit_id,
                "action": "update_content",
                "document_id": document_id,
                "reason": reason,
                "changes": changes,
                "status": "pending_approval",
            }),
            edit,
        ))
    }
}
