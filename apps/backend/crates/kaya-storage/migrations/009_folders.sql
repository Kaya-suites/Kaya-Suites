-- Migration 009: document folder hierarchy
--
-- Adds a `folders` table and a `folder_id` FK on `documents`.
-- Folders are user-scoped (multi-tenant). A NULL `parent_id` means root.

CREATE TABLE IF NOT EXISTS folders (
    id         UUID        NOT NULL DEFAULT gen_random_uuid(),
    user_id    UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name       TEXT        NOT NULL,
    parent_id  UUID        REFERENCES folders (id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS folders_user_parent
    ON folders (user_id, parent_id);

ALTER TABLE documents
    ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES folders (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS documents_folder
    ON documents (user_id, folder_id)
    WHERE deleted_at IS NULL;
