import { addTask, listTasks, toggleTask } from '../store/taskStore.js'

const sendJson = (res: import('node:http').ServerResponse, status: number, payload: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

const readBody = async (req: import('node:http').IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf-8')
}

export const handleTaskRoutes = async (
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
): Promise<boolean> => {
  const method = req.method || 'GET'
  const url = req.url || '/'

  if (method === 'GET' && url === '/api/tasks') {
    sendJson(res, 200, { ok: true, data: listTasks() })
    return true
  }

  if (method === 'POST' && url === '/api/tasks') {
    const body = await readBody(req)
    const parsed = body ? JSON.parse(body) : {}
    const title = String(parsed?.title || '').trim()
    if (!title) {
      sendJson(res, 400, { ok: false, message: 'title is required' })
      return true
    }
    sendJson(res, 201, { ok: true, data: addTask(title) })
    return true
  }

  const match = url.match(/^\/api\/tasks\/(\d+)\/toggle$/)
  if (method === 'PATCH' && match) {
    const updated = toggleTask(Number(match[1]))
    if (!updated) {
      sendJson(res, 404, { ok: false, message: 'task not found' })
      return true
    }
    sendJson(res, 200, { ok: true, data: updated })
    return true
  }

  return false
}