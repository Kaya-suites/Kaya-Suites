//! Concrete tool implementations (FR-13).

mod create_document;
mod create_folder;
mod delete_document;
mod find_stale_references;
mod list_documents;
mod propose_edit;
mod read_document;
mod search_directories;
mod search_documents;
mod update_document;

pub use create_document::CreateDocument;
pub use create_folder::CreateFolder;
pub use delete_document::DeleteDocument;
pub use find_stale_references::FindStaleReferences;
pub use list_documents::ListDocuments;
pub use propose_edit::ProposeEdit;
pub use read_document::ReadDocument;
pub use search_directories::SearchDirectories;
pub use search_documents::SearchDocuments;
pub use update_document::UpdateDocument;

use super::tool::{ReadTool, WriteTool};
use std::sync::Arc;

// ── Marker trait implementations ──────────────────────────────────────────────

impl ReadTool for SearchDocuments {}
impl ReadTool for SearchDirectories {}
impl ReadTool for ReadDocument {}
impl ReadTool for ListDocuments {}
impl ReadTool for FindStaleReferences {}

impl WriteTool for CreateDocument {}
impl WriteTool for CreateFolder {}
impl WriteTool for DeleteDocument {}
impl WriteTool for ProposeEdit {}
impl WriteTool for UpdateDocument {}

// ── Tool set constructors ─────────────────────────────────────────────────────

/// Read-only tool set for the `Researcher` agent.
pub fn read_tools() -> Vec<Arc<dyn ReadTool>> {
    vec![
        Arc::new(SearchDocuments),
        Arc::new(SearchDirectories),
        Arc::new(ReadDocument),
        Arc::new(ListDocuments),
        Arc::new(FindStaleReferences),
    ]
}

/// Write-only tool set for the `Editor` agent.
pub fn write_tools() -> Vec<Arc<dyn WriteTool>> {
    vec![
        Arc::new(CreateDocument),
        Arc::new(CreateFolder),
        Arc::new(DeleteDocument),
        Arc::new(ProposeEdit),
        Arc::new(UpdateDocument),
    ]
}
