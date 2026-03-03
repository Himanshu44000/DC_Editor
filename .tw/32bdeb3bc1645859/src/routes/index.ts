import { Router } from 'express'

const router = Router()

router.get('/', (_req, res) => {
  res.json({ ok: true, message: 'Node Express starter active' })
})

router.get('/stats', (_req, res) => {
  res.json({
    ok: true,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    memoryMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
  })
})

export default router