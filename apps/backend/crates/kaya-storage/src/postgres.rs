// Copyright 2026 Kaya Suites. Licensed under the Apache License, Version 2.0.
//
//! Postgres + pgvector storage adapter for Kaya Suites.
//!
//! # UUID storage
//!
//! The schema uses VARCHAR(36) for all UUID columns (created by kaya-db) so
//! that AnyPool string bindings work uniformly across backends.  This adapter
//! still uses PgPool directly but binds/decodes UUIDs as strings to match the
//! schema.
//!
//! # Multi-tenancy contract (NFR §6.3)
//!
//! `PostgresAdapter` is constructed with a [`UserContext`] and all SQL methods
//! unconditionally include `WHERE user_id = self.user_context.user_id`.
//! An instance without a `UserContext` cannot exist.

use async_trait::async_trait;
use kaya_core::UserContext;
use kaya_core::storage::{
    Chunk, ChunkHit, Document, Embedding, Folder, StorageAdapter, StorageError,
};
use pgvector::Vector;
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};
use uuid::Uuid;

pub static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

// ── Adapter ───────────────────────────────────────────────────────────────────

/// Postgres-backed [`StorageAdapter`] implementation.
pub struct PostgresAdapter {
    pool: PgPool,
    user_context: UserContext,
}

impl PostgresAdapter {
    pub fn new(pool: PgPool, user_context: UserContext) -> Self {
        Self { pool, user_context }
    }

    #[inline]
    fn user_id(&self) -> Uuid {
        self.user_context.user_id
    }
}

// ── StorageAdapter implementation ─────────────────────────────────────────────

#[async_trait]
impl StorageAdapter for PostgresAdapter {
    // ── Documents ─────────────────────────────────────────────────────────────

    async fn get_document(&self, id: Uuid) -> Result<Document, StorageError> {
        let row = sqlx::query(
            "SELECT id, title, owner, last_reviewed, tags, related_docs, body, folder_id
             FROM documents
             WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
        )
        .bind(id.to_string())
        .bind(self.user_id().to_string())
        .fetch_optional(&self.pool)
        .await
        .map_err(box_err)?
        .ok_or(StorageError::NotFound(id))?;

        row_to_document(&row)
    }

    async fn save_document(&self, doc: &Document) -> Result<(), StorageError> {
        let hash = content_hash(&doc.body);
        let now = chrono::Utc::now();
        let related: Vec<String> = doc.related_docs.iter().map(|u| u.to_string()).collect();
        let folder_id_str = doc.folder_id.map(|id| id.to_string());

        sqlx::query(
            "INSERT INTO documents
                 (id, user_id, title, owner, last_reviewed, tags, related_docs,
                  body, content_hash, folder_id, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
             ON CONFLICT (id) DO UPDATE SET
                 title         = EXCLUDED.title,
                 owner         = EXCLUDED.owner,
                 last_reviewed = EXCLUDED.last_reviewed,
                 tags          = EXCLUDED.tags,
                 related_docs  = EXCLUDED.related_docs,
                 body          = EXCLUDED.body,
                 content_hash  = EXCLUDED.content_hash,
                 folder_id     = EXCLUDED.folder_id,
                 updated_at    = EXCLUDED.updated_at,
                 deleted_at    = NULL",
        )
        .bind(doc.id.to_string())
        .bind(self.user_id().to_string())
        .bind(&doc.title)
        .bind(&doc.owner)
        .bind(doc.last_reviewed)
        .bind(&doc.tags[..])
        .bind(&related[..])
        .bind(&doc.body)
        .bind(&hash)
        .bind(&folder_id_str)
        .bind(now)
        .execute(&self.pool)
        .await
        .map_err(box_err)?;

        Ok(())
    }

    async fn delete_document(&self, id: Uuid) -> Result<(), StorageError> {
        let now = chrono::Utc::now();
        sqlx::query(
            "UPDATE documents
             SET deleted_at = $1
             WHERE id = $2 AND user_id = $3 AND deleted_at IS NULL",
        )
        .bind(now)
        .bind(id.to_string())
        .bind(self.user_id().to_string())
        .execute(&self.pool)
        .await
        .map_err(box_err)?;
        Ok(())
    }

    async fn list_documents(&self) -> Result<Vec<Document>, StorageError> {
        let rows = sqlx::query(
            "SELECT id, title, owner, last_reviewed, tags, related_docs, body, folder_id
             FROM documents
             WHERE user_id = $1 AND deleted_at IS NULL
             ORDER BY updated_at DESC",
        )
        .bind(self.user_id().to_string())
        .fetch_all(&self.pool)
        .await
        .map_err(box_err)?;

        rows.iter().map(row_to_document).collect()
    }

    async fn list_documents_in_folder(
        &self,
        folder_id: Option<Uuid>,
    ) -> Result<Vec<Document>, StorageError> {
        let rows = match folder_id {
            None => sqlx::query(
                "SELECT id, title, owner, last_reviewed, tags, related_docs, body, folder_id
                     FROM documents
                     WHERE user_id = $1 AND deleted_at IS NULL AND folder_id IS NULL
                     ORDER BY updated_at DESC",
            )
            .bind(self.user_id().to_string())
            .fetch_all(&self.pool)
            .await
            .map_err(box_err)?,
            Some(fid) => sqlx::query(
                "SELECT id, title, owner, last_reviewed, tags, related_docs, body, folder_id
                     FROM documents
                     WHERE user_id = $1 AND deleted_at IS NULL AND folder_id = $2
                     ORDER BY updated_at DESC",
            )
            .bind(self.user_id().to_string())
            .bind(fid.to_string())
            .fetch_all(&self.pool)
            .await
            .map_err(box_err)?,
        };

        rows.iter().map(row_to_document).collect()
    }

    async fn move_document_to_folder(
        &self,
        doc_id: Uuid,
        folder_id: Option<Uuid>,
    ) -> Result<(), StorageError> {
        let folder_id_str = folder_id.map(|id| id.to_string());
        sqlx::query(
            "UPDATE documents SET folder_id = $1, updated_at = now()
             WHERE id = $2 AND user_id = $3 AND deleted_at IS NULL",
        )
        .bind(&folder_id_str)
        .bind(doc_id.to_string())
        .bind(self.user_id().to_string())
        .execute(&self.pool)
        .await
        .map_err(box_err)?;
        Ok(())
    }

    async fn create_folder(
        &self,
        name: &str,
        parent_id: Option<Uuid>,
    ) -> Result<Folder, StorageError> {
        let parent_id_str = parent_id.map(|id| id.to_string());
        let row = sqlx::query(
            "INSERT INTO folders (user_id, name, parent_id)
             VALUES ($1, $2, $3)
             RETURNING id, name, parent_id,
                       to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS created_at,
                       to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS updated_at",
        )
        .bind(self.user_id().to_string())
        .bind(name)
        .bind(&parent_id_str)
        .fetch_one(&self.pool)
        .await
        .map_err(box_err)?;

        pg_row_to_folder(&row)
    }

    async fn get_folder(&self, id: Uuid) -> Result<Folder, StorageError> {
        let row = sqlx::query(
            "SELECT id, name, parent_id,
                    to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS created_at,
                    to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS updated_at
             FROM folders
             WHERE id = $1 AND user_id = $2",
        )
        .bind(id.to_string())
        .bind(self.user_id().to_string())
        .fetch_optional(&self.pool)
        .await
        .map_err(box_err)?
        .ok_or(StorageError::FolderNotFound(id))?;

        pg_row_to_folder(&row)
    }

    async fn list_folders(&self) -> Result<Vec<Folder>, StorageError> {
        let rows = sqlx::query(
            "SELECT id, name, parent_id,
                    to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS created_at,
                    to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS updated_at
             FROM folders
             WHERE user_id = $1
             ORDER BY name ASC",
        )
        .bind(self.user_id().to_string())
        .fetch_all(&self.pool)
        .await
        .map_err(box_err)?;

        rows.iter().map(pg_row_to_folder).collect()
    }

    async fn rename_folder(&self, id: Uuid, name: &str) -> Result<Folder, StorageError> {
        let affected = sqlx::query(
            "UPDATE folders SET name = $1, updated_at = now()
             WHERE id = $2 AND user_id = $3",
        )
        .bind(name)
        .bind(id.to_string())
        .bind(self.user_id().to_string())
        .execute(&self.pool)
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
        let parent_str = new_parent_id.map(|p| p.to_string());
        let affected = sqlx::query(
            "UPDATE folders SET parent_id = $1, updated_at = now()
             WHERE id = $2 AND user_id = $3",
        )
        .bind(&parent_str)
        .bind(id.to_string())
        .bind(self.user_id().to_string())
        .execute(&self.pool)
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
        let uid_str = self.user_id().to_string();

        // Move child folders to this folder's parent.
        sqlx::query(
            "UPDATE folders
             SET parent_id = (SELECT parent_id FROM folders WHERE id = $1 AND user_id = $2),
                 updated_at = now()
             WHERE parent_id = $1 AND user_id = $2",
        )
        .bind(&id_str)
        .bind(&uid_str)
        .execute(&self.pool)
        .await
        .map_err(box_err)?;

        // Documents move to root (handled by ON DELETE SET NULL on the FK,
        // but we set explicitly to be safe in case FK behaviour differs).
        sqlx::query(
            "UPDATE documents SET folder_id = NULL, updated_at = now()
             WHERE folder_id = $1 AND user_id = $2",
        )
        .bind(&id_str)
        .bind(&uid_str)
        .execute(&self.pool)
        .await
        .map_err(box_err)?;

        let affected = sqlx::query("DELETE FROM folders WHERE id = $1 AND user_id = $2")
            .bind(&id_str)
            .bind(&uid_str)
            .execute(&self.pool)
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
        let hash = content_hash(&chunk.content);
        sqlx::query(
            "INSERT INTO chunks
                 (user_id, document_id, paragraph_id, ordinal, content, content_hash)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (user_id, document_id, paragraph_id) DO UPDATE SET
                 ordinal      = EXCLUDED.ordinal,
                 content      = EXCLUDED.content,
                 content_hash = EXCLUDED.content_hash",
        )
        .bind(self.user_id().to_string())
        .bind(chunk.document_id.to_string())
        .bind(&chunk.paragraph_id)
        .bind(chunk.ordinal as i32)
        .bind(&chunk.content)
        .bind(&hash)
        .execute(&self.pool)
        .await
        .map_err(box_err)?;
        Ok(())
    }

    async fn delete_chunks_for_document(&self, document_id: Uuid) -> Result<(), StorageError> {
        sqlx::query("DELETE FROM chunks WHERE user_id = $1 AND document_id = $2")
            .bind(self.user_id().to_string())
            .bind(document_id.to_string())
            .execute(&self.pool)
            .await
            .map_err(box_err)?;
        Ok(())
    }

    async fn get_chunk_hashes(
        &self,
        document_id: Uuid,
    ) -> Result<Vec<(String, String)>, StorageError> {
        let rows = sqlx::query(
            "SELECT paragraph_id, content_hash
             FROM chunks
             WHERE user_id = $1 AND document_id = $2",
        )
        .bind(self.user_id().to_string())
        .bind(document_id.to_string())
        .fetch_all(&self.pool)
        .await
        .map_err(box_err)?;

        rows.iter()
            .map(|row| {
                let para: String = row.try_get("paragraph_id").map_err(box_err)?;
                let hash: String = row.try_get("content_hash").map_err(box_err)?;
                Ok((para, hash))
            })
            .collect()
    }

    async fn search_text(&self, query: &str, limit: usize) -> Result<Vec<ChunkHit>, StorageError> {
        if query.trim().is_empty() {
            return Ok(vec![]);
        }

        let rows = sqlx::query(
            "SELECT document_id, paragraph_id, content, ordinal
             FROM chunks
             WHERE user_id = $1
               AND tsv @@ websearch_to_tsquery('english', $2)
             ORDER BY ts_rank_cd(tsv, websearch_to_tsquery('english', $2)) DESC
             LIMIT $3",
        )
        .bind(self.user_id().to_string())
        .bind(query)
        .bind(limit as i64)
        .fetch_all(&self.pool)
        .await
        .map_err(box_err)?;

        rows.iter().map(row_to_chunk_hit).collect()
    }

    // ── Embeddings ────────────────────────────────────────────────────────────

    async fn save_embeddings(&self, embedding: &Embedding) -> Result<(), StorageError> {
        let vector = Vector::from(embedding.vector.clone());
        sqlx::query(
            "INSERT INTO chunk_embeddings (user_id, document_id, paragraph_id, vector)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id, document_id, paragraph_id) DO UPDATE SET
                 vector = EXCLUDED.vector",
        )
        .bind(self.user_id().to_string())
        .bind(embedding.document_id.to_string())
        .bind(&embedding.paragraph_id)
        .bind(vector)
        .execute(&self.pool)
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
        sqlx::query(
            "DELETE FROM chunk_embeddings
             WHERE user_id = $1
               AND document_id = $2
               AND paragraph_id = ANY($3)",
        )
        .bind(self.user_id().to_string())
        .bind(document_id.to_string())
        .bind(paragraph_ids)
        .execute(&self.pool)
        .await
        .map_err(box_err)?;
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

        let query_vec = Vector::from(query.to_vec());

        let rows = sqlx::query(
            "SELECT ce.document_id, ce.paragraph_id, c.content, c.ordinal
             FROM chunk_embeddings ce
             JOIN chunks c
               ON c.user_id      = ce.user_id
              AND c.document_id  = ce.document_id
              AND c.paragraph_id = ce.paragraph_id
             WHERE ce.user_id = $1
             ORDER BY ce.vector <=> $2
             LIMIT $3",
        )
        .bind(self.user_id().to_string())
        .bind(query_vec)
        .bind(limit as i64)
        .fetch_all(&self.pool)
        .await
        .map_err(box_err)?;

        rows.iter().map(row_to_chunk_hit).collect()
    }
}

// ── Row helpers ───────────────────────────────────────────────────────────────

fn row_to_document(row: &sqlx::postgres::PgRow) -> Result<Document, StorageError> {
    let id_str: String = row.try_get("id").map_err(box_err)?;
    let id = Uuid::parse_str(&id_str).unwrap_or_default();
    let title: String = row.try_get("title").map_err(box_err)?;
    let owner: Option<String> = row.try_get("owner").map_err(box_err)?;
    let last_reviewed: Option<chrono::NaiveDate> = row.try_get("last_reviewed").map_err(box_err)?;
    let tags: Vec<String> = row.try_get("tags").map_err(box_err)?;
    let related_strs: Vec<String> = row.try_get("related_docs").map_err(box_err)?;
    let related_docs: Vec<Uuid> = related_strs
        .iter()
        .filter_map(|s| Uuid::parse_str(s).ok())
        .collect();
    let body: String = row.try_get("body").map_err(box_err)?;
    let folder_id_str: Option<String> = row.try_get("folder_id").map_err(box_err)?;
    let folder_id = folder_id_str
        .as_deref()
        .map(Uuid::parse_str)
        .transpose()
        .unwrap_or(None);

    Ok(Document {
        id,
        title,
        owner,
        last_reviewed,
        tags,
        related_docs,
        body,
        folder_id,
    })
}

fn pg_row_to_folder(row: &sqlx::postgres::PgRow) -> Result<Folder, StorageError> {
    let id_str: String = row.try_get("id").map_err(box_err)?;
    let id = Uuid::parse_str(&id_str).unwrap_or_default();
    let parent_str: Option<String> = row.try_get("parent_id").map_err(box_err)?;
    let parent_id = parent_str
        .as_deref()
        .map(Uuid::parse_str)
        .transpose()
        .unwrap_or(None);
    Ok(Folder {
        id,
        name: row.try_get("name").map_err(box_err)?,
        parent_id,
        created_at: row.try_get("created_at").map_err(box_err)?,
        updated_at: row.try_get("updated_at").map_err(box_err)?,
    })
}

fn row_to_chunk_hit(row: &sqlx::postgres::PgRow) -> Result<ChunkHit, StorageError> {
    let doc_id_str: String = row.try_get("document_id").map_err(box_err)?;
    let doc_id = Uuid::parse_str(&doc_id_str).unwrap_or_default();
    let para_id: String = row.try_get("paragraph_id").map_err(box_err)?;
    let content: String = row.try_get("content").map_err(box_err)?;
    let ordinal: i32 = row.try_get("ordinal").map_err(box_err)?;
    Ok(ChunkHit {
        document_id: doc_id,
        paragraph_id: para_id,
        content,
        ordinal: ordinal as u32,
    })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn content_hash(s: &str) -> String {
    let mut h = Sha256::new();
    h.update(s.as_bytes());
    format!("{:x}", h.finalize())
}

fn box_err<E: std::error::Error + Send + Sync + 'static>(e: E) -> StorageError {
    StorageError::Backend(Box::new(e))
}
