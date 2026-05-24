// Integration tests for MySqlAdapter.
//
// These tests require a MySQL (or MariaDB) instance.
// Set DATABASE_URL before running:
//
//   export DATABASE_URL=mysql://user:pass@host/db
//   cargo test -p kaya-storage mysql_
//
// sqlx::test creates a temporary database per test, applies all migrations via
// MYSQL_MIGRATOR, and drops the database when the test completes.

use kaya_core::UserContext;
use kaya_core::storage::{Chunk, Document, Embedding, StorageAdapter, StorageError};
use kaya_storage::{MySqlAdapter, MYSQL_MIGRATOR};
use sqlx::MySqlPool;
use uuid::Uuid;

// ── Helpers ───────────────────────────────────────────────────────────────────

fn make_doc() -> Document {
    Document {
        id: Uuid::new_v4(),
        title: "Test document".to_string(),
        owner: Some("alice".to_string()),
        last_reviewed: None,
        tags: vec!["rust".to_string(), "test".to_string()],
        related_docs: vec![],
        body: "First paragraph.\n\nSecond paragraph.".to_string(),
        folder_id: None,
    }
}

fn make_user_ctx(user_id: Uuid) -> UserContext {
    UserContext {
        user_id,
        tenant_id: Uuid::nil(),
    }
}

// ── Document isolation ────────────────────────────────────────────────────────

/// FR-4 / NFR §6.3: User A writes a document; User B's adapter cannot see it.
#[ignore = "requires DATABASE_URL pointing to a MySQL instance"]
#[sqlx::test(migrator = "MYSQL_MIGRATOR")]
async fn user_b_cannot_read_user_a_document(pool: MySqlPool) {
    let uid_a = Uuid::new_v4();
    let uid_b = Uuid::new_v4();

    let adapter_a = MySqlAdapter::new(pool.clone(), make_user_ctx(uid_a));
    let adapter_b = MySqlAdapter::new(pool.clone(), make_user_ctx(uid_b));

    let doc = make_doc();
    adapter_a.save_document(&doc).await.expect("save by user A");

    let result = adapter_b.get_document(doc.id).await;
    assert!(
        matches!(result, Err(StorageError::NotFound(_))),
        "user B must not read user A's document, got: {result:?}"
    );
}

/// User B's list_documents must not contain any of User A's documents.
#[ignore = "requires DATABASE_URL pointing to a MySQL instance"]
#[sqlx::test(migrator = "MYSQL_MIGRATOR")]
async fn list_documents_is_scoped_to_user(pool: MySqlPool) {
    let uid_a = Uuid::new_v4();
    let uid_b = Uuid::new_v4();

    let adapter_a = MySqlAdapter::new(pool.clone(), make_user_ctx(uid_a));
    let adapter_b = MySqlAdapter::new(pool.clone(), make_user_ctx(uid_b));

    let doc_a1 = make_doc();
    let doc_a2 = make_doc();
    adapter_a.save_document(&doc_a1).await.unwrap();
    adapter_a.save_document(&doc_a2).await.unwrap();

    let list_b = adapter_b.list_documents().await.unwrap();
    assert!(list_b.is_empty(), "user B must see no documents");

    let list_a = adapter_a.list_documents().await.unwrap();
    assert_eq!(list_a.len(), 2, "user A must see both their documents");
}

/// delete_document soft-deletes and makes the document invisible to list/get.
#[ignore = "requires DATABASE_URL pointing to a MySQL instance"]
#[sqlx::test(migrator = "MYSQL_MIGRATOR")]
async fn delete_document_hides_from_owner(pool: MySqlPool) {
    let uid = Uuid::new_v4();
    let adapter = MySqlAdapter::new(pool, make_user_ctx(uid));

    let doc = make_doc();
    adapter.save_document(&doc).await.unwrap();
    adapter.delete_document(doc.id).await.unwrap();

    assert!(
        matches!(
            adapter.get_document(doc.id).await,
            Err(StorageError::NotFound(_))
        ),
        "deleted document must not be retrievable"
    );
    assert!(adapter.list_documents().await.unwrap().is_empty());
}

// ── Chunk and FTS isolation ───────────────────────────────────────────────────

/// search_text (LIKE) results are isolated per user.
#[ignore = "requires DATABASE_URL pointing to a MySQL instance"]
#[sqlx::test(migrator = "MYSQL_MIGRATOR")]
async fn fts_search_is_scoped_to_user(pool: MySqlPool) {
    let uid_a = Uuid::new_v4();
    let uid_b = Uuid::new_v4();

    let adapter_a = MySqlAdapter::new(pool.clone(), make_user_ctx(uid_a));
    let adapter_b = MySqlAdapter::new(pool.clone(), make_user_ctx(uid_b));

    let doc = make_doc();
    adapter_a.save_document(&doc).await.unwrap();

    let chunk = Chunk {
        document_id: doc.id,
        paragraph_id: "para0".to_string(),
        content: "xyzzy_unique_mysql_keyword for testing".to_string(),
        ordinal: 0,
    };
    adapter_a.save_chunk(&chunk).await.unwrap();

    let hits_b = adapter_b
        .search_text("xyzzy_unique_mysql_keyword", 10)
        .await
        .unwrap();
    assert!(hits_b.is_empty(), "user B must not see user A's chunks");

    let hits_a = adapter_a
        .search_text("xyzzy_unique_mysql_keyword", 10)
        .await
        .unwrap();
    assert_eq!(hits_a.len(), 1);
    assert_eq!(hits_a[0].paragraph_id, "para0");
}

// ── Embedding isolation ───────────────────────────────────────────────────────

/// User A's embeddings must not appear in User B's vector search results.
#[ignore = "requires DATABASE_URL pointing to a MySQL instance"]
#[sqlx::test(migrator = "MYSQL_MIGRATOR")]
async fn vector_search_is_scoped_to_user(pool: MySqlPool) {
    let uid_a = Uuid::new_v4();
    let uid_b = Uuid::new_v4();

    let adapter_a = MySqlAdapter::new(pool.clone(), make_user_ctx(uid_a));
    let adapter_b = MySqlAdapter::new(pool.clone(), make_user_ctx(uid_b));

    let doc = make_doc();
    adapter_a.save_document(&doc).await.unwrap();

    adapter_a
        .save_chunk(&Chunk {
            document_id: doc.id,
            paragraph_id: "para0".to_string(),
            content: "semantic search test paragraph".to_string(),
            ordinal: 0,
        })
        .await
        .unwrap();

    // 3-dimensional unit vector (MySQL stores BLOB, so dimension is flexible).
    let unit_vec: Vec<f32> = vec![1.0, 0.0, 0.0];

    adapter_a
        .save_embeddings(&Embedding {
            document_id: doc.id,
            paragraph_id: "para0".to_string(),
            vector: unit_vec.clone(),
        })
        .await
        .unwrap();

    let hits_b = adapter_b.search_embeddings(&unit_vec, 5).await.unwrap();
    assert!(hits_b.is_empty(), "user B must not see user A's embeddings");

    let hits_a = adapter_a.search_embeddings(&unit_vec, 5).await.unwrap();
    assert_eq!(hits_a.len(), 1, "user A must find their own embedding");
    assert_eq!(hits_a[0].paragraph_id, "para0");
}

// ── Chunk hash isolation ──────────────────────────────────────────────────────

/// get_chunk_hashes returns only this user's hashes for the given document.
#[ignore = "requires DATABASE_URL pointing to a MySQL instance"]
#[sqlx::test(migrator = "MYSQL_MIGRATOR")]
async fn chunk_hashes_are_scoped(pool: MySqlPool) {
    let uid_a = Uuid::new_v4();
    let uid_b = Uuid::new_v4();

    let doc_a = make_doc();
    let doc_b = make_doc();

    let adapter_a = MySqlAdapter::new(pool.clone(), make_user_ctx(uid_a));
    let adapter_b = MySqlAdapter::new(pool.clone(), make_user_ctx(uid_b));

    adapter_a.save_document(&doc_a).await.unwrap();
    adapter_b.save_document(&doc_b).await.unwrap();

    adapter_a
        .save_chunk(&Chunk {
            document_id: doc_a.id,
            paragraph_id: "p0".to_string(),
            content: "user A content".to_string(),
            ordinal: 0,
        })
        .await
        .unwrap();
    adapter_b
        .save_chunk(&Chunk {
            document_id: doc_b.id,
            paragraph_id: "p0".to_string(),
            content: "user B content".to_string(),
            ordinal: 0,
        })
        .await
        .unwrap();

    let hashes_a = adapter_a.get_chunk_hashes(doc_a.id).await.unwrap();
    assert_eq!(hashes_a.len(), 1);

    let hashes_b_for_a_doc = adapter_b.get_chunk_hashes(doc_a.id).await.unwrap();
    assert!(
        hashes_b_for_a_doc.is_empty(),
        "user B must not see user A's chunk hashes"
    );
}

// ── Migration idempotency ─────────────────────────────────────────────────────

/// Running the migrator twice against the same database must succeed.
#[ignore = "requires DATABASE_URL pointing to a MySQL instance"]
#[sqlx::test(migrator = "MYSQL_MIGRATOR")]
async fn migration_is_idempotent(pool: MySqlPool) {
    MYSQL_MIGRATOR
        .run(&pool)
        .await
        .expect("second migration run must be idempotent");
}
