import http from 'node:http'
import app from './app.js'
import { env } from './config/env.js'

const server = http.createServer(app)

server.listen(env.PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${env.PORT}`)
})

const shutdown = (signal: NodeJS.Signals) => {
  console.log(`${signal} received. Shutting down gracefully...`)
  server.close((error) => {
    if (error) {
      console.error('Error during shutdown:', error)
      process.exit(1)
    }
    process.exit(0)
  })
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
