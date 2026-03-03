import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import { env } from './config/env.js'
import apiRouter from './routes/index.js'
import { notFoundHandler } from './middleware/notFound.js'
import { errorHandler } from './middleware/errorHandler.js'

const app = express()

app.disable('x-powered-by')
app.use(helmet())

let corsOrigin: true | string[] = true
if (env.CORS_ORIGIN !== '*') {
  const allowedOrigins = env.CORS_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean)
  corsOrigin = allowedOrigins.length ? allowedOrigins : true
}

app.use(cors({
  origin: corsOrigin,
  credentials: true,
}))

app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true }))

if (env.NODE_ENV !== 'test') {
  app.use(morgan('dev'))
}

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'api',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  })
})

app.use('/api', apiRouter)

app.use(notFoundHandler)
app.use(errorHandler)

export default app
