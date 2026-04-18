import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { disconnectSocket } from '../lib/socket'

const DEFAULT_API_BASE = 'http://localhost:4000/api'
const API_BASE = (import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE).replace(/\/+$/, '')

const AuthContext = createContext(null)

export const AuthProvider = ({ children }) => {
  const [token, setToken] = useState(() => localStorage.getItem('accessToken'))
  const [refreshToken, setRefreshToken] = useState(() => localStorage.getItem('refreshToken'))
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  // Get auth token (with optional refresh)
  const getAuthToken = useCallback(async (forceRefresh = false) => {
    let currentToken = token || localStorage.getItem('accessToken')
    
    if (!currentToken) return null
    
    if (forceRefresh) {
      const currentRefreshToken = refreshToken || localStorage.getItem('refreshToken')
      if (!currentRefreshToken) return null
      
      try {
        const response = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: currentRefreshToken }),
        })
        
        if (response.ok) {
          const data = await response.json()
          const newToken = data.accessToken
          setToken(newToken)
          localStorage.setItem('accessToken', newToken)
          currentToken = newToken
        } else {
          // Refresh token expired, logout
          handleLogout()
          return null
        }
      } catch (error) {
        console.error('Token refresh error:', error)
        return currentToken
      }
    }
    
    return currentToken
  }, [token, refreshToken])

  // Load user on mount or when token changes
  useEffect(() => {
    const loadUser = async () => {
      const currentToken = token || localStorage.getItem('accessToken')
      
      if (!currentToken) {
        setUser(null)
        setLoading(false)
        return
      }

      try {
        const response = await fetch(`${API_BASE}/me`, {
          headers: {
            Authorization: `Bearer ${currentToken}`,
          },
        })

        if (response.ok) {
          const data = await response.json()
          setUser(data.user)
        } else if (response.status === 401) {
          // Token expired, try refresh
          const newToken = await getAuthToken(true)
          if (newToken) {
            const retryResponse = await fetch(`${API_BASE}/me`, {
              headers: { Authorization: `Bearer ${newToken}` },
            })
            if (retryResponse.ok) {
              const data = await retryResponse.json()
              setUser(data.user)
            } else {
              handleLogout()
            }
          }
        } else {
          handleLogout()
        }
      } catch (error) {
        console.error('Failed to load user:', error)
        setUser(null)
      } finally {
        setLoading(false)
      }
    }

    loadUser()
  }, [token, getAuthToken])

  // Auto-refresh token every 10 minutes
  useEffect(() => {
    if (!token) return

    const intervalId = setInterval(async () => {
      await getAuthToken(true)
    }, 10 * 60 * 1000)

    return () => clearInterval(intervalId)
  }, [token, getAuthToken])

  const handleLogout = useCallback(async () => {
    const currentToken = token || localStorage.getItem('accessToken')
    const currentRefreshToken = refreshToken || localStorage.getItem('refreshToken')

    // Try to notify server of logout
    if (currentToken) {
      try {
        await fetch(`${API_BASE}/auth/logout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${currentToken}`,
          },
          body: JSON.stringify({ refreshToken: currentRefreshToken }),
        })
      } catch (error) {
        console.error('Logout request failed:', error)
      }
    }

    // Clear client-side state
    setToken(null)
    setRefreshToken(null)
    setUser(null)
    localStorage.removeItem('accessToken')
    localStorage.removeItem('refreshToken')
    disconnectSocket()
  }, [token, refreshToken])

  const value = useMemo(
    () => ({
      token,
      refreshToken,
      user,
      loading,
      logout: handleLogout,
      getAuthToken,
      isAuthenticated: Boolean(token && user),
      setToken: (newToken) => {
        setToken(newToken)
        if (newToken) {
          localStorage.setItem('accessToken', newToken)
        } else {
          localStorage.removeItem('accessToken')
        }
      },
      setRefreshToken: (newRefreshToken) => {
        setRefreshToken(newRefreshToken)
        if (newRefreshToken) {
          localStorage.setItem('refreshToken', newRefreshToken)
        } else {
          localStorage.removeItem('refreshToken')
        }
      },
    }),
    [token, refreshToken, user, loading, getAuthToken, handleLogout]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider')
  }
  return context
}
