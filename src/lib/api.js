const API_BASE = 'http://localhost:4000/api'

const resolveAuthToken = async (tokenOrProvider) => {
  if (!tokenOrProvider) return null
  if (typeof tokenOrProvider === 'function') {
    const token = await tokenOrProvider()
    return token || null
  }
  return tokenOrProvider
}

export const apiRequest = async (path, options = {}, tokenOrProvider) => {
  const isTokenProvider = typeof tokenOrProvider === 'function'
  let token = await resolveAuthToken(tokenOrProvider)

  const makeRequest = async (resolvedToken) =>
    fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(resolvedToken ? { Authorization: `Bearer ${resolvedToken}` } : {}),
        ...(options.headers || {}),
      },
    })

  let response
  try {
    response = await makeRequest(token)

    if (response.status === 401 && isTokenProvider) {
      const refreshedToken = await tokenOrProvider(true)
      if (refreshedToken && refreshedToken !== token) {
        token = refreshedToken
        response = await makeRequest(token)
      }
    }
  } catch {
    throw new Error('Cannot reach backend server at http://localhost:4000. Start `npm run dev:server`.')
  }

  const rawBody = await response.text().catch(() => '')
  let data = {}
  if (rawBody) {
    try {
      data = JSON.parse(rawBody)
    } catch {
      data = { message: rawBody }
    }
  }

  if (!response.ok) {
    throw new Error(data.message || `Request failed (${response.status})`)
  }

  return data
}
