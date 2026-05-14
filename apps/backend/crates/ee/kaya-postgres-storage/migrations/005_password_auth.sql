-- Add username and password_hash columns for password-based authentication.
-- Both are nullable so existing rows (created via magic-link) are unaffected.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS username      TEXT UNIQUE,
    ADD COLUMN IF NOT EXISTS password_hash TEXT;
