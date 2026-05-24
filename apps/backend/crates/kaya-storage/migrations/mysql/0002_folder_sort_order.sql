ALTER TABLE folders
    ADD COLUMN IF NOT EXISTS sort_order BIGINT NOT NULL DEFAULT 0;

UPDATE folders f
JOIN (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY user_id, COALESCE(parent_id, '__root__')
            ORDER BY name ASC, created_at ASC, id ASC
        ) - 1 AS rn
    FROM folders
) ranked ON ranked.id = f.id
SET f.sort_order = ranked.rn;

CREATE INDEX folders_user_parent_sort_idx
    ON folders (user_id, parent_id, sort_order);
