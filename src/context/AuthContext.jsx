import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useAuth as useClerkAuth, useClerk, useUser } from '@clerk/clerk-react'
import { disconnectSocket } from '../lib/socket'

const AuthContext = createContext(null)

export const AuthProvider = ({ children }) => {
  const { isLoaded, isSignedIn, getToken } = useClerkAuth()
  const { user: clerkUser, isLoaded: isUserLoaded } = useUser()
  const { signOut } = useClerk()
  const [token, setToken] = useState(null)
  const [loading, setLoading] = useState(true)

  const getAuthToken = useCallback(async (forceRefresh = false) => {
    if (!isLoaded || !isSignedIn) return null
    try {
      const nextToken = await getToken(forceRefresh ? { skipCache: true } : undefined)
      if (nextToken && nextToken !== token) {
        setToken(nextToken)
      }
      return nextToken || null
    } catch {
      return token
    }
  }, [getToken, isLoaded, isSignedIn, token])

  useEffect(() => {
    let cancelled = false

    const syncToken = async () => {
      if (!isLoaded) return
      if (!isSignedIn) {
        if (!cancelled) {
          setToken(null)
          setLoading(false)
        }
        return
      }

      try {
        const nextToken = await getToken()
        if (!cancelled) {
          setToken(nextToken || null)
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    syncToken()
    return () => {
      cancelled = true
    }
  }, [getToken, isLoaded, isSignedIn])

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return undefined

    const refresh = async () => {
      const nextToken = await getAuthToken(false)
      if (!nextToken) return
      setToken((prev) => (prev === nextToken ? prev : nextToken))
    }

    const intervalId = window.setInterval(refresh, 5 * 60_000)
    const onFocus = () => {
      if (document.visibilityState === 'hidden') return
      refresh()
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [getAuthToken, isLoaded, isSignedIn])

  const logout = useCallback(async () => {
    await signOut()
    setToken(null)
    disconnectSocket()
  }, [signOut])

  const user = useMemo(
    () =>
      clerkUser
        ? {
            id: clerkUser.id,
            name: clerkUser.fullName || clerkUser.firstName || clerkUser.username || 'User',
            email: clerkUser.primaryEmailAddress?.emailAddress || '',
          }
        : null,
    [clerkUser],
  )

  const value = useMemo(
    () => ({
      token,
      user,
      loading: loading || !isUserLoaded,
      logout,
      getAuthToken,
      isAuthenticated: Boolean(isSignedIn && user),
    }),
    [token, user, loading, isSignedIn, isUserLoaded, getAuthToken, logout],
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
