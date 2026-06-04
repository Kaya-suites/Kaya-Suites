ALTER TABLE documents ADD COLUMN IF NOT EXISTS sort_order BIGINT NOT NULL DEFAULT 0;

WITH ranked AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY COALESCE(folder_id, '00000000-0000-0000-0000-000000000000')
            ORDER BY updated_at DESC, id ASC
        ) - 1 AS rn
    FROM documents
    WHERE deleted_at IS NULL
)
UPDATE documents
SET sort_order = ranked.rn
FROM ranked
WHERE ranked.id = documents.id
  AND documents.deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS documents_user_folder_sort_idx
    ON documents (user_id, folder_id, sort_order);
