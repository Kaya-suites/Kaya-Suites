# StorageAdapter

**Trait location:** `apps/backend/crates/kaya-core/src/storage.rs`
**Implementations:** `apps/backend/crates/kaya-storage/src/{sqlite,postgres,mysql}.rs`

## Why it lives in `kaya-core`

`commit_edit` (in `kaya-core`) takes `Arc<dyn StorageAdapter>`, so the trait must live in a crate that `kaya-storage` can depend on — not the other way around. Moving the trait into `kaya-core` keeps the dependency graph acyclic.

## Domain types

### `Document`

A knowledge-base document.

| Field | Type | Description |
|---|---|---|
| `id` | `Uuid` | Stable UUID written into frontmatter. Never changes across renames. |
| `title` | `String` | Document title (frontmatter `title`, required). |
| `owner` | `Option<String>` | Optional owner (frontmatter `owner`). |
| `last_reviewed` | `Option<NaiveDate>` | Optional ISO date of last review. |
| `tags` | `Vec<String>` | Tag list. |
| `related_docs` | `Vec<Uuid>` | UUIDs of related documents. |
| `body` | `String` | Raw Markdown body after the closing `---` delimiter. |
| `path` | `Option<PathBuf>` | Path relative to content directory; `None` for in-memory documents. |

### `Chunk`

A paragraph extracted from a document body. The `paragraph_id` is the first 16 hex characters of `SHA-256(ordinal_le | content_utf8)`, making it stable across re-indexing runs as long as neither the paragraph's position nor content changes.

### `ChunkHit`

A chunk returned from text or vector search, ready for citation.

### `Embedding`

A vector embedding for a single chunk, matched to a `Chunk` by `paragraph_id`.

### `StorageError`

| Variant | Meaning |
|---|---|
| `NotFound(Uuid)` | Requested document does not exist. |
| `Backend(Box<dyn Error>)` | Underlying I/O or database error. |

## Trait surface

```rust
#[async_trait]
pub trait StorageAdapter: Send + Sync {
    // Documents
    async fn get_document(&self, id: Uuid) -> Result<Document, StorageError>;
    async fn save_document(&self, doc: &Document) -> Result<(), StorageError>;
    async fn delete_document(&self, id: Uuid) -> Result<(), StorageError>;
    async fn list_documents(&self) -> Result<Vec<Document>, StorageError>;

    // Chunks and text index
    async fn save_chunk(&self, chunk: &Chunk) -> Result<(), StorageError>;
    async fn delete_chunks_for_document(&self, document_id: Uuid) -> Result<(), StorageError>;
    async fn get_chunk_hashes(&self, document_id: Uuid) -> Result<Vec<(String, String)>, StorageError>;
    async fn search_text(&self, query: &str, limit: usize) -> Result<Vec<ChunkHit>, StorageError>;

    // Embeddings
    async fn save_embeddings(&self, embedding: &Embedding) -> Result<(), StorageError>;
    async fn delete_embeddings_for_paragraphs(&self, document_id: Uuid, paragraph_ids: &[String]) -> Result<(), StorageError>;
    async fn search_embeddings(&self, query: &[f32], limit: usize) -> Result<Vec<ChunkHit>, StorageError>;
}
```

## Implementations

### `SqliteAdapter`

**Location:** `crates/kaya-storage/src/sqlite.rs`

- Persists documents as `.md` files in a content directory and indexes metadata in SQLite.
- Maintains an FTS5 table for BM25 full-text search (`search_text`).
- Loads embeddings into memory and computes cosine similarity in Rust for `search_embeddings`. Suitable for single-node deployments.

### `PostgresAdapter`

**Location:** `crates/kaya-storage/src/postgres.rs`

- Uses Postgres + pgvector for vector search at the database tier.
- Recommended for multi-user deployments where SQLite's single-writer model is a bottleneck.

### `MysqlAdapter`

**Location:** `crates/kaya-storage/src/mysql.rs`

- MySQL backend. Experimental — exact feature parity with the SQLite/Postgres adapters may lag.

The active backend is selected from `DATABASE_URL` at startup. See [CONFIG.md](../CONFIG.md).

## Usage

Business logic accepts `Arc<dyn StorageAdapter>` and never names a concrete type:

```rust
async fn commit_edit(
    storage: Arc<dyn StorageAdapter>,
    token: ApprovalToken,
    edit: Edit,
) -> Result<Document, KayaError> { … }
```

The binary constructs the concrete adapter at startup and passes it through the application via dependency injection.
