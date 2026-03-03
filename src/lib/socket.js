import { io } from 'socket.io-client'

let socket = null
let socketToken = null

export const getSocket = (token) => {
  if (!token) return null

  if (socket && socketToken && socketToken !== token) {
    socket.disconnect()
    socket = null
    socketToken = null
  }

  if (!socket) {
    socket = io('http://localhost:4000', {
      auth: { token },
      transports: ['websocket'],
    })
    socketToken = token
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
