import dotenv from 'dotenv'
import { Worker } from 'bullmq'
import { Client } from 'pg'
import { randomUUID } from 'node:crypto'
import { EXECUTION_QUEUE_NAME } from '../queue/executionQueue.js'
import { createRedisConnection } from '../queue/redis.js'
import { executeCode } from '../execution/executor.js'

dotenv.config()

const DATABASE_URL = process.env.DATABASE_URL
const USE_DOCKER = process.env.USE_DOCKER === 'true'

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required for execution worker')
}

const dbClient = new Client({ connectionString: DATABASE_URL })
await dbClient.connect()
const redisConnection = createRedisConnection()

try {
  await redisConnection.ping()
} catch (error) {
  console.error('[execution-worker] Redis is not reachable. Start Redis on localhost:6379 or set USE_EXECUTION_QUEUE=false to disable queue mode.')
  console.error(`[execution-worker] ${error?.message || 'Redis connection failed'}`)
  await dbClient.end().catch(() => null)
  await redisConnection.disconnect(false)
  process.exit(1)
}

const markStarted = async (id) => {
  await dbClient.query(
    `UPDATE collab_execution_jobs
     SET status = 'running', started_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [id],
  )
}

const markFinished = async (id, result) => {
  const updateResult = await dbClient.query(
    `UPDATE collab_execution_jobs
     SET status = $2,
         finished_at = NOW(),
         updated_at = NOW(),
         result = $3::jsonb,
         error_text = $4
     WHERE id = $1
     RETURNING project_id, user_id, runtime`,
    [id, result.ok ? 'completed' : 'failed', JSON.stringify(result), result.ok ? null : result.stderr || null],
  )

  const row = updateResult.rows?.[0]
  if (!row?.project_id || !row?.user_id) return

  await dbClient.query(
    `INSERT INTO collab_audit_log (id, project_id, user_id, action_type, resource_type, resource_id, details, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())`,
    [
      randomUUID(),
      row.project_id,
      row.user_id,
      result.ok ? 'execution_completed' : 'execution_failed',
      'execution_job',
      id,
      JSON.stringify({ ok: Boolean(result.ok), runtime: row.runtime }),
    ],
  )

  await dbClient.query(
    `INSERT INTO collab_activity_feed (id, project_id, user_id, activity_type, activity_data, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, NOW())`,
    [
      randomUUID(),
      row.project_id,
      row.user_id,
      result.ok ? 'execution_completed' : 'execution_failed',
      JSON.stringify({ ok: Boolean(result.ok), runtime: row.runtime }),
    ],
  )
}

const worker = new Worker(
  EXECUTION_QUEUE_NAME,
  async (job) => {
    const payload = job.data
    await markStarted(payload.id)

    const result = await executeCode({
      runtime: payload.runtime,
      sourceCode: payload.sourceCode,
      stdin: payload.stdin || '',
      useDocker: USE_DOCKER,
    })

    await markFinished(payload.id, result)
    return result
  },
  {
    connection: redisConnection,
    concurrency: Number(process.env.EXECUTION_WORKER_CONCURRENCY || 4),
  },
)

worker.on('completed', (job) => {
  console.log(`[execution-worker] completed job ${job.id}`)
})

worker.on('failed', (job, error) => {
  console.error(`[execution-worker] failed job ${job?.id || 'unknown'}:`, error.message)
})

console.log('[execution-worker] running')
