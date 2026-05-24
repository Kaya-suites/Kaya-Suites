ALTER TABLE folders ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

WITH ranked AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY COALESCE(parent_id, '__root__')
            ORDER BY name ASC, created_at ASC, id ASC
        ) - 1 AS rn
    FROM folders
)
UPDATE folders
SET sort_order = (
    SELECT ranked.rn
    FROM ranked
    WHERE ranked.id = folders.id
);

CREATE INDEX IF NOT EXISTS folders_parent_sort_idx
    ON folders (parent_id, sort_order);
