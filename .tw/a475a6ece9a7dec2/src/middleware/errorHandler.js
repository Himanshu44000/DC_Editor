import { env } from '../config/env.js'

export function errorHandler(err, req, res, _next) {
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
