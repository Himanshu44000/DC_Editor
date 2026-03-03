import { Router } from 'express'

const router = Router()

router.get('/', (_req, res) => {
  res.json({
    ok: true,
    message: 'Node + Express starter is running',
  })
})

export default router
