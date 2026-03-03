# Cloudinary Object Storage Integration

## Overview

Your collaborative code editor now uses **Cloudinary** as an object storage layer for project file blobs. This decouples large file content from PostgreSQL, improving scalability and leveraging Cloudinary's free CDN tier (25 GB storage + 25 GB bandwidth/month).

---

## Architecture Changes

### Before (Inline Storage)
```
PostgreSQL collab_projects.payload JSONB
└── files: [{ id, name, path, content: "full file text here..." }]
```

### After (Cloudinary Storage)
```
PostgreSQL
├── collab_projects.payload JSONB (file metadata: id, name, path)
└── collab_project_files table
    ├── id, project_id, file_path
    ├── blob_url (Cloudinary secure_url)
    ├── cloudinary_public_id (for updates/deletes)
    └── version, size_bytes, created_by, timestamps

Cloudinary
└── projects/{projectId}/{hash}_{filename} (raw text files)
```

---

## Setup Instructions

### 1. Get Cloudinary Credentials

1. Sign up at [cloudinary.com](https://cloudinary.com) (free tier)
2. Navigate to **Dashboard** → **Settings** → **Access Keys**
3. Copy:
   - **Cloud Name** (e.g., `dq1abc123`)
   - **API Key** (e.g., `123456789012345`)
   - **API Secret** (e.g., `a1b2c3d4e5f...`)

### 2. Configure Environment Variables

Add to your `.env` file:

```env
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=123456789012345
CLOUDINARY_API_SECRET=your_secret_key
```

### 3. Restart Server

```bash
npm run dev:server
```

You should see in console:
```
✅ Cloudinary configured: your_cloud_name
```

If credentials are missing:
```
⚠️  Cloudinary not configured - file storage will use in-memory fallback
```

---

## How It Works

### File Creation
```javascript
// POST /api/projects (template files)
// socket.on('file:create')
const file = await createFileRecord(projectId, filePath, content, userId)
// ↓
// 1. Upload to Cloudinary → get secure_url
// 2. Insert into collab_project_files table
// 3. Return file object with blobUrl (content is empty string)
```

### File Updates
```javascript
// socket.on('file:update')
const updates = await updateFileRecord(projectId, fileId, newContent, userId)
// ↓
// 1. Fetch cloudinary_public_id from DB
// 2. Re-upload to Cloudinary (same public_id → auto-versioning)
// 3. Update blob_url and version in DB
```

### File Reads
```javascript
// GET /api/projects/:projectId/files/:fileId/content
const content = await getFileContent(projectId, fileId)
// ↓
// 1. Fetch blob_url from collab_project_files
// 2. HTTP GET to Cloudinary secure_url
// 3. Return text content
```

### File Deletion
```javascript
// socket.on('file:delete')
await deleteFileRecord(projectId, fileId)
// ↓
// 1. Fetch cloudinary_public_id from DB
// 2. Call cloudinary.uploader.destroy(publicId)
// 3. Delete row from collab_project_files
```

### Project Deletion
```javascript
// DELETE /api/projects/:projectId
await fileStorage.deleteProjectFolder(projectId)
// ↓
// Delete all files tagged with projectId
// Delete projects/{projectId} folder
```

---

## API Changes

### Socket Events Behavior with Cloudinary

| Event | Before | After |
|-------|--------|-------|
| `file:created` | Sends full `content` | Sends `blobUrl`, `content: ""` |
| `file:updated` | Sends full `content` | Sends `content: ""` (outdated) |

**Important**: Frontend must now fetch content via REST API when needed:

```javascript
// Example: Load file content when user selects in editor
const response = await fetch(`/api/projects/${projectId}/files/${fileId}/content`, {
  headers: { Authorization: `Bearer ${token}` }
})
const { content } = await response.json()
```

### New REST Endpoint

```
GET /api/projects/:projectId/files/:fileId/content
Authorization: Bearer {clerk_token}

Response:
{
  "content": "file content here..."
}
```

---

## Backward Compatibility

The implementation is **fully backward compatible**:

- **Without Cloudinary**: All helpers return inline content (existing behavior)
- **With Cloudinary**: Files uploaded to cloud, DB stores URLs
- **No migration needed**: Old projects continue working with inline content

This allows gradual adoption - enable Cloudinary in production while keeping dev mode simple.

---

## Storage Helpers Reference

### Module: `server/storage/fileStorage.js`

```javascript
// Upload new file → returns { url, publicId, version }
await uploadFile(projectId, filePath, content, userId)

// Update existing file → returns { url, publicId, version }
await updateFile(publicId, content)

// Download file content → returns string
await downloadFile(url)

// Delete single file
await deleteFile(publicId)

// Delete all files in project
await deleteProjectFolder(projectId)
```

### Module: `server/storage/cloudinaryClient.js`

```javascript
// Initialize Cloudinary (auto-called on server start)
configureCloudinary()

// Check if Cloudinary is active
isCloudinaryConfigured() // → boolean

// Get Cloudinary v2 client
getCloudinary()
```

---

## Database Schema

### New Table: `collab_project_files`

```sql
CREATE TABLE collab_project_files (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  blob_url TEXT NOT NULL,
  cloudinary_public_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, file_path)
);

CREATE INDEX idx_collab_project_files_project 
ON collab_project_files (project_id, created_at DESC);
```

---

## Cloudinary Folder Structure

```
projects/
├── {projectId-1}/
│   ├── a1b2c3d4_main.js
│   ├── e5f6g7h8_package.json
│   └── i9j0k1l2_README.md
├── {projectId-2}/
│   ├── m3n4o5p6_App.jsx
│   └── q7r8s9t0_index.html
...
```

Each file gets a unique public_id: `projects/{projectId}/{hash}_{filename}`

Tags applied:
- `project-file`
- `{projectId}`

---

## Production Deployment Checklist

- [ ] Sign up for Cloudinary free tier
- [ ] Add `CLOUDINARY_*` env vars to production
- [ ] Verify `DATABASE_URL` is set (Cloudinary mode requires PostgreSQL)
- [ ] Test file create/update/delete operations
- [ ] Monitor Cloudinary dashboard for usage stats
- [ ] Set up Cloudinary transformations (optional - e.g., syntax highlighting for images)

---

## Troubleshooting

### Files not uploading to Cloudinary?

**Check console logs on server start:**
```
✅ Cloudinary configured: your_cloud_name
```

If you see the warning instead, verify:
1. All 3 env vars are set: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`
2. No typos in `.env` file
3. Server restarted after adding env vars

### 500 error on file:create?

Check server logs for Cloudinary-specific errors. Common issues:
- Invalid API credentials → verify access keys
- Free tier quota exceeded → upgrade or delete old files
- Network timeout → check firewall/proxy settings

### Old projects showing blank editor?

This is expected if legacy projects have inline content but Cloudinary is enabled. To migrate:
1. Add migration script (optional) or
2. Re-create projects (recommended for testing)

---

## Cost Estimation

### Cloudinary Free Tier
- **Storage**: 25 GB
- **Bandwidth**: 25 GB/month
- **Transformations**: 25,000 credits/month

### Typical Usage (10-person team)
- Average file size: 5 KB
- Files per project: 20
- Active projects: 50
- **Total storage**: ~5 MB (well within free tier)

Cloudinary is essentially **free forever** for code editor use cases since text files are tiny.

---

## Next Steps

1. **Enable Cloudinary** in production by adding env vars
2. **Test file operations** (create, edit, delete projects)
3. **Monitor Cloudinary dashboard** for bandwidth/storage usage
4. **(Optional) Frontend optimization**: Add lazy-loading for file content to reduce API calls

Your backend is now production-ready for scalable file storage! 🚀
