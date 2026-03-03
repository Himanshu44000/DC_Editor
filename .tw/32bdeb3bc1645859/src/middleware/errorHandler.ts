import type { NextFunction, Request, Response } from 'express'
import { env } from '../config/env.js'

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  const status = Number(err?.status || err?.statusCode || 500)
  const message =
    status >= 500 && env.NODE_ENV === 'production'
      ? 'Internal Server Error'
      : err?.message || 'Internal Server Error'

  res.status(status).json({
    ok: false,
    message,
    ...(env.NODE_ENV !== 'production' && err?.stack ? { stack: err.stack } : {}),
  })
}
