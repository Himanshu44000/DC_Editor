import { createServer } from 'node:http'
import { env } from './config/env.js'
import { logInfo } from './lib/logger.js'

const sendJson = (res: import('node:http').ServerResponse, status: number, payload: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

const server = createServer((req, res) => {
  const method = req.method || 'GET'
  const url = req.url || '/'

  if (method === 'GET' && url === '/') {
    sendJson(res, 200, { ok: true, message: `${env.APP_NAME} is running` })
    return
  }

  if (method === 'GET' && url === '/health') {
    sendJson(res, 200, { ok: true, env: env.NODE_ENV, timestamp: new Date().toISOString() })
    return
  }

  sendJson(res, 404, { ok: false, message: `Route not found: ${method} ${url}` })
})

server.listen(env.PORT, '0.0.0.0', () => {
  logInfo(`Server running on http://localhost:${env.PORT}`)
  logInfo(`Health check: http://localhost:${env.PORT}/health`)
})