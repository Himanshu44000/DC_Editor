-- Live Collaborative Code Editor - Production Schema (v2.0)
-- Normalized relational design for scalability
-- PostgreSQL schema for manual setup in pgAdmin
-- Run this entire file once against your target database.

-- ========================================
-- DROP EXISTING TABLES (if migrating from v1.0)
-- ========================================
DROP TABLE IF EXISTS collab_project_settings CASCADE;
DROP TABLE IF EXISTS collab_user_settings CASCADE;
DROP TABLE IF EXISTS collab_activity_feed CASCADE;
DROP TABLE IF EXISTS collab_audit_log CASCADE;
DROP TABLE IF EXISTS collab_terminal_sessions CASCADE;
DROP TABLE IF EXISTS collab_execution_jobs CASCADE;
DROP TABLE IF EXISTS collab_chat_reactions CASCADE;
DROP TABLE IF EXISTS collab_chat_messages CASCADE;
DROP TABLE IF EXISTS collab_ai_messages CASCADE;
DROP TABLE IF EXISTS collab_ai_conversations CASCADE;
DROP TABLE IF EXISTS collab_cursors CASCADE;
DROP TABLE IF EXISTS collab_file_locks CASCADE;
DROP TABLE IF EXISTS collab_file_versions CASCADE;
DROP TABLE IF EXISTS collab_file_content CASCADE;
DROP TABLE IF EXISTS collab_files CASCADE;
DROP TABLE IF EXISTS collab_folders CASCADE;
DROP TABLE IF EXISTS collab_invites CASCADE;
DROP TABLE IF EXISTS collab_project_members CASCADE;
DROP TABLE IF EXISTS collab_project_files CASCADE;
DROP TABLE IF EXISTS collab_projects CASCADE;
DROP TABLE IF EXISTS collab_roles CASCADE;
DROP TABLE IF EXISTS collab_users CASCADE;

-- ========================================
-- CORE USER MANAGEMENT TABLES
-- ========================================
BEGIN;

CREATE TABLE collab_users (
  id TEXT PRIMARY KEY,
  clerk_id TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  avatar_url TEXT,
  bio TEXT,
  pronouns TEXT,
  company TEXT,
  location TEXT,
  job_title TEXT,
  website_url TEXT,
  github_profile TEXT,
  linkedin_url TEXT,
  portfolio_url TEXT,
  skills TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_collab_users_clerk_id ON collab_users (clerk_id);
CREATE INDEX idx_collab_users_email ON collab_users (email);
CREATE INDEX idx_collab_users_last_active ON collab_users (last_active_at DESC);

-- ========================================
-- PROJECT CORE TABLES
-- ========================================
CREATE TABLE collab_projects (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES collab_users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  visibility TEXT NOT NULL DEFAULT 'private', -- private, internal, public
  language TEXT NOT NULL DEFAULT 'javascript',
  template_type TEXT,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_collab_projects_owner ON collab_projects (owner_id);
CREATE INDEX idx_collab_projects_archived ON collab_projects (is_archived) WHERE NOT is_archived;
CREATE INDEX idx_collab_projects_created ON collab_projects (created_at DESC);

-- ========================================
-- PERMISSION & ROLE TABLES
-- ========================================
CREATE TABLE collab_roles (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL, -- admin, editor, viewer, commenter
  description TEXT,
  can_edit BOOLEAN NOT NULL DEFAULT FALSE,
  can_delete BOOLEAN NOT NULL DEFAULT FALSE,
  can_share BOOLEAN NOT NULL DEFAULT FALSE,
  can_invite BOOLEAN NOT NULL DEFAULT FALSE,
  can_execute BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO collab_roles (id, name, description, can_edit, can_delete, can_share, can_invite, can_execute) VALUES
  ('admin', 'Admin', 'Full control', true, true, true, true, true),
  ('editor', 'Editor', 'Can edit and execute', true, true, false, false, true),
  ('viewer', 'Viewer', 'Read-only access', false, false, false, false, false),
  ('commenter', 'Commenter', 'Can view and comment', false, false, false, false, false);

-- Member management with roles
CREATE TABLE collab_project_members (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES collab_projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES collab_users(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL DEFAULT 'viewer' REFERENCES collab_roles(id) ON DELETE RESTRICT,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  invited_by TEXT REFERENCES collab_users(id) ON DELETE SET NULL,
  UNIQUE (project_id, user_id)
);

CREATE INDEX idx_collab_project_members_project ON collab_project_members (project_id);
CREATE INDEX idx_collab_project_members_user ON collab_project_members (user_id);
CREATE INDEX idx_collab_project_members_role ON collab_project_members (role_id);

-- ========================================
-- FILE STRUCTURE TABLES
-- ========================================
CREATE TABLE collab_folders (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES collab_projects(id) ON DELETE CASCADE,
  parent_folder_id TEXT REFERENCES collab_folders(id) ON DELETE CASCADE,
  folder_name TEXT NOT NULL,
  folder_path TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES collab_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, folder_path)
);

CREATE INDEX idx_collab_folders_project ON collab_folders (project_id);
CREATE INDEX idx_collab_folders_parent ON collab_folders (parent_folder_id);
CREATE INDEX idx_collab_folders_path ON collab_folders (folder_path);

CREATE TABLE collab_files (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES collab_projects(id) ON DELETE CASCADE,
  folder_id TEXT REFERENCES collab_folders(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'plaintext',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL REFERENCES collab_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, file_path)
);

CREATE INDEX idx_collab_files_project ON collab_files (project_id);
CREATE INDEX idx_collab_files_folder ON collab_files (folder_id);
CREATE INDEX idx_collab_files_language ON collab_files (language);
CREATE INDEX idx_collab_files_created ON collab_files (created_at DESC);

-- ========================================
-- FILE CONTENT & VERSIONING TABLES
-- ========================================
CREATE TABLE collab_file_content (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES collab_files(id) ON DELETE CASCADE UNIQUE,
  content TEXT NOT NULL,
  blob_url TEXT, -- Cloudinary URL
  cloudinary_public_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_collab_file_content_file ON collab_file_content (file_id);

-- File versioning for history tracking
CREATE TABLE collab_file_versions (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES collab_files(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  content TEXT NOT NULL,
  blob_url TEXT,
  cloudinary_public_id TEXT,
  size_bytes INTEGER NOT NULL,
  changed_by TEXT NOT NULL REFERENCES collab_users(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  change_message TEXT,
  UNIQUE (file_id, version_number)
);

CREATE INDEX idx_collab_file_versions_file ON collab_file_versions (file_id, version_number DESC);
CREATE INDEX idx_collab_file_versions_changed ON collab_file_versions (changed_at DESC);

-- File locking for concurrent edit prevention
CREATE TABLE collab_file_locks (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES collab_files(id) ON DELETE CASCADE,
  locked_by TEXT NOT NULL REFERENCES collab_users(id) ON DELETE CASCADE,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE (file_id)
);

CREATE INDEX idx_collab_file_locks_expires ON collab_file_locks (expires_at);
CREATE INDEX idx_collab_file_locks_user ON collab_file_locks (locked_by);

-- ========================================
-- REAL-TIME COLLABORATION TABLES
-- ========================================
CREATE TABLE collab_cursors (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES collab_files(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES collab_users(id) ON DELETE CASCADE,
  line_number INTEGER NOT NULL,
  column_number INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (file_id, user_id)
);

CREATE INDEX idx_collab_cursors_file ON collab_cursors (file_id);
CREATE INDEX idx_collab_cursors_user ON collab_cursors (user_id);
CREATE INDEX idx_collab_cursors_updated ON collab_cursors (updated_at);

-- ========================================
-- CHAT & MESSAGING TABLES
-- ========================================
CREATE TABLE collab_chat_messages (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES collab_projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES collab_users(id) ON DELETE CASCADE,
  file_id TEXT REFERENCES collab_files(id) ON DELETE SET NULL,
  message_text TEXT NOT NULL,
  is_edited BOOLEAN NOT NULL DEFAULT FALSE,
  edited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_collab_chat_messages_project ON collab_chat_messages (project_id, created_at DESC);
CREATE INDEX idx_collab_chat_messages_user ON collab_chat_messages (user_id);
CREATE INDEX idx_collab_chat_messages_file ON collab_chat_messages (file_id);

CREATE TABLE collab_chat_reactions (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES collab_chat_messages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES collab_users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (message_id, user_id, emoji)
);

CREATE INDEX idx_collab_chat_reactions_message ON collab_chat_reactions (message_id);
CREATE INDEX idx_collab_chat_reactions_user ON collab_chat_reactions (user_id);

-- ========================================
-- AI ASSISTANT TABLES
-- ========================================
CREATE TABLE collab_ai_conversations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES collab_projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES collab_users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_collab_ai_conversations_project_user
  ON collab_ai_conversations (project_id, user_id, updated_at DESC);

CREATE TABLE collab_ai_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES collab_ai_conversations(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES collab_projects(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES collab_users(id) ON DELETE SET NULL,
  role TEXT NOT NULL, -- user, assistant
  content TEXT NOT NULL,
  attachments_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_collab_ai_messages_conversation_created
  ON collab_ai_messages (conversation_id, created_at ASC);

-- ========================================
-- EXECUTION & TERMINAL TABLES
-- ========================================
CREATE TABLE collab_execution_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES collab_users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES collab_projects(id) ON DELETE CASCADE,
  file_id TEXT REFERENCES collab_files(id) ON DELETE SET NULL,
  runtime TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued', -- queued, running, completed, failed
  stdin_text TEXT DEFAULT '',
  source_code TEXT NOT NULL,
  result JSONB,
  error_text TEXT,
  execution_time_ms INTEGER,
  queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_collab_execution_jobs_project ON collab_execution_jobs (project_id, queued_at DESC);
CREATE INDEX idx_collab_execution_jobs_user ON collab_execution_jobs (user_id, queued_at DESC);
CREATE INDEX idx_collab_execution_jobs_status ON collab_execution_jobs (status) WHERE status != 'completed';
CREATE INDEX idx_collab_execution_jobs_created ON collab_execution_jobs (queued_at DESC);

CREATE TABLE collab_terminal_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES collab_projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES collab_users(id) ON DELETE CASCADE,
  session_name TEXT NOT NULL,
  initial_working_dir TEXT NOT NULL DEFAULT '/workspace',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_collab_terminal_sessions_project ON collab_terminal_sessions (project_id);
CREATE INDEX idx_collab_terminal_sessions_user ON collab_terminal_sessions (user_id);
CREATE INDEX idx_collab_terminal_sessions_active ON collab_terminal_sessions (is_active) WHERE is_active;

-- ========================================
-- INVITATION & SHARING TABLES
-- ========================================
CREATE TABLE collab_invites (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES collab_projects(id) ON DELETE CASCADE,
  invite_code TEXT UNIQUE NOT NULL,
  invited_by TEXT NOT NULL REFERENCES collab_users(id) ON DELETE SET NULL,
  role_id TEXT NOT NULL DEFAULT 'viewer' REFERENCES collab_roles(id) ON DELETE RESTRICT,
  invited_email TEXT,
  uses_allowed INTEGER DEFAULT -1, -- -1 for unlimited
  uses_remaining INTEGER DEFAULT -1,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_collab_invites_project ON collab_invites (project_id);
CREATE INDEX idx_collab_invites_code ON collab_invites (invite_code);
CREATE INDEX idx_collab_invites_expires ON collab_invites (expires_at DESC);

-- ========================================
-- AUDIT & ACTIVITY TABLES
-- ========================================
CREATE TABLE collab_audit_log (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES collab_projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES collab_users(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL, -- file_created, file_edited, file_deleted, member_added, execution_ran, etc
  resource_type TEXT NOT NULL, -- file, project, member, etc
  resource_id TEXT,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_collab_audit_log_project ON collab_audit_log (project_id, created_at DESC);
CREATE INDEX idx_collab_audit_log_user ON collab_audit_log (user_id, created_at DESC);
CREATE INDEX idx_collab_audit_log_action ON collab_audit_log (action_type);
CREATE INDEX idx_collab_audit_log_created ON collab_audit_log (created_at DESC);

-- Activity feed for social features
CREATE TABLE collab_activity_feed (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES collab_projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES collab_users(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL, -- file_update, message, execution_complete, member_joined
  activity_data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_collab_activity_feed_project ON collab_activity_feed (project_id, created_at DESC);
CREATE INDEX idx_collab_activity_feed_user ON collab_activity_feed (user_id, created_at DESC);
CREATE INDEX idx_collab_activity_feed_created ON collab_activity_feed (created_at DESC);

-- ========================================
-- USER PREFERENCES TABLE
-- ========================================
CREATE TABLE collab_user_settings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES collab_users(id) ON DELETE CASCADE UNIQUE,
  theme TEXT DEFAULT 'dark', -- dark, light, auto
  editor_font_size INTEGER DEFAULT 14,
  editor_tab_size INTEGER DEFAULT 2,
  editor_indent_with_spaces BOOLEAN DEFAULT TRUE,
  auto_save_enabled BOOLEAN DEFAULT TRUE,
  auto_save_interval_ms INTEGER DEFAULT 2000,
  notifications_enabled BOOLEAN DEFAULT TRUE,
  email_on_invite BOOLEAN DEFAULT TRUE,
  email_on_execution BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_collab_user_settings_user ON collab_user_settings (user_id);

-- ========================================
-- PROJECT SETTINGS TABLE
-- ========================================
CREATE TABLE collab_project_settings (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES collab_projects(id) ON DELETE CASCADE UNIQUE,
  default_runtime TEXT NOT NULL DEFAULT 'nodejs',
  execution_timeout_seconds INTEGER NOT NULL DEFAULT 30,
  max_output_size_mb INTEGER NOT NULL DEFAULT 10,
  allow_file_upload BOOLEAN NOT NULL DEFAULT TRUE,
  max_file_size_mb INTEGER NOT NULL DEFAULT 50,
  require_approval_for_execution BOOLEAN NOT NULL DEFAULT FALSE,
  enable_version_history BOOLEAN NOT NULL DEFAULT TRUE,
  auto_cleanup_old_versions BOOLEAN NOT NULL DEFAULT TRUE,
  versions_to_keep INTEGER NOT NULL DEFAULT 20,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_collab_project_settings_project ON collab_project_settings (project_id);

COMMIT;
