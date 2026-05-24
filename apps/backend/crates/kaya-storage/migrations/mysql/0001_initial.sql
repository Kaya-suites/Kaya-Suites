-- MySQL schema for MySqlAdapter.
-- IDs are VARCHAR(36) UUID strings. Per-user isolation enforced in all queries.

CREATE TABLE IF NOT EXISTS documents (
    id               VARCHAR(36)  NOT NULL,
    user_id          VARCHAR(36)  NOT NULL,
    title            TEXT         NOT NULL,
    frontmatter_json MEDIUMTEXT   NOT NULL,
    content_hash     VARCHAR(64)  NOT NULL,
    updated_at       VARCHAR(32)  NOT NULL,
    deleted_at       VARCHAR(32),
    body             MEDIUMTEXT   NOT NULL DEFAULT '',
    folder_id        VARCHAR(36),
    PRIMARY KEY (id),
    KEY documents_user_idx (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS folders (
    id         VARCHAR(36)  NOT NULL,
    user_id    VARCHAR(36)  NOT NULL,
    name       TEXT         NOT NULL,
    parent_id  VARCHAR(36),
    created_at VARCHAR(32)  NOT NULL,
    updated_at VARCHAR(32)  NOT NULL,
    PRIMARY KEY (id),
    KEY folders_user_parent_idx (user_id, parent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS chunks (
    user_id      VARCHAR(36)  NOT NULL,
    document_id  VARCHAR(36)  NOT NULL,
    paragraph_id VARCHAR(255) NOT NULL,
    ordinal      INT          NOT NULL,
    content      MEDIUMTEXT   NOT NULL,
    content_hash VARCHAR(64)  NOT NULL,
    PRIMARY KEY (user_id, document_id, paragraph_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS chunk_embeddings (
    user_id      VARCHAR(36)  NOT NULL,
    document_id  VARCHAR(36)  NOT NULL,
    paragraph_id VARCHAR(255) NOT NULL,
    vector       MEDIUMBLOB   NOT NULL,
    PRIMARY KEY (user_id, document_id, paragraph_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
