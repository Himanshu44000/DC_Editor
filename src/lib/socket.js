import { io } from 'socket.io-client'

let socket = null
let socketToken = null

const DEFAULT_API_BASE = 'http://localhost:4000/api'
const API_BASE = (import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE).replace(/\/+$/, '')
const SOCKET_URL = (import.meta.env.VITE_SOCKET_URL || API_BASE.replace(/\/api$/, '')).replace(/\/+$/, '')

export const getSocket = (token) => {
  if (!token) return null

  if (!socket) {
    socket = io(SOCKET_URL, {
      auth: { token },
      transports: ['websocket'],
    })
    socketToken = token
    return socket
  }

  if (socketToken !== token) {
    // Keep the same socket instance so existing listeners remain attached.
    socketToken = token
    socket.auth = { token }

    // Avoid forcing local disconnects during normal token refresh.
    // Reconnect only if the socket is currently down.
    if (!socket.connected) {
      socket.connect()
    }
  }

  return socket
}

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect()
    socket = null
    socketToken = null
  }
}
