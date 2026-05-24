//! StorageAdapter trait and domain types.
//!
//! # BRD note
//! The brief placed this trait in `crates/kaya-storage`, but it lives here in
//! `kaya-core` to avoid a circular dependency: `commit_edit` (in `kaya-core`)
//! takes `Arc<dyn StorageAdapter>`, so the trait must be in a crate that neither
//! `kaya-storage` nor `kaya-core` imports. Moving it here keeps the dependency
//! graph acyclic. TODO: flag in BRD §8 revision.

use async_trait::async_trait;
use uuid::Uuid;

// ── Domain types ──────────────────────────────────────────────────────────────

/// A folder that groups documents. Folders form an optional hierarchy via
/// `parent_id`; a `None` parent means the folder sits at the root.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Folder {
    pub id: Uuid,
    pub name: String,
    pub parent_id: Option<Uuid>,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
}

/// A knowledge-base document stored in the database.
///
/// Frontmatter fields follow FR-1 / FR-2 from the BRD. The `body` field holds
/// the raw Markdown text.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Document {
    /// Stable UUID (FR-2). Never changes.
    pub id: Uuid,
    /// Document title (required).
    pub title: String,
    /// Optional owner.
    pub owner: Option<String>,
    /// Optional ISO date of last review.
    pub last_reviewed: Option<chrono::NaiveDate>,
    /// Tag list.
    pub tags: Vec<String>,
    /// UUIDs of related documents.
    pub related_docs: Vec<Uuid>,
    /// Raw Markdown body.
    pub body: String,
    /// Folder this document belongs to (`None` = root / unfoldered).
    #[serde(default)]
    pub folder_id: Option<Uuid>,
}

/// A paragraph chunk extracted from a document body.
///
/// The `paragraph_id` is derived from `SHA-256(ordinal_bytes | content)` and
/// is stable across re-indexing runs as long as neither the paragraph's
/// position nor its content changes (FR-6).
#[derive(Debug, Clone)]
pub struct Chunk {
    pub document_id: Uuid,
    /// Stable ID: first 16 hex chars of `SHA-256(ordinal_le | content_utf8)`.
    pub paragraph_id: String,
    pub content: String,
    pub ordinal: u32,
}

/// A chunk returned from a text or vector search, ready for citation (FR-8).
#[derive(Debug, Clone)]
pub struct ChunkHit {
    pub document_id: Uuid,
    pub paragraph_id: String,
    pub content: String,
    pub ordinal: u32,
}

/// A vector embedding for a single chunk of a document.
#[derive(Debug, Clone)]
pub struct Embedding {
    pub document_id: Uuid,
    /// Stable paragraph identifier matching [`Chunk::paragraph_id`].
    pub paragraph_id: String,
    pub vector: Vec<f32>,
}

// ── Error ─────────────────────────────────────────────────────────────────────

/// Error type for storage operations.
#[derive(Debug, thiserror::Error)]
pub enum StorageError {
    /// The requested document does not exist.
    #[error("document not found: {0}")]
    NotFound(Uuid),

    /// The requested folder does not exist.
    #[error("folder not found: {0}")]
    FolderNotFound(Uuid),

    /// An underlying I/O or database error.
    #[error("backend error: {0}")]
    Backend(#[from] Box<dyn std::error::Error + Send + Sync>),
}

// ── Trait ─────────────────────────────────────────────────────────────────────

/// Abstracts over SQLite (OSS) and Postgres (cloud) storage backends.
///
/// The trait is object-safe: all methods take `&self` and return boxed futures
/// via `async_trait`. Implementations must be `Send + Sync`.
///
/// The `SqliteAdapter` implementation lives in `crates/kaya-storage`.
#[async_trait]
pub trait StorageAdapter: Send + Sync {
    // ── Documents ─────────────────────────────────────────────────────────────

    /// Retrieve a document by its ID. Always reads from disk in OSS mode.
    async fn get_document(&self, id: Uuid) -> Result<Document, StorageError>;

    /// Persist a document, inserting or replacing by ID.
    async fn save_document(&self, doc: &Document) -> Result<(), StorageError>;

    /// Remove a document by ID. No-op if the document does not exist.
    async fn delete_document(&self, id: Uuid) -> Result<(), StorageError>;

    /// Purge derived retrieval data for a previously deleted document.
    ///
    /// This is intended for background cleanup after [`delete_document`]
    /// marks the document deleted. Implementations should remove any chunk,
    /// FTS, or embedding state that could otherwise accumulate indefinitely.
    async fn cleanup_deleted_document(&self, _id: Uuid) -> Result<(), StorageError> {
        Ok(())
    }

    /// Return all non-deleted documents.
    async fn list_documents(&self) -> Result<Vec<Document>, StorageError>;

    /// Return all non-deleted documents in a specific folder.
    /// Pass `None` to list documents that have no folder (root).
    async fn list_documents_in_folder(
        &self,
        folder_id: Option<Uuid>,
    ) -> Result<Vec<Document>, StorageError> {
        let all = self.list_documents().await?;
        Ok(all
            .into_iter()
            .filter(|d| d.folder_id == folder_id)
            .collect())
    }

    /// Move a document into a folder (or to root when `folder_id` is `None`).
    async fn move_document_to_folder(
        &self,
        _doc_id: Uuid,
        _folder_id: Option<Uuid>,
    ) -> Result<(), StorageError> {
        Err(StorageError::Backend(Box::new(std::io::Error::other(
            "move_document_to_folder not implemented for this adapter",
        ))))
    }

    // ── Folders ───────────────────────────────────────────────────────────────

    /// Create a new folder. `parent_id = None` creates a root folder.
    async fn create_folder(
        &self,
        _name: &str,
        _parent_id: Option<Uuid>,
    ) -> Result<Folder, StorageError> {
        Err(StorageError::Backend(Box::new(std::io::Error::other(
            "create_folder not implemented for this adapter",
        ))))
    }

    /// Retrieve a single folder by ID.
    async fn get_folder(&self, _id: Uuid) -> Result<Folder, StorageError> {
        Err(StorageError::Backend(Box::new(std::io::Error::other(
            "get_folder not implemented for this adapter",
        ))))
    }

    /// Return all folders (flat list; callers build the tree from `parent_id`).
    async fn list_folders(&self) -> Result<Vec<Folder>, StorageError> {
        Ok(vec![])
    }

    /// Rename a folder.
    async fn rename_folder(&self, _id: Uuid, _name: &str) -> Result<Folder, StorageError> {
        Err(StorageError::Backend(Box::new(std::io::Error::other(
            "rename_folder not implemented for this adapter",
        ))))
    }

    /// Move a folder to a new parent (`None` = move to root).
    async fn move_folder(
        &self,
        _id: Uuid,
        _new_parent_id: Option<Uuid>,
        _new_index: Option<usize>,
    ) -> Result<Folder, StorageError> {
        Err(StorageError::Backend(Box::new(std::io::Error::other(
            "move_folder not implemented for this adapter",
        ))))
    }

    /// Delete a folder. All documents inside are moved to root (folder_id = NULL).
    async fn delete_folder(&self, _id: Uuid) -> Result<(), StorageError> {
        Err(StorageError::Backend(Box::new(std::io::Error::other(
            "delete_folder not implemented for this adapter",
        ))))
    }

    // ── Chunks and text index ─────────────────────────────────────────────────

    /// Store a chunk in the metadata table and the FTS5 full-text index.
    async fn save_chunk(&self, chunk: &Chunk) -> Result<(), StorageError>;

    /// Delete all chunks (metadata + FTS5 rows) for a document.
    ///
    /// Called before re-indexing a document so the FTS5 table stays
    /// consistent. Embeddings are managed separately via
    /// [`delete_embeddings_for_paragraphs`](Self::delete_embeddings_for_paragraphs).
    async fn delete_chunks_for_document(&self, document_id: Uuid) -> Result<(), StorageError>;

    /// Return `(paragraph_id, content_hash)` pairs for all stored chunks of a
    /// document. Used by [`retrieval::index_document_chunks`] to detect which
    /// paragraphs have changed and must be re-embedded (FR-6).
    async fn get_chunk_hashes(
        &self,
        document_id: Uuid,
    ) -> Result<Vec<(String, String)>, StorageError>;

    /// BM25 full-text search over chunks via SQLite FTS5 (FR-7).
    ///
    /// `query` is passed directly to FTS5; callers should avoid FTS5 special
    /// characters (`*`, `"`, `^`, `:`) or escape them before calling.
    async fn search_text(&self, query: &str, limit: usize) -> Result<Vec<ChunkHit>, StorageError>;

    // ── Embeddings ────────────────────────────────────────────────────────────

    /// Persist a vector embedding for a chunk, replacing any existing row.
    async fn save_embeddings(&self, embedding: &Embedding) -> Result<(), StorageError>;

    /// Delete embeddings for specific (document_id, paragraph_id) pairs.
    ///
    /// Called when paragraphs are edited or removed so stale vectors do not
    /// pollute the vector index (FR-6).
    async fn delete_embeddings_for_paragraphs(
        &self,
        document_id: Uuid,
        paragraph_ids: &[String],
    ) -> Result<(), StorageError>;

    /// Vector search: find the `limit` nearest chunks to `query` by cosine
    /// similarity and return them ranked best-first (FR-7).
    ///
    /// In OSS mode this loads all embeddings and computes cosine similarity in
    /// Rust. The cloud mode replaces this with a sqlite-vec / pgvector query.
    async fn search_embeddings(
        &self,
        query: &[f32],
        limit: usize,
    ) -> Result<Vec<ChunkHit>, StorageError>;
}
