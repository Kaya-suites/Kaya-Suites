// Integration tests for SqliteAdapter using sqlx::test.
//
// sqlx::test creates a fresh SQLite database per test and applies the migration
// automatically — no DATABASE_URL required.

use kaya_core::UserContext;
use kaya_core::storage::{Chunk, Document, Embedding, StorageAdapter, StorageError};
use kaya_storage::{SQLITE_MIGRATOR, SqliteAdapter};
use sqlx::SqlitePool;
use uuid::Uuid;

// ── Helpers ───────────────────────────────────────────────────────────────────

fn test_user_ctx() -> UserContext {
    let id = Uuid::parse_str("00000000-0000-0000-0000-000000000001").unwrap();
    UserContext { tenant_id: id, user_id: id }
}

fn make_doc() -> Document {
    Document {
        id: Uuid::new_v4(),
        title: "Test document".to_string(),
        owner: Some("alice".to_string()),
        last_reviewed: None,
        tags: vec!["rust".to_string()],
        related_docs: vec![],
        body: "First paragraph.\n\nSecond paragraph.".to_string(),
        folder_id: None,
        sort_order: 0,
    }
}

// ── Document CRUD ─────────────────────────────────────────────────────────────

/// save_document + get_document round-trip preserves all fields.
#[sqlx::test(migrator = "SQLITE_MIGRATOR")]
async fn round_trip(pool: SqlitePool) {
    let adapter = SqliteAdapter::from_pool(pool, test_user_ctx()).await.unwrap();
    let doc = make_doc();
    adapter.save_document(&doc).await.unwrap();

    let loaded = adapter.get_document(doc.id).await.unwrap();
    assert_eq!(loaded.id, doc.id);
    assert_eq!(loaded.title, doc.title);
    assert_eq!(loaded.owner, doc.owner);
    assert_eq!(loaded.tags, doc.tags);
    assert_eq!(loaded.body.trim(), doc.body.trim());
}

/// list_documents returns saved documents and excludes deleted ones.
#[sqlx::test(migrator = "SQLITE_MIGRATOR")]
async fn list_excludes_deleted(pool: SqlitePool) {
    let adapter = SqliteAdapter::from_pool(pool, test_user_ctx()).await.unwrap();

    let doc_a = make_doc();
    let doc_b = make_doc();
    adapter.save_document(&doc_a).await.unwrap();
    adapter.save_document(&doc_b).await.unwrap();
    adapter.delete_document(doc_b.id).await.unwrap();

    let list = adapter.list_documents().await.unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].id, doc_a.id);
}

/// get_document on a deleted ID returns NotFound.
#[sqlx::test(migrator = "SQLITE_MIGRATOR")]
async fn get_deleted_returns_not_found(pool: SqlitePool) {
    let adapter = SqliteAdapter::from_pool(pool, test_user_ctx()).await.unwrap();
    let doc = make_doc();
    adapter.save_document(&doc).await.unwrap();
    adapter.delete_document(doc.id).await.unwrap();

    assert!(matches!(
        adapter.get_document(doc.id).await,
        Err(StorageError::NotFound(_))
    ));
}

/// save_document is idempotent — re-saving updates the record without duplication.
#[sqlx::test(migrator = "SQLITE_MIGRATOR")]
async fn save_is_idempotent(pool: SqlitePool) {
    let adapter = SqliteAdapter::from_pool(pool, test_user_ctx()).await.unwrap();
    let doc = make_doc();
    adapter.save_document(&doc).await.unwrap();

    let updated = Document {
        title: "Updated title".to_string(),
        body: "New body.".to_string(),
        ..doc.clone()
    };
    adapter.save_document(&updated).await.unwrap();

    let list = adapter.list_documents().await.unwrap();
    assert_eq!(list.len(), 1, "no duplicate rows on re-save");
    assert_eq!(list[0].title, "Updated title");
}

// ── Folder operations ─────────────────────────────────────────────────────────

/// create_folder + list_folders round-trip.
#[sqlx::test(migrator = "SQLITE_MIGRATOR")]
async fn folder_create_and_list(pool: SqlitePool) {
    let adapter = SqliteAdapter::from_pool(pool, test_user_ctx()).await.unwrap();

    let folder = adapter.create_folder("Notes", None).await.unwrap();
    assert_eq!(folder.name, "Notes");
    assert!(folder.parent_id.is_none());
    assert_eq!(folder.sort_order, 0);

    let list = adapter.list_folders().await.unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].id, folder.id);
}

/// rename_folder changes the name returned by get_folder.
#[sqlx::test(migrator = "SQLITE_MIGRATOR")]
async fn folder_rename(pool: SqlitePool) {
    let adapter = SqliteAdapter::from_pool(pool, test_user_ctx()).await.unwrap();
    let folder = adapter.create_folder("Old name", None).await.unwrap();

    let renamed = adapter.rename_folder(folder.id, "New name").await.unwrap();
    assert_eq!(renamed.name, "New name");

    let fetched = adapter.get_folder(folder.id).await.unwrap();
    assert_eq!(fetched.name, "New name");
}

/// move_document_to_folder scopes it to that folder in list_documents_in_folder.
#[sqlx::test(migrator = "SQLITE_MIGRATOR")]
async fn move_document_to_folder(pool: SqlitePool) {
    let adapter = SqliteAdapter::from_pool(pool, test_user_ctx()).await.unwrap();

    let folder = adapter.create_folder("Archive", None).await.unwrap();
    let doc = make_doc();
    adapter.save_document(&doc).await.unwrap();

    // Before move: root has the document, folder is empty.
    let root_docs = adapter.list_documents_in_folder(None).await.unwrap();
    assert_eq!(root_docs.len(), 1);
    let folder_docs = adapter
        .list_documents_in_folder(Some(folder.id))
        .await
        .unwrap();
    assert!(folder_docs.is_empty());

    adapter
        .move_document_to_folder(doc.id, Some(folder.id))
        .await
        .unwrap();

    // After move: root is empty, folder has the document.
    let root_docs = adapter.list_documents_in_folder(None).await.unwrap();
    assert!(root_docs.is_empty());
    let folder_docs = adapter
        .list_documents_in_folder(Some(folder.id))
        .await
        .unwrap();
    assert_eq!(folder_docs.len(), 1);
    assert_eq!(folder_docs[0].id, doc.id);
}

/// move_folder can reorder siblings without changing parents.
#[sqlx::test(migrator = "SQLITE_MIGRATOR")]
async fn move_folder_reorders_siblings(pool: SqlitePool) {
    let adapter = SqliteAdapter::from_pool(pool, test_user_ctx()).await.unwrap();

    let first = adapter.create_folder("First", None).await.unwrap();
    let second = adapter.create_folder("Second", None).await.unwrap();
    let third = adapter.create_folder("Third", None).await.unwrap();

    let moved = adapter.move_folder(third.id, None, Some(1)).await.unwrap();
    assert_eq!(moved.parent_id, None);
    assert_eq!(moved.sort_order, 1);

    let ordered_ids: Vec<Uuid> = adapter
        .list_folders()
        .await
        .unwrap()
        .into_iter()
        .filter(|folder| folder.parent_id.is_none())
        .map(|folder| folder.id)
        .collect();

    assert_eq!(ordered_ids, vec![first.id, third.id, second.id]);
}

// ── Chunks + FTS ──────────────────────────────────────────────────────────────

/// save_chunk makes content findable via search_text.
#[sqlx::test(migrator = "SQLITE_MIGRATOR")]
async fn fts_finds_saved_chunk(pool: SqlitePool) {
    let adapter = SqliteAdapter::from_pool(pool, test_user_ctx()).await.unwrap();
    let doc = make_doc();
    adapter.save_document(&doc).await.unwrap();

    let chunk = Chunk {
        document_id: doc.id,
        paragraph_id: "p0".to_string(),
        content: "xyzzy_unique_fts_keyword in this chunk".to_string(),
        ordinal: 0,
    };
    adapter.save_chunk(&chunk).await.unwrap();

    let hits = adapter
        .search_text("xyzzy_unique_fts_keyword", 5)
        .await
        .unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].paragraph_id, "p0");
    assert_eq!(hits[0].document_id, doc.id);
}

/// Deleted document's chunks do not appear in search_text.
#[sqlx::test(migrator = "SQLITE_MIGRATOR")]
async fn fts_excludes_deleted_document_chunks(pool: SqlitePool) {
    let adapter = SqliteAdapter::from_pool(pool, test_user_ctx()).await.unwrap();
    let doc = make_doc();
    adapter.save_document(&doc).await.unwrap();

    adapter
        .save_chunk(&Chunk {
            document_id: doc.id,
            paragraph_id: "p0".to_string(),
            content: "xyzzy_deleted_doc_chunk".to_string(),
            ordinal: 0,
        })
        .await
        .unwrap();

    adapter.delete_document(doc.id).await.unwrap();

    let hits = adapter
        .search_text("xyzzy_deleted_doc_chunk", 5)
        .await
        .unwrap();
    assert!(
        hits.is_empty(),
        "chunks from deleted documents must not appear in FTS"
    );
}

/// get_chunk_hashes returns one entry per saved chunk.
#[sqlx::test(migrator = "SQLITE_MIGRATOR")]
async fn chunk_hashes_round_trip(pool: SqlitePool) {
    let adapter = SqliteAdapter::from_pool(pool, test_user_ctx()).await.unwrap();
    let doc = make_doc();
    adapter.save_document(&doc).await.unwrap();

    for i in 0..3u32 {
        adapter
            .save_chunk(&Chunk {
                document_id: doc.id,
                paragraph_id: format!("p{i}"),
                content: format!("Paragraph {i} content."),
                ordinal: i,
            })
            .await
            .unwrap();
    }

    let hashes = adapter.get_chunk_hashes(doc.id).await.unwrap();
    assert_eq!(hashes.len(), 3);
    let para_ids: Vec<&str> = hashes.iter().map(|(p, _)| p.as_str()).collect();
    assert!(para_ids.contains(&"p0"));
    assert!(para_ids.contains(&"p1"));
    assert!(para_ids.contains(&"p2"));
}

// ── Embeddings ────────────────────────────────────────────────────────────────

/// save_embeddings + search_embeddings round-trip.
#[sqlx::test(migrator = "SQLITE_MIGRATOR")]
async fn embedding_round_trip(pool: SqlitePool) {
    let adapter = SqliteAdapter::from_pool(pool, test_user_ctx()).await.unwrap();
    let doc = make_doc();
    adapter.save_document(&doc).await.unwrap();

    adapter
        .save_chunk(&Chunk {
            document_id: doc.id,
            paragraph_id: "p0".to_string(),
            content: "embedding test".to_string(),
            ordinal: 0,
        })
        .await
        .unwrap();

    let dim = 3_usize;
    let v: Vec<f32> = vec![1.0, 0.0, 0.0];
    adapter
        .save_embeddings(&Embedding {
            document_id: doc.id,
            paragraph_id: "p0".to_string(),
            vector: v.clone(),
        })
        .await
        .unwrap();

    let hits = adapter.search_embeddings(&v, 5).await.unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].paragraph_id, "p0");
    let _ = dim; // suppress unused warning
}

/// Deleted document's embeddings do not appear in vector search.
#[sqlx::test(migrator = "SQLITE_MIGRATOR")]
async fn embeddings_exclude_deleted_document(pool: SqlitePool) {
    let adapter = SqliteAdapter::from_pool(pool, test_user_ctx()).await.unwrap();
    let doc = make_doc();
    adapter.save_document(&doc).await.unwrap();

    adapter
        .save_chunk(&Chunk {
            document_id: doc.id,
            paragraph_id: "p0".to_string(),
            content: "embedding cleanup guard".to_string(),
            ordinal: 0,
        })
        .await
        .unwrap();

    let v = vec![1.0_f32, 0.0, 0.0];
    adapter
        .save_embeddings(&Embedding {
            document_id: doc.id,
            paragraph_id: "p0".to_string(),
            vector: v.clone(),
        })
        .await
        .unwrap();

    adapter.delete_document(doc.id).await.unwrap();

    let hits = adapter.search_embeddings(&v, 5).await.unwrap();
    assert!(
        hits.is_empty(),
        "embeddings from deleted documents must not appear in vector search"
    );
}

/// Nearest-neighbour ordering: the most similar vector ranks first.
#[sqlx::test(migrator = "SQLITE_MIGRATOR")]
async fn embedding_cosine_order(pool: SqlitePool) {
    let adapter = SqliteAdapter::from_pool(pool, test_user_ctx()).await.unwrap();

    let doc_a = make_doc();
    let doc_b = Document {
        id: Uuid::new_v4(),
        title: "B".to_string(),
        body: "beta".to_string(),
        ..make_doc()
    };
    adapter.save_document(&doc_a).await.unwrap();
    adapter.save_document(&doc_b).await.unwrap();

    for (doc, para, vec) in [
        (&doc_a, "p0", vec![1.0_f32, 0.0, 0.0]),
        (&doc_b, "p0", vec![0.0_f32, 1.0, 0.0]),
    ] {
        adapter
            .save_chunk(&Chunk {
                document_id: doc.id,
                paragraph_id: para.to_string(),
                content: "content".to_string(),
                ordinal: 0,
            })
            .await
            .unwrap();
        adapter
            .save_embeddings(&Embedding {
                document_id: doc.id,
                paragraph_id: para.to_string(),
                vector: vec,
            })
            .await
            .unwrap();
    }

    // Query vector aligned with doc_a.
    let hits = adapter
        .search_embeddings(&[1.0, 0.0, 0.0], 2)
        .await
        .unwrap();
    assert_eq!(hits.len(), 2);
    assert_eq!(hits[0].document_id, doc_a.id, "doc_a must rank first");
}

// ── Migration idempotency ─────────────────────────────────────────────────────

/// Running the SQLite migrator twice against the same database must succeed.
#[sqlx::test(migrator = "SQLITE_MIGRATOR")]
async fn migration_is_idempotent(pool: SqlitePool) {
    SQLITE_MIGRATOR
        .run(&pool)
        .await
        .expect("second migration run must be idempotent");
}
