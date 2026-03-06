import { io } from 'socket.io-client'

let socket = null
let socketToken = null

export const getSocket = (token) => {
  if (!token) return null

  if (!socket) {
    socket = io('http://localhost:4000', {
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
