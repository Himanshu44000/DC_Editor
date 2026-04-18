-- Fix NOT NULL with ON DELETE SET NULL constraint conflicts
-- This fixes: "null value in column violates not-null constraint"
-- Error occurs because columns are NOT NULL but constraints try to SET NULL

-- ========================================
-- 1. Fix collab_folders.created_by
-- ========================================
ALTER TABLE collab_folders 
DROP CONSTRAINT IF EXISTS collab_folders_created_by_fkey;

ALTER TABLE collab_folders 
ADD CONSTRAINT collab_folders_created_by_fkey 
FOREIGN KEY (created_by) REFERENCES collab_users(id) ON DELETE CASCADE;

-- ========================================
-- 2. Fix collab_files.created_by
-- ========================================
ALTER TABLE collab_files 
DROP CONSTRAINT IF EXISTS collab_files_created_by_fkey;

ALTER TABLE collab_files 
ADD CONSTRAINT collab_files_created_by_fkey 
FOREIGN KEY (created_by) REFERENCES collab_users(id) ON DELETE CASCADE;

-- ========================================
-- 3. Fix collab_file_versions.changed_by
-- ========================================
ALTER TABLE collab_file_versions 
DROP CONSTRAINT IF EXISTS collab_file_versions_changed_by_fkey;

ALTER TABLE collab_file_versions 
ADD CONSTRAINT collab_file_versions_changed_by_fkey 
FOREIGN KEY (changed_by) REFERENCES collab_users(id) ON DELETE CASCADE;

-- ========================================
-- 4. Fix collab_invites.invited_by
-- ========================================
ALTER TABLE collab_invites 
DROP CONSTRAINT IF EXISTS collab_invites_invited_by_fkey;

ALTER TABLE collab_invites 
ADD CONSTRAINT collab_invites_invited_by_fkey 
FOREIGN KEY (invited_by) REFERENCES collab_users(id) ON DELETE CASCADE;

-- ========================================
-- 5. Fix collab_audit_log.user_id
-- ========================================
ALTER TABLE collab_audit_log 
DROP CONSTRAINT IF EXISTS collab_audit_log_user_id_fkey;

ALTER TABLE collab_audit_log 
ADD CONSTRAINT collab_audit_log_user_id_fkey 
FOREIGN KEY (user_id) REFERENCES collab_users(id) ON DELETE CASCADE;

-- Verification queries (optional - run to verify fixes)
-- SELECT constraint_name, table_name, column_name 
-- FROM information_schema.key_column_usage 
-- WHERE table_name IN ('collab_folders', 'collab_files', 'collab_file_versions', 'collab_invites', 'collab_audit_log')
-- AND column_name IN ('created_by', 'changed_by', 'invited_by', 'user_id');

