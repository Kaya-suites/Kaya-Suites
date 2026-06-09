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

use kaya_core::UserContext;
use kaya_core::storage::{
    Chunk, ChunkHit, Document, Embedding, Folder, StorageAdapter, StorageError,
};

// Canonical SQLite migrations now live in the `kaya-db` crate.
pub use kaya_db::SQLITE_MIGRATOR;

use crate::document::sha256_hex;

// ── Inner shared state ────────────────────────────────────────────────────────

struct Inner {
    pool: SqlitePool,
    user_context: UserContext,
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
    /// Open (or create) the SQLite database at `db_path`, scoped to `user_context`.
    ///
    /// The caller is responsible for running [`kaya_db::SQLITE_MIGRATOR`]
    /// against the pool before any adapter use — this constructor no longer
    /// runs DDL itself.
    pub async fn new(db_path: &Path, user_context: UserContext) -> Result<Self, StorageError> {
        let opts = SqliteConnectOptions::new()
            .filename(db_path)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal);

        let pool = SqlitePoolOptions::new()
            .connect_with(opts)
            .await
            .map_err(box_err)?;

        kaya_db::SQLITE_MIGRATOR
            .run(&pool)
            .await
            .map_err(|e| StorageError::Backend(Box::new(e)))?;

        Ok(Self {
            inner: Arc::new(Inner { pool, user_context }),
        })
    }

    /// Construct from an existing `SqlitePool`, scoped to `user_context`.
    /// The pool is expected to already have migrations applied.
    pub fn from_pool(pool: SqlitePool, user_context: UserContext) -> Self {
        Self {
            inner: Arc::new(Inner { pool, user_context }),
        }
    }

    fn user_id(&self) -> Uuid {
        self.inner.user_context.user_id
    }

    fn user_id_str(&self) -> String {
        self.user_id().to_string()
    }
}

// ── StorageAdapter impl ───────────────────────────────────────────────────────

#[async_trait]
impl StorageAdapter for SqliteAdapter {
    // ── Documents ─────────────────────────────────────────────────────────────

    async fn get_document(&self, id: Uuid) -> Result<Document, StorageError> {
        let id_str = id.to_string();
        let row = sqlx::query(
            "SELECT frontmatter_json, body, deleted_at, folder_id, sort_order FROM documents WHERE id = ?",
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
        doc.sort_order = row.try_get("sort_order").map_err(box_err)?;
        Ok(doc)
    }

    async fn save_document(&self, doc: &Document) -> Result<(), StorageError> {
        let hash = sha256_hex(doc.body.as_bytes());
        upsert_document(&self.inner.pool, self.user_id(), doc, &hash).await
    }

    async fn delete_document(&self, id: Uuid) -> Result<(), StorageError> {
        let id_str = id.to_string();
        let row = sqlx::query(
            "SELECT folder_id FROM documents WHERE id = ? AND deleted_at IS NULL",
        )
        .bind(&id_str)
        .fetch_optional(&self.inner.pool)
        .await
        .map_err(box_err)?;

        if let Some(row) = row {
            let now = chrono::Utc::now().to_rfc3339();
            let folder_id_str: Option<String> = row.try_get("folder_id").map_err(box_err)?;
            let folder_id = folder_id_str
                .as_deref()
                .map(Uuid::parse_str)
                .transpose()
                .map_err(box_err)?;

            let mut tx = self.inner.pool.begin().await.map_err(box_err)?;
            sqlx::query("UPDATE documents SET deleted_at = ? WHERE id = ?")
                .bind(&now)
                .bind(&id_str)
                .execute(&mut *tx)
                .await
                .map_err(box_err)?;
            // Compact remaining siblings so no gaps accumulate.
            let sibling_ids = list_doc_ids_sqlite(&mut *tx, folder_id, None).await?;
            write_doc_positions_sqlite(&mut *tx, &sibling_ids, &now).await?;
            tx.commit().await.map_err(box_err)?;
        }

        Ok(())
    }

    async fn cleanup_deleted_document(&self, id: Uuid) -> Result<(), StorageError> {
        self.delete_chunks_for_document(id).await?;
        sqlx::query("DELETE FROM chunk_embeddings WHERE document_id = ?")
            .bind(id.to_string())
            .execute(&self.inner.pool)
            .await
            .map_err(box_err)?;
        Ok(())
    }

    async fn list_documents(&self) -> Result<Vec<Document>, StorageError> {
        let rows = sqlx::query(
            "SELECT frontmatter_json, body, folder_id, sort_order \
             FROM documents WHERE deleted_at IS NULL \
             ORDER BY sort_order ASC, updated_at DESC",
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
            doc.sort_order = row.try_get("sort_order").map_err(box_err)?;
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
                "SELECT frontmatter_json, body, folder_id, sort_order \
                     FROM documents WHERE deleted_at IS NULL AND folder_id IS NULL \
                     ORDER BY sort_order ASC, updated_at DESC",
            )
            .fetch_all(&self.inner.pool)
            .await
            .map_err(box_err)?,
            Some(fid) => {
                let fid_str = fid.to_string();
                sqlx::query(
                    "SELECT frontmatter_json, body, folder_id, sort_order \
                     FROM documents WHERE deleted_at IS NULL AND folder_id = ? \
                     ORDER BY sort_order ASC, updated_at DESC",
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
            doc.sort_order = row.try_get("sort_order").map_err(box_err)?;
            docs.push(doc);
        }
        Ok(docs)
    }

    async fn next_document_sort_order(
        &self,
        folder_id: Option<Uuid>,
    ) -> Result<i64, StorageError> {
        next_doc_sort_order_sqlite(&self.inner.pool, folder_id).await
    }

    async fn move_document_to_folder(
        &self,
        doc_id: Uuid,
        folder_id: Option<Uuid>,
    ) -> Result<(), StorageError> {
        let doc_id_str = doc_id.to_string();
        let now = chrono::Utc::now().to_rfc3339();

        // Read source folder before the transaction.
        let row = sqlx::query(
            "SELECT folder_id FROM documents WHERE id = ? AND deleted_at IS NULL",
        )
        .bind(&doc_id_str)
        .fetch_optional(&self.inner.pool)
        .await
        .map_err(box_err)?
        .ok_or(StorageError::NotFound(doc_id))?;
        let src_folder_id_str: Option<String> = row.try_get("folder_id").map_err(box_err)?;
        let src_folder_id = src_folder_id_str
            .as_deref()
            .map(Uuid::parse_str)
            .transpose()
            .map_err(box_err)?;

        if src_folder_id == folder_id {
            return Ok(());
        }

        // Place doc at the end of the destination (safe under SQLite's serialized writes).
        let dest_sort_order = next_doc_sort_order_sqlite(&self.inner.pool, folder_id).await?;
        let folder_id_str = folder_id.map(|id| id.to_string());

        let mut tx = self.inner.pool.begin().await.map_err(box_err)?;

        sqlx::query(
            "UPDATE documents SET folder_id = ?, sort_order = ?, updated_at = ? \
             WHERE id = ? AND deleted_at IS NULL",
        )
        .bind(&folder_id_str)
        .bind(dest_sort_order)
        .bind(&now)
        .bind(&doc_id_str)
        .execute(&mut *tx)
        .await
        .map_err(box_err)?;

        // Compact the source folder (close the gap left by the removed document).
        let src_ids = list_doc_ids_sqlite(&mut *tx, src_folder_id, None).await?;
        write_doc_positions_sqlite(&mut *tx, &src_ids, &now).await?;

        // Compact the destination folder (ensures 0, 1, 2, … with no collisions).
        let dest_ids = list_doc_ids_sqlite(&mut *tx, folder_id, None).await?;
        write_doc_positions_sqlite(&mut *tx, &dest_ids, &now).await?;

        tx.commit().await.map_err(box_err)?;
        Ok(())
    }

    async fn reorder_document(
        &self,
        doc_id: Uuid,
        new_index: usize,
    ) -> Result<(), StorageError> {
        let doc_id_str = doc_id.to_string();
        let now = chrono::Utc::now().to_rfc3339();

        let folder_id_str: Option<String> = sqlx::query(
            "SELECT folder_id FROM documents WHERE id = ? AND deleted_at IS NULL",
        )
        .bind(&doc_id_str)
        .fetch_optional(&self.inner.pool)
        .await
        .map_err(box_err)?
        .ok_or(StorageError::NotFound(doc_id))?
        .try_get("folder_id")
        .map_err(box_err)?;

        let folder_id = folder_id_str
            .as_deref()
            .map(Uuid::parse_str)
            .transpose()
            .map_err(box_err)?;

        let mut tx = self.inner.pool.begin().await.map_err(box_err)?;
        let mut sibling_ids = list_doc_ids_sqlite(&mut *tx, folder_id, Some(doc_id)).await?;
        let insert_at = new_index.min(sibling_ids.len());
        sibling_ids.insert(insert_at, doc_id_str);
        write_doc_positions_sqlite(&mut *tx, &sibling_ids, &now).await?;
        tx.commit().await.map_err(box_err)?;

        Ok(())
    }

    async fn create_folder(
        &self,
        name: &str,
        parent_id: Option<Uuid>,
    ) -> Result<Folder, StorageError> {
        if let Some(pid) = parent_id {
            self.get_folder(pid).await?;
        }

        let id = Uuid::new_v4();
        let id_str = id.to_string();
        let parent_id_str = parent_id.map(|p| p.to_string());
        let now = chrono::Utc::now().to_rfc3339();
        let sort_order = next_folder_sort_order_sqlite(&self.inner.pool, parent_id).await?;

        sqlx::query(
            "INSERT INTO folders (id, user_id, name, parent_id, sort_order, created_at, updated_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id_str)
        .bind(self.user_id_str())
        .bind(name)
        .bind(&parent_id_str)
        .bind(sort_order)
        .bind(&now)
        .bind(&now)
        .execute(&self.inner.pool)
        .await
        .map_err(box_err)?;

        Ok(Folder {
            id,
            name: name.to_owned(),
            parent_id,
            sort_order,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    async fn get_folder(&self, id: Uuid) -> Result<Folder, StorageError> {
        let id_str = id.to_string();
        let row = sqlx::query(
            "SELECT id, name, parent_id, sort_order, created_at, updated_at FROM folders WHERE id = ?",
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
            "SELECT id, name, parent_id, sort_order, created_at, updated_at
             FROM folders
             ORDER BY COALESCE(parent_id, ''), sort_order ASC, name ASC, created_at ASC",
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
        new_index: Option<usize>,
    ) -> Result<Folder, StorageError> {
        if let Some(pid) = new_parent_id {
            self.get_folder(pid).await?;
        }

        let id_str = id.to_string();
        let current = self.get_folder(id).await?;
        let current_parent = current.parent_id;
        let now = chrono::Utc::now().to_rfc3339();
        let mut tx = self.inner.pool.begin().await.map_err(box_err)?;

        let mut target_ids = list_folder_ids_sqlite(&mut *tx, new_parent_id, Some(id)).await?;
        let insert_at = new_index.unwrap_or(target_ids.len()).min(target_ids.len());
        target_ids.insert(insert_at, id_str.clone());
        write_folder_positions_sqlite(&mut *tx, new_parent_id, &target_ids, &now).await?;

        if current_parent != new_parent_id {
            let previous_ids = list_folder_ids_sqlite(&mut *tx, current_parent, Some(id)).await?;
            write_folder_positions_sqlite(&mut *tx, current_parent, &previous_ids, &now).await?;
        }

        tx.commit().await.map_err(box_err)?;
        self.get_folder(id).await
    }

    async fn delete_folder(&self, id: Uuid) -> Result<(), StorageError> {
        let id_str = id.to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let folder = self.get_folder(id).await?;
        let mut tx = self.inner.pool.begin().await.map_err(box_err)?;

        // Move docs to root, placing them AFTER existing root docs to avoid
        // sort_order collisions. Offset by (current root max + 1) so they sort
        // to the end before the compaction step re-sequences everything.
        let root_max: i64 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(sort_order), -1) \
             FROM documents WHERE deleted_at IS NULL AND folder_id IS NULL",
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(box_err)?;

        sqlx::query(
            "UPDATE documents \
             SET folder_id = NULL, sort_order = sort_order + ?, updated_at = ? \
             WHERE folder_id = ? AND deleted_at IS NULL",
        )
        .bind(root_max + 1)
        .bind(&now)
        .bind(&id_str)
        .execute(&mut *tx)
        .await
        .map_err(box_err)?;

        // Compact root documents to 0, 1, 2, … (no gaps or duplicate values).
        let root_ids = list_doc_ids_sqlite(&mut *tx, None, None).await?;
        write_doc_positions_sqlite(&mut *tx, &root_ids, &now).await?;

        let mut parent_children =
            list_folder_ids_sqlite(&mut *tx, folder.parent_id, Some(id)).await?;
        let child_ids = list_folder_ids_sqlite(&mut *tx, Some(id), None).await?;
        parent_children.extend(child_ids);
        write_folder_positions_sqlite(&mut *tx, folder.parent_id, &parent_children, &now).await?;

        let affected = sqlx::query("DELETE FROM folders WHERE id = ?")
            .bind(&id_str)
            .execute(&mut *tx)
            .await
            .map_err(box_err)?
            .rows_affected();

        if affected == 0 {
            return Err(StorageError::FolderNotFound(id));
        }

        tx.commit().await.map_err(box_err)?;
        Ok(())
    }

    // ── Chunks ────────────────────────────────────────────────────────────────

    async fn save_chunk(&self, chunk: &Chunk) -> Result<(), StorageError> {
        let doc_id = chunk.document_id.to_string();
        let user_id_str = self.user_id_str();
        let content_hash = sha256_hex(chunk.content.as_bytes());

        sqlx::query(
            "INSERT OR REPLACE INTO chunks
             (user_id, document_id, paragraph_id, ordinal, content, content_hash)
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(&user_id_str)
        .bind(&doc_id)
        .bind(&chunk.paragraph_id)
        .bind(chunk.ordinal as i64)
        .bind(&chunk.content)
        .bind(&content_hash)
        .execute(&self.inner.pool)
        .await
        .map_err(box_err)?;

        // FTS5 does not support UPSERT; we rely on delete_chunks_for_document
        // being called before save_chunk when re-indexing. The FTS table is
        // intentionally user-id-free (no isolation needed — JOINs to chunks
        // filter on user_id).
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
            "SELECT fts.document_id, fts.paragraph_id, fts.content, fts.ordinal
             FROM chunk_fts fts
             JOIN documents d ON d.id = fts.document_id
             WHERE chunk_fts MATCH ?
               AND d.deleted_at IS NULL
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
            "INSERT OR REPLACE INTO chunk_embeddings (user_id, document_id, paragraph_id, vector)
             VALUES (?, ?, ?, ?)",
        )
        .bind(self.user_id_str())
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
              AND c.paragraph_id = ce.paragraph_id
             JOIN documents d
               ON d.id = ce.document_id
             WHERE d.deleted_at IS NULL",
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


async fn next_doc_sort_order_sqlite(
    pool: &SqlitePool,
    folder_id: Option<Uuid>,
) -> Result<i64, StorageError> {
    let row = match folder_id {
        None => sqlx::query(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort \
             FROM documents WHERE deleted_at IS NULL AND folder_id IS NULL",
        )
        .fetch_one(pool)
        .await
        .map_err(box_err)?,
        Some(fid) => sqlx::query(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort \
             FROM documents WHERE deleted_at IS NULL AND folder_id = ?",
        )
        .bind(fid.to_string())
        .fetch_one(pool)
        .await
        .map_err(box_err)?,
    };
    row.try_get("next_sort").map_err(box_err)
}

async fn list_doc_ids_sqlite(
    executor: &mut sqlx::SqliteConnection,
    folder_id: Option<Uuid>,
    exclude_id: Option<Uuid>,
) -> Result<Vec<String>, StorageError> {
    let rows = match (folder_id, exclude_id) {
        (Some(fid), Some(excl)) => sqlx::query(
            "SELECT id FROM documents WHERE deleted_at IS NULL AND folder_id = ? AND id != ? \
             ORDER BY sort_order ASC, updated_at DESC",
        )
        .bind(fid.to_string())
        .bind(excl.to_string())
        .fetch_all(&mut *executor)
        .await
        .map_err(box_err)?,
        (Some(fid), None) => sqlx::query(
            "SELECT id FROM documents WHERE deleted_at IS NULL AND folder_id = ? \
             ORDER BY sort_order ASC, updated_at DESC",
        )
        .bind(fid.to_string())
        .fetch_all(&mut *executor)
        .await
        .map_err(box_err)?,
        (None, Some(excl)) => sqlx::query(
            "SELECT id FROM documents WHERE deleted_at IS NULL AND folder_id IS NULL AND id != ? \
             ORDER BY sort_order ASC, updated_at DESC",
        )
        .bind(excl.to_string())
        .fetch_all(&mut *executor)
        .await
        .map_err(box_err)?,
        (None, None) => sqlx::query(
            "SELECT id FROM documents WHERE deleted_at IS NULL AND folder_id IS NULL \
             ORDER BY sort_order ASC, updated_at DESC",
        )
        .fetch_all(&mut *executor)
        .await
        .map_err(box_err)?,
    };

    rows.into_iter()
        .map(|row| row.try_get("id").map_err(box_err))
        .collect()
}

async fn write_doc_positions_sqlite(
    executor: &mut sqlx::SqliteConnection,
    doc_ids: &[String],
    now: &str,
) -> Result<(), StorageError> {
    for (index, doc_id) in doc_ids.iter().enumerate() {
        sqlx::query("UPDATE documents SET sort_order = ?, updated_at = ? WHERE id = ?")
            .bind(index as i64)
            .bind(now)
            .bind(doc_id)
            .execute(&mut *executor)
            .await
            .map_err(box_err)?;
    }
    Ok(())
}

async fn next_folder_sort_order_sqlite(
    pool: &SqlitePool,
    parent_id: Option<Uuid>,
) -> Result<i64, StorageError> {
    let row = match parent_id {
        Some(parent_id) => sqlx::query(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort
             FROM folders
             WHERE parent_id = ?",
        )
        .bind(parent_id.to_string())
        .fetch_one(pool)
        .await
        .map_err(box_err)?,
        None => sqlx::query(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort
             FROM folders
             WHERE parent_id IS NULL",
        )
        .fetch_one(pool)
        .await
        .map_err(box_err)?,
    };

    row.try_get::<i64, _>("next_sort").map_err(box_err)
}

async fn list_folder_ids_sqlite(
    executor: &mut sqlx::SqliteConnection,
    parent_id: Option<Uuid>,
    exclude_id: Option<Uuid>,
) -> Result<Vec<String>, StorageError> {
    let rows = match (parent_id, exclude_id) {
        (Some(parent_id), Some(exclude_id)) => sqlx::query(
            "SELECT id
             FROM folders
             WHERE parent_id = ? AND id != ?
             ORDER BY sort_order ASC, name ASC, created_at ASC",
        )
        .bind(parent_id.to_string())
        .bind(exclude_id.to_string())
        .fetch_all(&mut *executor)
        .await
        .map_err(box_err)?,
        (Some(parent_id), None) => sqlx::query(
            "SELECT id
             FROM folders
             WHERE parent_id = ?
             ORDER BY sort_order ASC, name ASC, created_at ASC",
        )
        .bind(parent_id.to_string())
        .fetch_all(&mut *executor)
        .await
        .map_err(box_err)?,
        (None, Some(exclude_id)) => sqlx::query(
            "SELECT id
             FROM folders
             WHERE parent_id IS NULL AND id != ?
             ORDER BY sort_order ASC, name ASC, created_at ASC",
        )
        .bind(exclude_id.to_string())
        .fetch_all(&mut *executor)
        .await
        .map_err(box_err)?,
        (None, None) => sqlx::query(
            "SELECT id
             FROM folders
             WHERE parent_id IS NULL
             ORDER BY sort_order ASC, name ASC, created_at ASC",
        )
        .fetch_all(&mut *executor)
        .await
        .map_err(box_err)?,
    };

    rows.into_iter()
        .map(|row| row.try_get("id").map_err(box_err))
        .collect()
}

async fn write_folder_positions_sqlite(
    executor: &mut sqlx::SqliteConnection,
    parent_id: Option<Uuid>,
    folder_ids: &[String],
    now: &str,
) -> Result<(), StorageError> {
    let parent_id_str = parent_id.map(|id| id.to_string());

    for (index, folder_id) in folder_ids.iter().enumerate() {
        sqlx::query(
            "UPDATE folders
             SET parent_id = ?, sort_order = ?, updated_at = ?
             WHERE id = ?",
        )
        .bind(&parent_id_str)
        .bind(index as i64)
        .bind(now)
        .bind(folder_id)
        .execute(&mut *executor)
        .await
        .map_err(box_err)?;
    }

    Ok(())
}

// ── Upsert helper ─────────────────────────────────────────────────────────────

async fn upsert_document(
    pool: &SqlitePool,
    user_id: Uuid,
    doc: &Document,
    hash: &str,
) -> Result<(), StorageError> {
    let id_str = doc.id.to_string();
    let user_id_str = user_id.to_string();
    let fm_json = serde_json::to_string(&doc).map_err(box_err)?;
    let now = chrono::Utc::now().to_rfc3339();
    let folder_id_str = doc.folder_id.map(|id| id.to_string());
    let sort_order = next_doc_sort_order_sqlite(pool, doc.folder_id).await?;

    sqlx::query(
        "INSERT INTO documents (id, user_id, title, frontmatter_json, content_hash, updated_at, deleted_at, body, folder_id, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
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
    .bind(&user_id_str)
    .bind(&doc.title)
    .bind(&fm_json)
    .bind(hash)
    .bind(&now)
    .bind(&doc.body)
    .bind(&folder_id_str)
    .bind(sort_order)
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
        sort_order: row.try_get("sort_order")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

// ── Error helpers ─────────────────────────────────────────────────────────────

fn box_err<E: std::error::Error + Send + Sync + 'static>(e: E) -> StorageError {
    StorageError::Backend(Box::new(e))
}
