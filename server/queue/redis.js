import IORedis from 'ioredis'

const getRedisUrl = () => String(process.env.REDIS_URL || '').trim()

export const isRedisConfigured = () => Boolean(getRedisUrl())

export const createRedisConnection = () => {
  const REDIS_URL = getRedisUrl()
  if (!REDIS_URL) {
    throw new Error('REDIS_URL is required when execution queue is enabled')
  }

  const REDIS_RETRY_FOREVER = process.env.REDIS_RETRY_FOREVER === 'true'
  const REDIS_MAX_RETRY_ATTEMPTS = Number(process.env.REDIS_MAX_RETRY_ATTEMPTS || 3)
  const REDIS_RETRY_DELAY_MS = Number(process.env.REDIS_RETRY_DELAY_MS || 1000)

  const connection = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: true,
    retryStrategy(times) {
      if (REDIS_RETRY_FOREVER) {
        return Math.min(times * REDIS_RETRY_DELAY_MS, 5000)
      }
      if (times > REDIS_MAX_RETRY_ATTEMPTS) {
        return null
      }
      return REDIS_RETRY_DELAY_MS
    },
  })

  connection.on('error', (error) => {
    if (process.env.REDIS_VERBOSE === 'true') {
      console.error('[redis] connection error:', error?.message || error)
    }
  })

  return connection
}
