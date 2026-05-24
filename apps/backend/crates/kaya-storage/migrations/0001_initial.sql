-- Initial schema for PostgresAdapter (pgvector required).

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS users (
    id            VARCHAR(36)  NOT NULL,
    email         TEXT         NOT NULL,
    username      TEXT         UNIQUE,
    password_hash TEXT,
    is_superadmin BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (id),
    UNIQUE (email)
);

CREATE TABLE IF NOT EXISTS folders (
    id         VARCHAR(36) NOT NULL,
    user_id    VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT        NOT NULL,
    parent_id  VARCHAR(36) REFERENCES folders(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS documents (
    id            VARCHAR(36)  NOT NULL,
    user_id       VARCHAR(36)  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title         TEXT         NOT NULL,
    owner         TEXT,
    last_reviewed DATE,
    tags          TEXT[]       NOT NULL DEFAULT '{}',
    related_docs  TEXT[]       NOT NULL DEFAULT '{}',
    body          TEXT         NOT NULL DEFAULT '',
    content_hash  TEXT         NOT NULL DEFAULT '',
    folder_id     VARCHAR(36)  REFERENCES folders(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    deleted_at    TIMESTAMPTZ,
    PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS documents_user_active
    ON documents (user_id, updated_at DESC)
    WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS chunks (
    user_id      VARCHAR(36) NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
    document_id  VARCHAR(36) NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    paragraph_id TEXT        NOT NULL,
    ordinal      INTEGER     NOT NULL,
    content      TEXT        NOT NULL,
    content_hash TEXT        NOT NULL,
    tsv          TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
    PRIMARY KEY (user_id, document_id, paragraph_id)
);

CREATE INDEX IF NOT EXISTS chunks_tsv ON chunks USING GIN (tsv);

CREATE TABLE IF NOT EXISTS chunk_embeddings (
    user_id      VARCHAR(36)   NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
    document_id  VARCHAR(36)   NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    paragraph_id TEXT          NOT NULL,
    vector       VECTOR(1536)  NOT NULL,
    PRIMARY KEY (user_id, document_id, paragraph_id)
);

CREATE INDEX IF NOT EXISTS chunk_embeddings_hnsw
    ON chunk_embeddings USING hnsw (vector vector_cosine_ops);
