ALTER TABLE documents ADD COLUMN IF NOT EXISTS sort_order BIGINT NOT NULL DEFAULT 0;

-- Initialise per-folder sequential positions ordered by updated_at DESC.
-- MySQL does not support window functions in UPDATE directly, so we use a
-- derived table to compute the ranks first.
UPDATE documents d
JOIN (
    SELECT id,
           (@rn := IF(@grp = COALESCE(folder_id, '__root__'),
                      @rn + 1,
                      IF((@grp := COALESCE(folder_id, '__root__')) IS NOT NULL, 0, 0)
           )) AS rn
    FROM (
        SELECT id, folder_id
        FROM documents
        WHERE deleted_at IS NULL
        ORDER BY COALESCE(folder_id, '__root__'), updated_at DESC, id ASC
    ) ordered,
    (SELECT @grp := '', @rn := -1) vars
) ranked ON d.id = ranked.id
SET d.sort_order = ranked.rn
WHERE d.deleted_at IS NULL;

CREATE INDEX documents_user_folder_sort_idx
    ON documents (user_id, folder_id, sort_order);
