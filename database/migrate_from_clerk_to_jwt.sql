-- Migration Script: Remove Clerk, Add JWT Authentication
-- Run this script against your existing database to migrate from Clerk to JWT-based auth
-- IMPORTANT: Backup your database before running this script!

-- ========================================
-- ALTER collab_users TABLE
-- ========================================
-- Add password_hash column
ALTER TABLE collab_users 
ADD COLUMN password_hash TEXT DEFAULT '__placeholder__' NOT NULL;

-- Add GitHub-related columns
ALTER TABLE collab_users 
ADD COLUMN IF NOT EXISTS github_username TEXT,
ADD COLUMN IF NOT EXISTS github_access_token TEXT,
ADD COLUMN IF NOT EXISTS github_token_scope TEXT,
ADD COLUMN IF NOT EXISTS github_connected_at TIMESTAMPTZ;

-- Remove clerk_id column and index
DROP INDEX IF EXISTS idx_collab_users_clerk_id;
ALTER TABLE collab_users DROP COLUMN IF EXISTS clerk_id;

-- ========================================
-- CREATE REFRESH TOKENS TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS collab_refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES collab_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_collab_refresh_tokens_user ON collab_refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_collab_refresh_tokens_expires ON collab_refresh_tokens (expires_at);

-- ========================================
-- UPDATE EXISTING USERS (Optional: set dummy passwords)
-- ========================================
-- NOTE: Users will need to use password reset to set proper passwords
-- Uncomment the line below if you want to set a temporary password pattern
-- UPDATE collab_users SET password_hash = '__needs_password_reset__' WHERE password_hash = '__placeholder__';

-- ========================================
-- VERIFY MIGRATION
-- ========================================
-- Run these queries to verify the migration was successful:
-- SELECT * FROM collab_users LIMIT 1; -- Should show password_hash, no clerk_id
-- SELECT COUNT(*) FROM collab_refresh_tokens; -- Should be 0 initially
-- SELECT column_name FROM information_schema.columns WHERE table_name='collab_users' AND column_name='clerk_id'; -- Should return no rows

COMMIT;
