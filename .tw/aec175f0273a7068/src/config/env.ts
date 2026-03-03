import 'dotenv/config'

export type NodeEnv = 'development' | 'test' | 'production'

const parsePort = (value: string | undefined, fallback = 3000): number => {
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) return fallback
  if (parsed < 1 || parsed > 65535) return fallback
  return parsed
}

const parseNodeEnv = (value: string | undefined): NodeEnv => {
  if (value === 'test' || value === 'production') return value
  return 'development'
}

export const env = {
  NODE_ENV: parseNodeEnv(process.env.NODE_ENV),
  PORT: parsePort(process.env.PORT, 3000),
  APP_NAME: process.env.APP_NAME || 'ts-node-app',
}
