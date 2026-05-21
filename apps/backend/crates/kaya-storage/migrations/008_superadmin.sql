-- Add is_superadmin flag to users table.
-- DEFAULT FALSE ensures all existing rows remain unchanged.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_superadmin BOOLEAN NOT NULL DEFAULT FALSE;
