# Live Collaborative Code Editor (MVP)

This project is an optimized MVP for small-team real-time coding collaboration.

## Included Features

- Authentication with Clerk (sign up, sign in, logout, session management)
- Project dashboard
- Create project and join with invite code
- File explorer tree (create, rename, delete files and folders)
- Monaco code editor
- Real-time file editing (Socket.IO)
- Cursor position sync summary
- Project chat in real time
- Role-based access (`owner`, `collaborator`, `viewer`)
- Project templates (React, Node/Express, Next.js structure, Vue, Python CLI, TypeScript Node, Vanilla Web)
- Run button with execution output console (MVP)

## Tech Stack

- Frontend: React + Vite + React Router + Monaco
- Backend: Node.js + Express + Socket.IO
- Auth: Clerk (frontend + backend token verification)
- Storage: In-memory by default, PostgreSQL when `DATABASE_URL` is provided

## Run Locally

1. Install dependencies:

	npm install

2. Configure environment variables:

	Set these values in `.env`:

	- `VITE_CLERK_PUBLISHABLE_KEY`
	- `CLERK_SECRET_KEY`
	- `DATABASE_URL` (optional)

	Example:

	set VITE_CLERK_PUBLISHABLE_KEY=pk_test_xxx
	set CLERK_SECRET_KEY=sk_test_xxx

3. (Optional) Enable PostgreSQL persistence:

	Set env var `DATABASE_URL` before starting the backend.

	Example:

	set DATABASE_URL=postgres://<db_user>:<db_password>@localhost:5432/live_collab

4. Run backend server:

	npm run dev:server

5. Run frontend in another terminal:

	npm run dev

Frontend runs on Vite default port and backend on `http://localhost:4000`.

## Notes

- Without `DATABASE_URL`, data is in-memory and resets on restart.
- With `DATABASE_URL`, users/projects/invites are persisted in PostgreSQL.
- `viewer` role is read-only (cannot modify files/folders or write to shared terminal).
- Run supports `.js`, `.py`, `.cpp`, `.java`, `.ts` with Docker isolation when `USE_DOCKER=true`.

## FastAPI Project Structure (Flexible)

When using the **FastAPI template**, you can organize your project in any folder structure. The startup script automatically detects your FastAPI app.

### Auto-detection Order

The platform checks for your FastAPI app in this order:

1. **Environment variable**: `FASTAPI_APP` (e.g., `backend.server:application`)
2. **main.py** in root directory → uses `main:app`
3. **app/main.py** → uses `app.main:app`
4. **src/main.py** → uses `src.main:app`
5. **app.py** in root directory → uses `app:app`
6. **Fallback**: `main:app` (default)

### What You Need to Keep in Mind

- **Define your FastAPI app instance** properly (e.g., `app = FastAPI()`)
- **Use any folder structure** you prefer (delete the scaffold if needed)
- **Custom structures**: Set `FASTAPI_APP=your.module.path:app_instance` before running
- The startup script (`start.ps1`, `start.bat`, or `start.sh`) handles the rest automatically

### Example Custom Structure

```
your_project/
├── backend/
│   ├── server.py          # app = FastAPI()
│   └── routes/
└── requirements.txt
```

Run with: `set FASTAPI_APP=backend.server:app` (then click Run or use terminal)

## Production Queue Mode (recommended)

This project now supports async code execution jobs with Redis + BullMQ + a separate worker process.

### Required env vars

- `DATABASE_URL` (required)
- `REDIS_URL` (required)
- `USE_EXECUTION_QUEUE=true`
- `USE_DOCKER=true` (recommended)
- `EXECUTION_WORKER_CONCURRENCY=4` (optional)

### Start commands (queue mode)

1. Start backend API:

	npm run dev:server

2. Start execution worker in another terminal:

	npm run dev:worker

3. Start frontend:

	npm run dev

### API behavior in queue mode

- `POST /api/projects/:projectId/run` returns `202` with `{ jobId, status: "queued" }`
- Poll `GET /api/executions/jobs/:jobId` for `queued | running | completed | failed`

## Cloudinary Object Storage (optional - production-ready)

The platform supports Cloudinary for storing project file blobs, decoupling file content from PostgreSQL. When enabled, file metadata lives in `collab_project_files` table with URLs to Cloudinary-hosted content.

### Why Cloudinary?

- **Free tier**: 25 GB storage, 25 GB bandwidth/month
- **Professional CDN**: Global edge delivery
- **Built-in versioning**: Track file history
- **Zero infrastructure**: No S3/GCS bucket management

### Setup Cloudinary

1. Create a free account at [cloudinary.com](https://cloudinary.com)
2. Get credentials from: **Settings** → **Access Keys**
3. Add to `.env`:

```env
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=123456789012345
CLOUDINARY_API_SECRET=your_secret_key
```

4. Restart server - Cloudinary auto-configures if all 3 vars are present

### Storage behavior

- **Without Cloudinary**: Files stored inline in PostgreSQL `payload` JSONB (development mode)
- **With Cloudinary**: Files uploaded to `projects/{projectId}/` folder, only URLs stored in DB
- **Image assets**: Users can upload images from Explorer (`🖼️+`) and preview them in-editor

### API changes with Cloudinary

- `file:created` / `file:updated` Socket events no longer send full `content` (blank string)
- Frontend fetches content via `GET /api/projects/:projectId/files/:fileId/content`
- Deleting project calls `fileStorage.deleteProjectFolder(projectId)` to cleanup Cloudinary

### Migration strategy

This implementation is **backward compatible**:
- Existing projects (inline content) continue working
- New projects automatically use Cloudinary when configured
- No migration script needed - graceful coexistence

## Variant Fingerprint Check (React Vite)

Use this command any time after changing template/scaffold code:

```bash
npm run verify:variants
```

### What this does (simple)

- Generates all React Vite variants from backend scaffold logic
- Checks each variant has its required "identity" (fingerprint)
	- TypeScript variants: `tsconfig.json`, TypeScript deps, TS build script
	- SWC variants: `@vitejs/plugin-react-swc` in deps + vite config
	- React Compiler variants: `babel-plugin-react-compiler` in deps + vite config
- Fails immediately if something is wrong

### Where you see errors

- You will see results in the **terminal output** where you ran `npm run verify:variants`
- Not shown in app UI

### How failure looks

The script prints a clear line like:

```text
❌ typescript-swc: missing @vitejs/plugin-react-swc dependency
```

This tells you exactly:
- Which variant failed (`typescript-swc`)
- What is wrong (`missing @vitejs/plugin-react-swc dependency`)

If all checks pass, terminal shows:

```text
✅ React Vite variant fingerprints are valid
```
