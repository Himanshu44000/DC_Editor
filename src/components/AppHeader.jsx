import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { apiRequest } from '../lib/api'

const AppHeader = () => {
  const { user, logout, getAuthToken } = useAuth()
  const location = useLocation()
  const [avatarUrl, setAvatarUrl] = useState('')

  useEffect(() => {
    let cancelled = false

    const loadProfileAvatar = async () => {
      try {
        const data = await apiRequest('/me', {}, getAuthToken)
        if (cancelled) return
        setAvatarUrl(String(data?.user?.avatarUrl || '').trim())
      } catch {
        if (!cancelled) {
          setAvatarUrl('')
        }
      }
    }

    loadProfileAvatar()

    return () => {
      cancelled = true
    }
  }, [getAuthToken, user?.id])

  return (
    <header className="app-header">
      <div className="header-brand">
        <div className="header-logo-frame">
          <img src="/branding/logo.svg" alt="DC Editor logo" className="header-logo" />
        </div>
        <h1>DC Editor</h1>
      </div>

      <nav className="header-nav">
        <Link className={location.pathname.includes('/dashboard') ? 'active' : ''} to="/dashboard">
          Dashboard
        </Link>
        <Link className="header-avatar-link" to="/profile" title="Profile">
          <img
            src={avatarUrl || '/branding/defaultAvatar.png'}
            alt="Profile avatar"
            className="header-avatar"
          />
        </Link>
        <span className="header-user-name">{user?.name}</span>
        <button type="button" onClick={logout}>
          Logout
        </button>
      </nav>
    </header>
  )
}

export default AppHeader
