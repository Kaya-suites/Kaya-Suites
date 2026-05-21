// Copyright 2024 Kaya Suites. Licensed under the Apache License, Version 2.0.
//!
//! MySQL-backed `StorageAdapter` for Kaya Suites OSS.
//!
//! # Design notes
//! - IDs are VARCHAR(36) strings.
//! - Full-text search uses LIKE for V1 (no FTS index required).
//! - Vector embeddings are stored as MEDIUMBLOB (packed f32 little-endian).
//! - Upserts use `INSERT INTO ... ON DUPLICATE KEY UPDATE`.

use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use async_trait::async_trait;
use sqlx::{MySqlPool, Row};
use uuid::Uuid;

use kaya_core::storage::{Chunk, ChunkHit, Document, Embedding, StorageAdapter, StorageError};
use kaya_core::UserContext;

use crate::document::{sha256_hex, to_markdown};

// ── Inner shared state ────────────────────────────────────────────────────────

struct Inner {
    pool: MySqlPool,
    content_dir: PathBuf,
    user_context: UserContext,
}

// ── Adapter ───────────────────────────────────────────────────────────────────

/// MySQL-backed storage adapter (OSS / Apache 2.0).
pub struct MySqlAdapter {
    inner: Arc<Inner>,
}

impl MySqlAdapter {
    /// Construct a new adapter scoped to the given user context.
    pub fn new(pool: MySqlPool, user_context: UserContext) -> Self {
        let content_dir = PathBuf::from("content");
        Self {
            inner: Arc::new(Inner { pool, content_dir, user_context }),
        }
    }

    /// Construct with an explicit content directory.
    pub fn with_content_dir(pool: MySqlPool, user_context: UserContext, content_dir: PathBuf) -> Self {
        Self {
            inner: Arc::new(Inner { pool, content_dir, user_context }),
        }
    }

    /// Create MySQL tables for the storage adapter.
    ///
    /// Idempotent — uses `CREATE TABLE IF NOT EXISTS`.
    pub async fn run_migrations(pool: &MySqlPool) -> Result<(), StorageError> {
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS documents (
                id               VARCHAR(36)  NOT NULL,
                user_id          VARCHAR(36)  NOT NULL,
                title            TEXT         NOT NULL,
                path             TEXT         NOT NULL,
                frontmatter_json MEDIUMTEXT   NOT NULL,
                content_hash     VARCHAR(64)  NOT NULL,
                updated_at       VARCHAR(32)  NOT NULL,
                deleted_at       VARCHAR(32),
                body             MEDIUMTEXT,
                PRIMARY KEY (id),
                KEY documents_user_idx (user_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        )
        .execute(pool)
        .await
        .map_err(box_err)?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS chunks (
                user_id      VARCHAR(36)  NOT NULL,
                document_id  VARCHAR(36)  NOT NULL,
                paragraph_id VARCHAR(255) NOT NULL,
                ordinal      INT          NOT NULL,
                content      MEDIUMTEXT   NOT NULL,
                content_hash VARCHAR(64)  NOT NULL,
                PRIMARY KEY (user_id, document_id, paragraph_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        )
        .execute(pool)
        .await
        .map_err(box_err)?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS chunk_embeddings (
                user_id      VARCHAR(36)  NOT NULL,
                document_id  VARCHAR(36)  NOT NULL,
                paragraph_id VARCHAR(255) NOT NULL,
                vector       MEDIUMBLOB   NOT NULL,
                PRIMARY KEY (user_id, document_id, paragraph_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        )
        .execute(pool)
        .await
        .map_err(box_err)?;

        Ok(())
    }

    fn user_id(&self) -> Uuid {
        self.inner.user_context.user_id
    }
}

// ── StorageAdapter implementation ─────────────────────────────────────────────

#[async_trait]
impl StorageAdapter for MySqlAdapter {
    async fn get_document(&self, id: Uuid) -> Result<Document, StorageError> {
        let row = sqlx::query(
            "SELECT path, frontmatter_json, body, deleted_at FROM documents
             WHERE id = ? AND user_id = ?",
        )
        .bind(id.to_string())
        .bind(self.user_id().to_string())
        .fetch_optional(&self.inner.pool)
        .await
        .map_err(box_err)?;

        let row = row.ok_or(StorageError::NotFound(id))?;

        let deleted_at: Option<String> = row.try_get("deleted_at").map_err(box_err)?;
        if deleted_at.is_some() {
            return Err(StorageError::NotFound(id));
        }

        let rel_path: String = row.try_get("path").map_err(box_err)?;
        let db_body: Option<String> = row.try_get("body").map_err(box_err)?;

        if let Some(body) = db_body {
            let fm_json: String = row.try_get("frontmatter_json").map_err(box_err)?;
            if let Ok(mut doc) = serde_json::from_str::<Document>(&fm_json) {
                doc.body = body;
                doc.path = Some(PathBuf::from(rel_path));
                return Ok(doc);
            }
        }

        // Fallback: disk read
        let abs_path = self.inner.content_dir.join(&rel_path);
        let raw = tokio::fs::read_to_string(&abs_path).await.map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                StorageError::NotFound(id)
            } else {
                box_err(e)
            }
        })?;
        let (mut doc, _) = crate::document::parse_document(&raw).map_err(box_err)?;
        doc.path = Some(PathBuf::from(rel_path));
        Ok(doc)
    }

    async fn save_document(&self, doc: &Document) -> Result<(), StorageError> {
        let rel_path = doc
            .path
            .clone()
            .unwrap_or_else(|| PathBuf::from(format!("{}.md", doc.id)));
        let abs_path = self.inner.content_dir.join(&rel_path);
        if let Some(parent) = abs_path.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(box_err)?;
        }
        let markdown = to_markdown(doc).map_err(box_err)?;
        tokio::fs::write(&abs_path, &markdown).await.map_err(box_err)?;

        let rel_str = rel_path.to_string_lossy().to_string();
        let hash = sha256_hex(doc.body.as_bytes());
        let fm_json = serde_json::to_string(doc).map_err(box_err)?;
        let now = chrono::Utc::now().to_rfc3339();

        sqlx::query(
            "INSERT INTO documents (id, user_id, title, path, frontmatter_json, content_hash, updated_at, deleted_at, body)
             VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
             ON DUPLICATE KEY UPDATE
               title            = VALUES(title),
               path             = VALUES(path),
               frontmatter_json = VALUES(frontmatter_json),
               content_hash     = VALUES(content_hash),
               updated_at       = VALUES(updated_at),
               deleted_at       = NULL,
               body             = VALUES(body)",
        )
        .bind(doc.id.to_string())
        .bind(self.user_id().to_string())
        .bind(&doc.title)
        .bind(&rel_str)
        .bind(&fm_json)
        .bind(&hash)
        .bind(&now)
        .bind(&doc.body)
        .execute(&self.inner.pool)
        .await
        .map_err(box_err)?;

        Ok(())
    }

    async fn delete_document(&self, id: Uuid) -> Result<(), StorageError> {
        let id_str = id.to_string();
        let row = sqlx::query(
            "SELECT path FROM documents WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
        )
        .bind(&id_str)
        .bind(self.user_id().to_string())
        .fetch_optional(&self.inner.pool)
        .await
        .map_err(box_err)?;

        if let Some(row) = row {
            let path: String = row.try_get("path").map_err(box_err)?;
            let abs_path = self.inner.content_dir.join(&path);
            let _ = tokio::fs::remove_file(&abs_path).await;

            let now = chrono::Utc::now().to_rfc3339();
            sqlx::query(
                "UPDATE documents SET deleted_at = ? WHERE id = ? AND user_id = ?",
            )
            .bind(&now)
            .bind(&id_str)
            .bind(self.user_id().to_string())
            .execute(&self.inner.pool)
            .await
            .map_err(box_err)?;

            self.delete_chunks_for_document(id).await?;
            sqlx::query(
                "DELETE FROM chunk_embeddings WHERE document_id = ? AND user_id = ?",
            )
            .bind(&id_str)
            .bind(self.user_id().to_string())
            .execute(&self.inner.pool)
            .await
            .map_err(box_err)?;
        }

        Ok(())
    }

    async fn list_documents(&self) -> Result<Vec<Document>, StorageError> {
        let rows = sqlx::query(
            "SELECT path, frontmatter_json, body FROM documents
             WHERE user_id = ? AND deleted_at IS NULL
             ORDER BY updated_at DESC",
        )
        .bind(self.user_id().to_string())
        .fetch_all(&self.inner.pool)
        .await
        .map_err(box_err)?;

        let mut docs = Vec::with_capacity(rows.len());
        for row in rows {
            let rel_path: String = row.try_get("path").map_err(box_err)?;
            let db_body: Option<String> = row.try_get("body").map_err(box_err)?;

            if let Some(body) = db_body {
                let fm_json: String = row.try_get("frontmatter_json").map_err(box_err)?;
                if let Ok(mut doc) = serde_json::from_str::<Document>(&fm_json) {
                    doc.body = body;
                    doc.path = Some(PathBuf::from(rel_path));
                    docs.push(doc);
                }
            }
        }
        Ok(docs)
    }

    async fn save_chunk(&self, chunk: &Chunk) -> Result<(), StorageError> {
        let doc_id = chunk.document_id.to_string();
        let content_hash = sha256_hex(chunk.content.as_bytes());

        sqlx::query(
            "INSERT INTO chunks (user_id, document_id, paragraph_id, ordinal, content, content_hash)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               ordinal      = VALUES(ordinal),
               content      = VALUES(content),
               content_hash = VALUES(content_hash)",
        )
        .bind(self.user_id().to_string())
        .bind(&doc_id)
        .bind(&chunk.paragraph_id)
        .bind(chunk.ordinal as i32)
        .bind(&chunk.content)
        .bind(&content_hash)
        .execute(&self.inner.pool)
        .await
        .map_err(box_err)?;

        Ok(())
    }

    async fn delete_chunks_for_document(&self, document_id: Uuid) -> Result<(), StorageError> {
        sqlx::query(
            "DELETE FROM chunks WHERE user_id = ? AND document_id = ?",
        )
        .bind(self.user_id().to_string())
        .bind(document_id.to_string())
        .execute(&self.inner.pool)
        .await
        .map_err(box_err)?;
        Ok(())
    }

    async fn get_chunk_hashes(
        &self,
        document_id: Uuid,
    ) -> Result<Vec<(String, String)>, StorageError> {
        let rows = sqlx::query(
            "SELECT paragraph_id, content_hash FROM chunks
             WHERE user_id = ? AND document_id = ?",
        )
        .bind(self.user_id().to_string())
        .bind(document_id.to_string())
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

    /// Full-text search via LIKE (V1 — no FTS index required).
    async fn search_text(
        &self,
        query: &str,
        limit: usize,
    ) -> Result<Vec<ChunkHit>, StorageError> {
        if query.trim().is_empty() {
            return Ok(vec![]);
        }

        let pattern = format!("%{}%", query.replace('%', "\\%").replace('_', "\\_"));

        let rows = sqlx::query(
            "SELECT document_id, paragraph_id, content, ordinal FROM chunks
             WHERE user_id = ? AND content LIKE ?
             LIMIT ?",
        )
        .bind(self.user_id().to_string())
        .bind(&pattern)
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
                let ordinal: i32 = row.try_get("ordinal").map_err(box_err)?;
                Ok(ChunkHit {
                    document_id: doc_id,
                    paragraph_id: para_id,
                    content,
                    ordinal: ordinal as u32,
                })
            })
            .collect()
    }

    async fn save_embeddings(&self, embedding: &Embedding) -> Result<(), StorageError> {
        let doc_id = embedding.document_id.to_string();
        let blob = encode_f32(&embedding.vector);

        sqlx::query(
            "INSERT INTO chunk_embeddings (user_id, document_id, paragraph_id, vector)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE vector = VALUES(vector)",
        )
        .bind(self.user_id().to_string())
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
            sqlx::query(
                "DELETE FROM chunk_embeddings
                 WHERE user_id = ? AND document_id = ? AND paragraph_id = ?",
            )
            .bind(self.user_id().to_string())
            .bind(&doc_id)
            .bind(para_id)
            .execute(&self.inner.pool)
            .await
            .map_err(box_err)?;
        }
        Ok(())
    }

    /// In-memory cosine-similarity vector search (same approach as SQLite adapter).
    async fn search_embeddings(
        &self,
        query: &[f32],
        limit: usize,
    ) -> Result<Vec<ChunkHit>, StorageError> {
        if query.is_empty() {
            return Ok(vec![]);
        }

        let rows = sqlx::query(
            "SELECT ce.document_id, ce.paragraph_id, ce.vector, c.content, c.ordinal
             FROM chunk_embeddings ce
             JOIN chunks c
               ON c.user_id      = ce.user_id
              AND c.document_id  = ce.document_id
              AND c.paragraph_id = ce.paragraph_id
             WHERE ce.user_id = ?",
        )
        .bind(self.user_id().to_string())
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
                let ordinal: i32 = row.try_get("ordinal").ok()?;

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

        scored.sort_unstable_by(|a, b| {
            b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal)
        });

        Ok(scored.into_iter().take(limit).map(|(_, hit)| hit).collect())
    }
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
    if na == 0.0 || nb == 0.0 { 0.0 } else { dot / (na * nb) }
}

// ── Error helpers ─────────────────────────────────────────────────────────────

fn box_err<E: std::error::Error + Send + Sync + 'static>(e: E) -> StorageError {
    StorageError::Backend(Box::new(e))
}
