# DSA Production Docker Architecture

This deployment layout isolates the DSA execution path while leaving the project module behavior unchanged.

## Services

- api: Express API service. Receives run requests and enqueues jobs when USE_EXECUTION_QUEUE=true.
- worker: BullMQ consumer. Executes user code and updates Postgres job rows.
- postgres: Persistent relational store for users, projects, files, execution jobs, audit/activity.
- redis: Queue broker for BullMQ.
- code-executor-image: Built sandbox image (code-executor:latest) used by worker docker run.

## Security and sandboxing

Worker executes code using docker run with:

- --network=none
- --cap-drop=ALL
- --cpus from DSA_EXECUTION_CPUS
- --memory from DSA_EXECUTION_MEMORY
- per-run temp mount
- timeout with SIGTERM then SIGKILL fallback
- cleanup of temp directories

Only worker mounts Docker socket:

- /var/run/docker.sock:/var/run/docker.sock

## API behavior

When USE_EXECUTION_QUEUE=true:

- POST run request writes queued job row to collab_execution_jobs and enqueues BullMQ job.
- API returns 202 with jobId.
- Client polls GET /api/executions/jobs/:jobId.
- Endpoint requires auth and checks ownership (job.userId must match caller).

## Status lifecycle

Statuses in collab_execution_jobs:

- queued
- running
- completed
- failed

Worker writes result JSON and error_text and inserts audit/activity records.

## Bring up locally

1. Copy env template:

   cp .env.dsa.example .env.dsa

   On Windows PowerShell:

   Copy-Item .env.dsa.example .env.dsa

2. Fill required secrets in .env.dsa.

3. Start stack from this folder:

   docker compose -f docker-compose.dsa.yml up -d --build

4. Check API health:

   http://localhost:4000/api/health

## Notes

- For production managed services (Render, Supabase, Upstash), reuse same env flags and point DATABASE_URL and REDIS_URL to managed endpoints.
- If using managed Postgres, remove local postgres service and init mount from compose.
- Rotate any previously exposed credentials before deployment.
