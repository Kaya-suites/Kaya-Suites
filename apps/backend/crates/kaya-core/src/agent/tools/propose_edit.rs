//! `propose_edit` — apply git-style hunks to produce a paragraph-level [`ProposedEdit::Modify`].

use async_trait::async_trait;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::agent::{
    AgentContext,
    tool::{Tool, ToolOutput},
};
use crate::diff::{Hunk, apply_hunks, compute_paragraph_diff};
use crate::edit::{ProposedEdit, ProposedEditKind};
use crate::error::KayaError;

pub struct ProposeEdit;

#[async_trait]
impl Tool for ProposeEdit {
    fn name(&self) -> &'static str {
        "propose_edit"
    }

    fn description(&self) -> &'static str {
        "Propose an edit to an existing document using one or more hunks (old_text → \
         new_text pairs). Each hunk must match its old_text verbatim in the current \
         document body. Hunks are applied in order. The change is NOT applied until \
         the user explicitly approves the proposal. The diff is rendered in the UI \
         for review."
    }

    fn schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["document_id", "hunks"],
            "properties": {
                "document_id": {
                    "type": "string",
                    "format": "uuid",
                    "description": "UUID of the document to edit."
                },
                "hunks": {
                    "type": "array",
                    "minItems": 1,
                    "description": "Ordered list of find-and-replace hunks to apply.",
                    "items": {
                        "type": "object",
                        "required": ["old_text", "new_text"],
                        "properties": {
                            "old_text": {
                                "type": "string",
                                "description": "Exact text to find in the document (must match verbatim)."
                            },
                            "new_text": {
                                "type": "string",
                                "description": "Replacement text."
                            }
                        }
                    }
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
            .ok_or_else(|| KayaError::Internal("propose_edit: missing 'document_id'".into()))?;
        let document_id: Uuid = id_str
            .parse()
            .map_err(|_| KayaError::Internal(format!("propose_edit: invalid UUID '{id_str}'")))?;

        let raw_hunks = input["hunks"]
            .as_array()
            .ok_or_else(|| KayaError::Internal("propose_edit: missing 'hunks' array".into()))?;

        let hunks: Vec<Hunk> = raw_hunks
            .iter()
            .enumerate()
            .map(|(i, h)| {
                let old_text = h["old_text"].as_str().ok_or_else(|| {
                    KayaError::Internal(format!("propose_edit: hunk {i} missing 'old_text'"))
                })?;
                let new_text = h["new_text"].as_str().ok_or_else(|| {
                    KayaError::Internal(format!("propose_edit: hunk {i} missing 'new_text'"))
                })?;
                Ok(Hunk {
                    old_text: old_text.to_owned(),
                    new_text: new_text.to_owned(),
                })
            })
            .collect::<Result<_, KayaError>>()?;

        let reason = input["reason"].as_str().unwrap_or("").to_owned();

        let current = ctx.storage.get_document(document_id).await?;
        let new_body = apply_hunks(&current.body, &hunks)
            .map_err(|e| KayaError::Internal(format!("propose_edit: {e}")))?;

        let diff = compute_paragraph_diff(&current.body, &new_body);
        let hunk_count = hunks.len();

        let edit = ProposedEdit {
            id: Uuid::new_v4(),
            kind: ProposedEditKind::Modify {
                document_id,
                diff: diff.clone(),
                new_body,
            },
        };
        let edit_id = edit.id;

        Ok(ToolOutput::with_edit(
            json!({
                "proposed_edit_id": edit_id,
                "action": "modify",
                "document_id": document_id,
                "reason": reason,
                "hunks_applied": hunk_count,
                "changes": diff.changes.len(),
                "status": "pending_approval",
            }),
            edit,
        ))
    }
}
