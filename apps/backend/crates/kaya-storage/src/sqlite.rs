//! SQLite-backed `StorageAdapter` implementation for Kaya Suites OSS.
//!
//! Documents are stored entirely in the `documents` table — no on-disk `.md`
//! files are written or read. The `body` column is the single source of truth.

use std::sync::Arc;

use async_trait::async_trait;
use sqlx::{
    Row, SqlitePool,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
};
use std::path::Path;
use uuid::Uuid;

use kaya_core::storage::{
    Chunk, ChunkHit, Document, Embedding, Folder, StorageAdapter, StorageError,
};

pub static SQLITE_MIGRATOR: sqlx::migrate::Migrator =
    sqlx::migrate!("./migrations/sqlite");

use crate::document::sha256_hex;

// ── Inner shared state ────────────────────────────────────────────────────────

struct Inner {
    pool: SqlitePool,
}

// ── Adapter ───────────────────────────────────────────────────────────────────

/// SQLite-backed storage adapter (OSS / Apache 2.0).
///
/// All document data is stored in the SQLite database. No files are written to
/// or read from disk.
pub struct SqliteAdapter {
    inner: Arc<Inner>,
}

impl SqliteAdapter {
    /// Open (or create) the SQLite database at `db_path`.
    pub async fn new(db_path: &Path) -> Result<Self, StorageError> {
        let opts = SqliteConnectOptions::new()
            .filename(db_path)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal);

        let pool = SqlitePoolOptions::new()
            .connect_with(opts)
            .await
            .map_err(box_err)?;

        run_migrations(&pool).await?;

        Ok(Self {
            inner: Arc::new(Inner { pool }),
        })
    }

    /// Construct from an existing `SqlitePool`.
    ///
    /// Migrations are run immediately (idempotent).
    pub async fn from_pool(pool: SqlitePool) -> Result<Self, StorageError> {
        run_migrations(&pool).await?;
        Ok(Self {
            inner: Arc::new(Inner { pool }),
        })
    }

    /// Run SQLite storage migrations on an existing pool.
    ///
    /// Idempotent — safe to call on every startup.
    pub async fn run_migrations(pool: &SqlitePool) -> Result<(), StorageError> {
        run_migrations(pool).await
    }
}

// ── StorageAdapter impl ───────────────────────────────────────────────────────

#[async_trait]
impl StorageAdapter for SqliteAdapter {
    // ── Documents ─────────────────────────────────────────────────────────────

    async fn get_document(&self, id: Uuid) -> Result<Document, StorageError> {
        let id_str = id.to_string();
        let row = sqlx::query(
            "SELECT frontmatter_json, body, deleted_at, folder_id FROM documents WHERE id = ?",
        )
        .bind(&id_str)
        .fetch_optional(&self.inner.pool)
        .await
        .map_err(box_err)?;

        let row = row.ok_or(StorageError::NotFound(id))?;

        let deleted_at: Option<String> = row.try_get("deleted_at").map_err(box_err)?;
        if deleted_at.is_some() {
            return Err(StorageError::NotFound(id));
        }

        let body: String = row.try_get("body").map_err(box_err)?;
        let fm_json: String = row.try_get("frontmatter_json").map_err(box_err)?;
        let folder_id_str: Option<String> = row.try_get("folder_id").map_err(box_err)?;

        let mut doc: Document = serde_json::from_str(&fm_json).map_err(box_err)?;
        doc.body = body;
        doc.folder_id = folder_id_str
            .as_deref()
            .map(Uuid::parse_str)
            .transpose()
            .map_err(box_err)?;
        Ok(doc)
    }

    async fn save_document(&self, doc: &Document) -> Result<(), StorageError> {
        let hash = sha256_hex(doc.body.as_bytes());
        upsert_document(&self.inner.pool, doc, &hash).await
    }

    async fn delete_document(&self, id: Uuid) -> Result<(), StorageError> {
        let id_str = id.to_string();
        let exists = sqlx::query("SELECT 1 FROM documents WHERE id = ? AND deleted_at IS NULL")
            .bind(&id_str)
            .fetch_optional(&self.inner.pool)
            .await
            .map_err(box_err)?;

        if exists.is_some() {
            let now = chrono::Utc::now().to_rfc3339();
            sqlx::query("UPDATE documents SET deleted_at = ? WHERE id = ?")
                .bind(&now)
                .bind(&id_str)
                .execute(&self.inner.pool)
                .await
                .map_err(box_err)?;

            self.delete_chunks_for_document(id).await?;
            sqlx::query("DELETE FROM chunk_embeddings WHERE document_id = ?")
                .bind(&id_str)
                .execute(&self.inner.pool)
                .await
                .map_err(box_err)?;
        }

        Ok(())
    }

    async fn list_documents(&self) -> Result<Vec<Document>, StorageError> {
        let rows = sqlx::query(
            "SELECT frontmatter_json, body, folder_id \
             FROM documents WHERE deleted_at IS NULL ORDER BY updated_at DESC",
        )
        .fetch_all(&self.inner.pool)
        .await
        .map_err(box_err)?;

        let mut docs = Vec::with_capacity(rows.len());
        for row in rows {
            let body: String = row.try_get("body").map_err(box_err)?;
            let fm_json: String = row.try_get("frontmatter_json").map_err(box_err)?;
            let folder_id_str: Option<String> = row.try_get("folder_id").map_err(box_err)?;
            let mut doc: Document = serde_json::from_str(&fm_json).map_err(box_err)?;
            doc.body = body;
            doc.folder_id = folder_id_str
                .as_deref()
                .map(Uuid::parse_str)
                .transpose()
                .map_err(box_err)?;
            docs.push(doc);
        }
        Ok(docs)
    }

    async fn list_documents_in_folder(
        &self,
        folder_id: Option<Uuid>,
    ) -> Result<Vec<Document>, StorageError> {
        let rows = match folder_id {
            None => sqlx::query(
                "SELECT frontmatter_json, body, folder_id \
                     FROM documents WHERE deleted_at IS NULL AND folder_id IS NULL \
                     ORDER BY updated_at DESC",
            )
            .fetch_all(&self.inner.pool)
            .await
            .map_err(box_err)?,
            Some(fid) => {
                let fid_str = fid.to_string();
                sqlx::query(
                    "SELECT frontmatter_json, body, folder_id \
                     FROM documents WHERE deleted_at IS NULL AND folder_id = ? \
                     ORDER BY updated_at DESC",
                )
                .bind(&fid_str)
                .fetch_all(&self.inner.pool)
                .await
                .map_err(box_err)?
            }
        };

        let mut docs = Vec::with_capacity(rows.len());
        for row in rows {
            let body: String = row.try_get("body").map_err(box_err)?;
            let fm_json: String = row.try_get("frontmatter_json").map_err(box_err)?;
            let folder_id_str: Option<String> = row.try_get("folder_id").map_err(box_err)?;
            let mut doc: Document = serde_json::from_str(&fm_json).map_err(box_err)?;
            doc.body = body;
            doc.folder_id = folder_id_str
                .as_deref()
                .map(Uuid::parse_str)
                .transpose()
                .map_err(box_err)?;
            docs.push(doc);
        }
        Ok(docs)
    }

    async fn move_document_to_folder(
        &self,
        doc_id: Uuid,
        folder_id: Option<Uuid>,
    ) -> Result<(), StorageError> {
        let doc_id_str = doc_id.to_string();
        let folder_id_str = folder_id.map(|id| id.to_string());
        let now = chrono::Utc::now().to_rfc3339();

        sqlx::query(
            "UPDATE documents SET folder_id = ?, updated_at = ? \
             WHERE id = ? AND deleted_at IS NULL",
        )
        .bind(&folder_id_str)
        .bind(&now)
        .bind(&doc_id_str)
        .execute(&self.inner.pool)
        .await
        .map_err(box_err)?;

        Ok(())
    }

    async fn create_folder(
        &self,
        name: &str,
        parent_id: Option<Uuid>,
    ) -> Result<Folder, StorageError> {
        let id = Uuid::new_v4();
        let id_str = id.to_string();
        let parent_id_str = parent_id.map(|p| p.to_string());
        let now = chrono::Utc::now().to_rfc3339();

        sqlx::query(
            "INSERT INTO folders (id, name, parent_id, created_at, updated_at) \
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&id_str)
        .bind(name)
        .bind(&parent_id_str)
        .bind(&now)
        .bind(&now)
        .execute(&self.inner.pool)
        .await
        .map_err(box_err)?;

        Ok(Folder {
            id,
            name: name.to_owned(),
            parent_id,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    async fn get_folder(&self, id: Uuid) -> Result<Folder, StorageError> {
        let id_str = id.to_string();
        let row = sqlx::query(
            "SELECT id, name, parent_id, created_at, updated_at FROM folders WHERE id = ?",
        )
        .bind(&id_str)
        .fetch_optional(&self.inner.pool)
        .await
        .map_err(box_err)?;

        let row = row.ok_or(StorageError::FolderNotFound(id))?;
        row_to_folder(&row).map_err(box_err)
    }

    async fn list_folders(&self) -> Result<Vec<Folder>, StorageError> {
        let rows = sqlx::query(
            "SELECT id, name, parent_id, created_at, updated_at FROM folders ORDER BY name ASC",
        )
        .fetch_all(&self.inner.pool)
        .await
        .map_err(box_err)?;

        rows.iter()
            .map(|r| row_to_folder(r).map_err(box_err))
            .collect()
    }

    async fn rename_folder(&self, id: Uuid, name: &str) -> Result<Folder, StorageError> {
        let id_str = id.to_string();
        let now = chrono::Utc::now().to_rfc3339();

        let affected = sqlx::query("UPDATE folders SET name = ?, updated_at = ? WHERE id = ?")
            .bind(name)
            .bind(&now)
            .bind(&id_str)
            .execute(&self.inner.pool)
            .await
            .map_err(box_err)?
            .rows_affected();

        if affected == 0 {
            return Err(StorageError::FolderNotFound(id));
        }

        self.get_folder(id).await
    }

    async fn move_folder(
        &self,
        id: Uuid,
        new_parent_id: Option<Uuid>,
    ) -> Result<Folder, StorageError> {
        let id_str = id.to_string();
        let parent_str = new_parent_id.map(|p| p.to_string());
        let now = chrono::Utc::now().to_rfc3339();

        let affected = sqlx::query("UPDATE folders SET parent_id = ?, updated_at = ? WHERE id = ?")
            .bind(&parent_str)
            .bind(&now)
            .bind(&id_str)
            .execute(&self.inner.pool)
            .await
            .map_err(box_err)?
            .rows_affected();

        if affected == 0 {
            return Err(StorageError::FolderNotFound(id));
        }

        self.get_folder(id).await
    }

    async fn delete_folder(&self, id: Uuid) -> Result<(), StorageError> {
        let id_str = id.to_string();
        let now = chrono::Utc::now().to_rfc3339();

        // Move all documents in this folder to root.
        sqlx::query("UPDATE documents SET folder_id = NULL, updated_at = ? WHERE folder_id = ?")
            .bind(&now)
            .bind(&id_str)
            .execute(&self.inner.pool)
            .await
            .map_err(box_err)?;

        // Re-parent any direct child folders to this folder's parent.
        sqlx::query(
            "UPDATE folders SET parent_id = \
             (SELECT parent_id FROM folders WHERE id = ?), updated_at = ? \
             WHERE parent_id = ?",
        )
        .bind(&id_str)
        .bind(&now)
        .bind(&id_str)
        .execute(&self.inner.pool)
        .await
        .map_err(box_err)?;

        let affected = sqlx::query("DELETE FROM folders WHERE id = ?")
            .bind(&id_str)
            .execute(&self.inner.pool)
            .await
            .map_err(box_err)?
            .rows_affected();

        if affected == 0 {
            return Err(StorageError::FolderNotFound(id));
        }

        Ok(())
    }

    // ── Chunks ────────────────────────────────────────────────────────────────

    async fn save_chunk(&self, chunk: &Chunk) -> Result<(), StorageError> {
        let doc_id = chunk.document_id.to_string();
        let content_hash = sha256_hex(chunk.content.as_bytes());

        sqlx::query(
            "INSERT OR REPLACE INTO chunks
             (document_id, paragraph_id, ordinal, content, content_hash)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&doc_id)
        .bind(&chunk.paragraph_id)
        .bind(chunk.ordinal as i64)
        .bind(&chunk.content)
        .bind(&content_hash)
        .execute(&self.inner.pool)
        .await
        .map_err(box_err)?;

        // FTS5 does not support UPSERT; we rely on delete_chunks_for_document
        // being called before save_chunk when re-indexing.
        sqlx::query(
            "INSERT INTO chunk_fts (content, document_id, paragraph_id, ordinal)
             VALUES (?, ?, ?, ?)",
        )
        .bind(&chunk.content)
        .bind(&doc_id)
        .bind(&chunk.paragraph_id)
        .bind(chunk.ordinal as i64)
        .execute(&self.inner.pool)
        .await
        .map_err(box_err)?;

        Ok(())
    }

    async fn delete_chunks_for_document(&self, document_id: Uuid) -> Result<(), StorageError> {
        let doc_id = document_id.to_string();

        sqlx::query("DELETE FROM chunks WHERE document_id = ?")
            .bind(&doc_id)
            .execute(&self.inner.pool)
            .await
            .map_err(box_err)?;

        sqlx::query("DELETE FROM chunk_fts WHERE document_id = ?")
            .bind(&doc_id)
            .execute(&self.inner.pool)
            .await
            .map_err(box_err)?;

        Ok(())
    }

    async fn get_chunk_hashes(
        &self,
        document_id: Uuid,
    ) -> Result<Vec<(String, String)>, StorageError> {
        let doc_id = document_id.to_string();
        let rows =
            sqlx::query("SELECT paragraph_id, content_hash FROM chunks WHERE document_id = ?")
                .bind(&doc_id)
                .fetch_all(&self.inner.pool)
                .await
                .map_err(box_err)?;

        rows.into_iter()
            .map(|row| {
                let para_id: String = row.try_get("paragraph_id").map_err(box_err)?;
                let hash: String = row.try_get("content_hash").map_err(box_err)?;
                Ok((para_id, hash))
            })
            .collect()
    }

    async fn search_text(&self, query: &str, limit: usize) -> Result<Vec<ChunkHit>, StorageError> {
        if query.trim().is_empty() {
            return Ok(vec![]);
        }

        let rows = sqlx::query(
            "SELECT document_id, paragraph_id, content, ordinal
             FROM chunk_fts
             WHERE chunk_fts MATCH ?
             ORDER BY rank
             LIMIT ?",
        )
        .bind(query)
        .bind(limit as i64)
        .fetch_all(&self.inner.pool)
        .await
        .map_err(box_err)?;

        rows.into_iter()
            .map(|row| {
                let doc_id_str: String = row.try_get("document_id").map_err(box_err)?;
                let doc_id = Uuid::parse_str(&doc_id_str).map_err(box_err)?;
                let para_id: String = row.try_get("paragraph_id").map_err(box_err)?;
                let content: String = row.try_get("content").map_err(box_err)?;
                let ordinal: i64 = row.try_get("ordinal").map_err(box_err)?;
                Ok(ChunkHit {
                    document_id: doc_id,
                    paragraph_id: para_id,
                    content,
                    ordinal: ordinal as u32,
                })
            })
            .collect()
    }

    // ── Embeddings ────────────────────────────────────────────────────────────

    async fn save_embeddings(&self, embedding: &Embedding) -> Result<(), StorageError> {
        let doc_id = embedding.document_id.to_string();
        let blob = encode_f32(&embedding.vector);

        sqlx::query(
            "INSERT OR REPLACE INTO chunk_embeddings (document_id, paragraph_id, vector)
             VALUES (?, ?, ?)",
        )
        .bind(&doc_id)
        .bind(&embedding.paragraph_id)
        .bind(&blob)
        .execute(&self.inner.pool)
        .await
        .map_err(box_err)?;

        Ok(())
    }

    async fn delete_embeddings_for_paragraphs(
        &self,
        document_id: Uuid,
        paragraph_ids: &[String],
    ) -> Result<(), StorageError> {
        if paragraph_ids.is_empty() {
            return Ok(());
        }
        let doc_id = document_id.to_string();
        for para_id in paragraph_ids {
            sqlx::query("DELETE FROM chunk_embeddings WHERE document_id = ? AND paragraph_id = ?")
                .bind(&doc_id)
                .bind(para_id)
                .execute(&self.inner.pool)
                .await
                .map_err(box_err)?;
        }
        Ok(())
    }

    async fn search_embeddings(
        &self,
        query: &[f32],
        limit: usize,
    ) -> Result<Vec<ChunkHit>, StorageError> {
        if query.is_empty() {
            return Ok(vec![]);
        }

        let rows = sqlx::query(
            "SELECT ce.document_id, ce.paragraph_id, ce.vector,
                    c.content, c.ordinal
             FROM chunk_embeddings ce
             JOIN chunks c
               ON c.document_id = ce.document_id
              AND c.paragraph_id = ce.paragraph_id",
        )
        .fetch_all(&self.inner.pool)
        .await
        .map_err(box_err)?;

        let mut scored: Vec<(f32, ChunkHit)> = rows
            .into_iter()
            .filter_map(|row| {
                let doc_id_str: String = row.try_get("document_id").ok()?;
                let doc_id = Uuid::parse_str(&doc_id_str).ok()?;
                let para_id: String = row.try_get("paragraph_id").ok()?;
                let blob: Vec<u8> = row.try_get("vector").ok()?;
                let content: String = row.try_get("content").ok()?;
                let ordinal: i64 = row.try_get("ordinal").ok()?;

                let vec = decode_f32(&blob);
                let sim = cosine_similarity(query, &vec);

                Some((
                    sim,
                    ChunkHit {
                        document_id: doc_id,
                        paragraph_id: para_id,
                        content,
                        ordinal: ordinal as u32,
                    },
                ))
            })
            .collect();

        scored.sort_unstable_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

        Ok(scored.into_iter().take(limit).map(|(_, hit)| hit).collect())
    }
}

// ── Migrations ────────────────────────────────────────────────────────────────

async fn run_migrations(pool: &SqlitePool) -> Result<(), StorageError> {
    // Document store — body is the source of truth; no path column.
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS documents (
            id               TEXT PRIMARY KEY,
            title            TEXT NOT NULL,
            frontmatter_json TEXT NOT NULL,
            content_hash     TEXT NOT NULL,
            updated_at       TEXT NOT NULL,
            deleted_at       TEXT,
            body             TEXT NOT NULL DEFAULT ''
        )",
    )
    .execute(pool)
    .await
    .map_err(box_err)?;

    // If the table was created by the old schema (which had `path NOT NULL UNIQUE`),
    // migrate to the new schema by recreating the table without the path column.
    let has_path: bool = sqlx::query_scalar::<_, i32>(
        "SELECT COUNT(*) FROM pragma_table_info('documents') WHERE name='path'",
    )
    .fetch_one(pool)
    .await
    .unwrap_or(0)
        > 0;

    if has_path {
        sqlx::query("ALTER TABLE documents RENAME TO _documents_old")
            .execute(pool)
            .await
            .map_err(box_err)?;
        sqlx::query(
            "CREATE TABLE documents (
                id               TEXT PRIMARY KEY,
                title            TEXT NOT NULL,
                frontmatter_json TEXT NOT NULL,
                content_hash     TEXT NOT NULL,
                updated_at       TEXT NOT NULL,
                deleted_at       TEXT,
                body             TEXT NOT NULL DEFAULT ''
            )",
        )
        .execute(pool)
        .await
        .map_err(box_err)?;
        sqlx::query(
            "INSERT INTO documents (id, title, frontmatter_json, content_hash, updated_at, deleted_at, body)
             SELECT id, title, frontmatter_json, content_hash, updated_at, deleted_at,
                    COALESCE(body, '') FROM _documents_old",
        )
        .execute(pool)
        .await
        .map_err(box_err)?;
        sqlx::query("DROP TABLE _documents_old")
            .execute(pool)
            .await
            .map_err(box_err)?;
    }

    // Add body column to databases that pre-date this migration (no-op if exists).
    let _ = sqlx::query("ALTER TABLE documents ADD COLUMN body TEXT NOT NULL DEFAULT ''")
        .execute(pool)
        .await;

    // Add folder_id column to databases that pre-date this migration (no-op if exists).
    let _ = sqlx::query("ALTER TABLE documents ADD COLUMN folder_id TEXT")
        .execute(pool)
        .await;

    // Folders table for hierarchical document grouping.
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS folders (
            id         TEXT PRIMARY KEY,
            name       TEXT NOT NULL,
            parent_id  TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (parent_id) REFERENCES folders(id)
        )",
    )
    .execute(pool)
    .await
    .map_err(box_err)?;

    // Chunk metadata + content hashes (FR-6)
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS chunks (
            document_id  TEXT NOT NULL,
            paragraph_id TEXT NOT NULL,
            ordinal      INTEGER NOT NULL,
            content      TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            PRIMARY KEY (document_id, paragraph_id)
        )",
    )
    .execute(pool)
    .await
    .map_err(box_err)?;

    // FTS5 full-text index for BM25 retrieval (FR-7)
    sqlx::query(
        "CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(
            content,
            document_id  UNINDEXED,
            paragraph_id UNINDEXED,
            ordinal      UNINDEXED,
            tokenize     = 'unicode61'
        )",
    )
    .execute(pool)
    .await
    .map_err(box_err)?;

    // Vector embeddings stored as packed-f32 BLOBs (little-endian).
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS chunk_embeddings (
            document_id  TEXT NOT NULL,
            paragraph_id TEXT NOT NULL,
            vector       BLOB NOT NULL,
            PRIMARY KEY (document_id, paragraph_id)
        )",
    )
    .execute(pool)
    .await
    .map_err(box_err)?;

    Ok(())
}

// ── Upsert helper ─────────────────────────────────────────────────────────────

async fn upsert_document(
    pool: &SqlitePool,
    doc: &Document,
    hash: &str,
) -> Result<(), StorageError> {
    let id_str = doc.id.to_string();
    let fm_json = serde_json::to_string(&doc).map_err(box_err)?;
    let now = chrono::Utc::now().to_rfc3339();
    let folder_id_str = doc.folder_id.map(|id| id.to_string());

    sqlx::query(
        "INSERT INTO documents (id, title, frontmatter_json, content_hash, updated_at, deleted_at, body, folder_id)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title            = excluded.title,
           frontmatter_json = excluded.frontmatter_json,
           content_hash     = excluded.content_hash,
           updated_at       = excluded.updated_at,
           deleted_at       = NULL,
           body             = excluded.body,
           folder_id        = excluded.folder_id",
    )
    .bind(&id_str)
    .bind(&doc.title)
    .bind(&fm_json)
    .bind(hash)
    .bind(&now)
    .bind(&doc.body)
    .bind(&folder_id_str)
    .execute(pool)
    .await
    .map_err(box_err)?;

    Ok(())
}

// ── Vector helpers ────────────────────────────────────────────────────────────

fn encode_f32(v: &[f32]) -> Vec<u8> {
    v.iter().flat_map(|f| f.to_le_bytes()).collect()
}

fn decode_f32(blob: &[u8]) -> Vec<f32> {
    blob.chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect()
}

fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() {
        return 0.0;
    }
    let dot: f32 = a.iter().zip(b).map(|(x, y)| x * y).sum();
    let na: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let nb: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if na == 0.0 || nb == 0.0 {
        0.0
    } else {
        dot / (na * nb)
    }
}

// ── Row helpers ───────────────────────────────────────────────────────────────

fn row_to_folder(row: &sqlx::sqlite::SqliteRow) -> Result<Folder, sqlx::Error> {
    let id_str: String = row.try_get("id")?;
    let id = Uuid::parse_str(&id_str).map_err(|e| sqlx::Error::Decode(Box::new(e)))?;
    let parent_str: Option<String> = row.try_get("parent_id")?;
    let parent_id = parent_str
        .as_deref()
        .map(Uuid::parse_str)
        .transpose()
        .map_err(|e| sqlx::Error::Decode(Box::new(e)))?;
    Ok(Folder {
        id,
        name: row.try_get("name")?,
        parent_id,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

// ── Error helpers ─────────────────────────────────────────────────────────────

fn box_err<E: std::error::Error + Send + Sync + 'static>(e: E) -> StorageError {
    StorageError::Backend(Box::new(e))
}
