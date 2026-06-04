ALTER TABLE documents ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

WITH ranked AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY COALESCE(folder_id, '__root__')
            ORDER BY updated_at DESC, id ASC
        ) - 1 AS rn
    FROM documents
    WHERE deleted_at IS NULL
)
UPDATE documents
SET sort_order = (
    SELECT ranked.rn
    FROM ranked
    WHERE ranked.id = documents.id
)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS documents_folder_sort_idx
    ON documents (folder_id, sort_order);
