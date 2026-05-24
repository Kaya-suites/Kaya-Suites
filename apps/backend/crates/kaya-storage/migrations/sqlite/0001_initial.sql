-- SQLite schema for SqliteAdapter.
-- All IDs are TEXT (UUID strings). No user isolation — single-user adapter.

CREATE TABLE IF NOT EXISTS documents (
    id               TEXT    NOT NULL PRIMARY KEY,
    title            TEXT    NOT NULL,
    frontmatter_json TEXT    NOT NULL,
    content_hash     TEXT    NOT NULL,
    updated_at       TEXT    NOT NULL,
    deleted_at       TEXT,
    body             TEXT    NOT NULL DEFAULT '',
    folder_id        TEXT
);

CREATE TABLE IF NOT EXISTS folders (
    id         TEXT NOT NULL PRIMARY KEY,
    name       TEXT NOT NULL,
    parent_id  TEXT REFERENCES folders(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chunks (
    document_id  TEXT    NOT NULL,
    paragraph_id TEXT    NOT NULL,
    ordinal      INTEGER NOT NULL,
    content      TEXT    NOT NULL,
    content_hash TEXT    NOT NULL,
    PRIMARY KEY (document_id, paragraph_id)
);

CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(
    content,
    document_id  UNINDEXED,
    paragraph_id UNINDEXED,
    ordinal      UNINDEXED,
    tokenize     = 'unicode61'
);

CREATE TABLE IF NOT EXISTS chunk_embeddings (
    document_id  TEXT NOT NULL,
    paragraph_id TEXT NOT NULL,
    vector       BLOB NOT NULL,
    PRIMARY KEY (document_id, paragraph_id)
);
