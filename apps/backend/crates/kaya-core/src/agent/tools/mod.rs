//! Concrete tool implementations (FR-13).

mod create_document;
mod delete_document;
mod find_stale_references;
mod list_documents;
mod propose_edit;
mod read_document;
mod search_documents;
mod update_document;

pub use create_document::CreateDocument;
pub use delete_document::DeleteDocument;
pub use find_stale_references::FindStaleReferences;
pub use list_documents::ListDocuments;
pub use propose_edit::ProposeEdit;
pub use read_document::ReadDocument;
pub use search_documents::SearchDocuments;
pub use update_document::UpdateDocument;

use super::tool::{ReadTool, Tool, WriteTool};
use std::sync::Arc;

// ── Marker trait implementations ──────────────────────────────────────────────

impl ReadTool for SearchDocuments {}
impl ReadTool for ReadDocument {}
impl ReadTool for ListDocuments {}
impl ReadTool for FindStaleReferences {}

impl WriteTool for CreateDocument {}
impl WriteTool for DeleteDocument {}
impl WriteTool for ProposeEdit {}
impl WriteTool for UpdateDocument {}

// ── Tool set constructors ─────────────────────────────────────────────────────

/// Build the default FR-13 tool set (all 8 tools, used by legacy `AgentLoop`).
pub fn default_tools() -> Vec<Arc<dyn Tool>> {
    vec![
        Arc::new(SearchDocuments),
        Arc::new(ReadDocument),
        Arc::new(ListDocuments),
        Arc::new(CreateDocument),
        Arc::new(DeleteDocument),
        Arc::new(ProposeEdit),
        Arc::new(UpdateDocument),
        Arc::new(FindStaleReferences),
    ]
}

/// Read-only tool set for the `Researcher` agent.
pub fn read_tools() -> Vec<Arc<dyn ReadTool>> {
    vec![
        Arc::new(SearchDocuments),
        Arc::new(ReadDocument),
        Arc::new(ListDocuments),
        Arc::new(FindStaleReferences),
    ]
}

/// Write-only tool set for the `Editor` agent.
pub fn write_tools() -> Vec<Arc<dyn WriteTool>> {
    vec![
        Arc::new(CreateDocument),
        Arc::new(DeleteDocument),
        Arc::new(ProposeEdit),
        Arc::new(UpdateDocument),
    ]
}
