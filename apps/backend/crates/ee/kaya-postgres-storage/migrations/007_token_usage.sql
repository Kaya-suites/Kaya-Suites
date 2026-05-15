-- Token usage columns for per-message and per-session tracking.
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS input_tokens  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS output_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS model        TEXT    NOT NULL DEFAULT '';

ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS total_input_tokens  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS total_output_tokens INTEGER NOT NULL DEFAULT 0;
