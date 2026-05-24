//! `create_folder` — propose creating a new folder, pending user approval.

use async_trait::async_trait;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::agent::{
    AgentContext,
    tool::{Tool, ToolOutput},
};
use crate::edit::{ProposedEdit, ProposedEditKind};
use crate::error::KayaError;

pub struct CreateFolder;

#[async_trait]
impl Tool for CreateFolder {
    fn name(&self) -> &'static str {
        "create_folder"
    }

    fn description(&self) -> &'static str {
        "Propose creating a new folder to organise documents. The folder is NOT \
         created until the user explicitly approves the proposal. Optionally nest \
         it inside an existing folder by supplying parent_id."
    }

    fn schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["name"],
            "properties": {
                "name": {
                    "type": "string",
                    "description": "Display name for the new folder."
                },
                "parent_id": {
                    "type": "string",
                    "format": "uuid",
                    "description": "UUID of the parent folder. Omit to create a root-level folder."
                }
            }
        })
    }

    async fn invoke(&self, input: Value, ctx: &AgentContext) -> Result<ToolOutput, KayaError> {
        let name = input["name"]
            .as_str()
            .ok_or_else(|| KayaError::Internal("create_folder: missing 'name'".into()))?
            .to_owned();

        let parent_id = input["parent_id"]
            .as_str()
            .and_then(|s| s.parse::<Uuid>().ok())
            // Some model outputs use the nil UUID as a fake "root" sentinel.
            // Root folders are represented as `None` in storage, not `Uuid::nil()`.
            .filter(|id| *id != Uuid::nil());

        if let Some(parent_id) = parent_id {
            ctx.storage.get_folder(parent_id).await?;
        }

        let edit = ProposedEdit {
            id: Uuid::new_v4(),
            kind: ProposedEditKind::CreateFolder {
                name: name.clone(),
                parent_id,
            },
        };
        let edit_id = edit.id;

        Ok(ToolOutput::with_edit(
            json!({
                "proposed_edit_id": edit_id,
                "action": "create_folder",
                "name": name,
                "parent_id": parent_id,
                "status": "pending_approval",
            }),
            edit,
        ))
    }
}
