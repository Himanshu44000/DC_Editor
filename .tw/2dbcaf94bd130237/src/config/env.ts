import 'dotenv/config'

const parsePort = (value: string | undefined, fallback = 3000): number => {
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) return fallback
  if (parsed < 1 || parsed > 65535) return fallback
  return parsed
}

export const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parsePort(process.env.PORT, 3000),
  APP_NAME: process.env.APP_NAME || 'ts-node-app',
}
