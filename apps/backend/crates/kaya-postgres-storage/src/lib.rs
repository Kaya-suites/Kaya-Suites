// Copyright 2024 Kaya Suites. Licensed under the Apache License, Version 2.0.
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

pub mod session;

pub use session::PostgresSessionStorage;

use async_trait::async_trait;
use kaya_core::storage::{Chunk, ChunkHit, Document, Embedding, StorageAdapter, StorageError};
use kaya_core::UserContext;
use pgvector::Vector;
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};
use uuid::Uuid;

// ── Migration handle ──────────────────────────────────────────────────────────

/// sqlx migrator for the legacy Postgres schema.
/// NOTE: kaya-oss uses kaya-db::run_migrations instead; this migrator is kept
/// for backward compatibility only.
pub static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!();

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

    #[allow(dead_code)]
    pub(crate) async fn migrate(pool: &PgPool) -> Result<(), sqlx::migrate::MigrateError> {
        MIGRATOR.run(pool).await
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
            "SELECT id, title, owner, last_reviewed, tags, related_docs, body
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

        // Convert related_docs to Vec<String> for the TEXT[] column.
        let related: Vec<String> = doc.related_docs.iter().map(|u| u.to_string()).collect();

        sqlx::query(
            "INSERT INTO documents
                 (id, user_id, title, owner, last_reviewed, tags, related_docs,
                  body, content_hash, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
             ON CONFLICT (id) DO UPDATE SET
                 title        = EXCLUDED.title,
                 owner        = EXCLUDED.owner,
                 last_reviewed = EXCLUDED.last_reviewed,
                 tags         = EXCLUDED.tags,
                 related_docs = EXCLUDED.related_docs,
                 body         = EXCLUDED.body,
                 content_hash = EXCLUDED.content_hash,
                 updated_at   = EXCLUDED.updated_at,
                 deleted_at   = NULL",
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
            "SELECT id, title, owner, last_reviewed, tags, related_docs, body
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
        sqlx::query(
            "DELETE FROM chunks WHERE user_id = $1 AND document_id = $2",
        )
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

    async fn search_text(
        &self,
        query: &str,
        limit: usize,
    ) -> Result<Vec<ChunkHit>, StorageError> {
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
    let last_reviewed: Option<chrono::NaiveDate> =
        row.try_get("last_reviewed").map_err(box_err)?;
    let tags: Vec<String> = row.try_get("tags").map_err(box_err)?;
    // related_docs is now stored as TEXT[] — parse each string as Uuid
    let related_strs: Vec<String> = row.try_get("related_docs").map_err(box_err)?;
    let related_docs: Vec<Uuid> = related_strs
        .iter()
        .filter_map(|s| Uuid::parse_str(s).ok())
        .collect();
    let body: String = row.try_get("body").map_err(box_err)?;

    Ok(Document {
        id,
        title,
        owner,
        last_reviewed,
        tags,
        related_docs,
        body,
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
