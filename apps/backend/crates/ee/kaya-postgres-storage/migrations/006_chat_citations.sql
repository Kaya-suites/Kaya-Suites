-- Add citations column to chat_messages for storing source paragraph references.
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS citations JSONB NOT NULL DEFAULT '[]';
