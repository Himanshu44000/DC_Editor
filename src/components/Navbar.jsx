import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { apiRequest } from '../lib/api'

const landingNavLinks = [
  { href: '#about', label: 'About' },
  { href: '#workflow', label: 'Workflow' },
  { href: '#demo', label: 'Demo' },
  { href: '#voices', label: 'Voices' },
  { href: '#join', label: 'Join' },
]

const appNavLinks = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/profile', label: 'Profile' },
]

const Navbar = ({ variant = 'landing', theme: externalTheme, setTheme: externalSetTheme }) => {
  const { isAuthenticated, user, logout, getAuthToken } = useAuth()
  const location = useLocation()
  const [avatarUrl, setAvatarUrl] = useState('')
  
  // Use internal state if no external theme is provided
  const [internalTheme, setInternalTheme] = useState(() => {
    const saved = window.localStorage.getItem('dc-landing-theme')
    return saved === 'light' ? 'light' : 'dark'
  })
  
  const theme = externalTheme ?? internalTheme
  const setTheme = externalSetTheme ?? setInternalTheme

  useEffect(() => {
    window.localStorage.setItem('dc-landing-theme', theme)
    const root = document.documentElement
    if (theme === 'dark') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
  }, [theme])

  // Load user avatar for app variant
  useEffect(() => {
    if (variant !== 'app' || !isAuthenticated) return
    let cancelled = false

    const loadAvatar = async () => {
      try {
        const data = await apiRequest('/me', {}, getAuthToken)
        if (!cancelled) setAvatarUrl(String(data?.user?.avatarUrl || '').trim())
      } catch {
        if (!cancelled) setAvatarUrl('')
      }
    }

    loadAvatar()
    return () => { cancelled = true }
  }, [variant, isAuthenticated, getAuthToken, user?.id])

  const isLanding = variant === 'landing'
  const navLinks = isLanding ? landingNavLinks : appNavLinks

  return (
    <header className="fixed inset-x-0 top-0 z-40 px-3 py-3">
      <nav className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 rounded-full border border-slate-300/70 bg-white/80 px-4 py-2 shadow-lg shadow-slate-300/40 backdrop-blur-lg dark:border-slate-700/70 dark:bg-black dark:shadow-black/50">
        <Link to="/">
          <img
            src={theme === 'dark' ? '/branding/logo1.png' : '/branding/logo2.png'}
            alt="Logo"
            className="h-12 w-22 rounded-full"
          />
        </Link>

        <div className="flex flex-wrap items-center justify-center gap-4 text-xs font-bold uppercase tracking-[0.14em] text-slate-600 dark:text-slate-300">
          {navLinks.map((link) =>
            isLanding ? (
              <a
                key={link.href}
                href={link.href}
                className="hover:text-slate-900 dark:hover:text-white"
              >
                {link.label}
              </a>
            ) : (
              <Link
                key={link.to}
                to={link.to}
                className={`hover:text-slate-900 dark:hover:text-white ${
                  location.pathname === link.to ? 'text-slate-900 dark:text-white' : ''
                }`}
              >
                {link.label}
              </Link>
            )
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
            className="rounded-full border border-slate-300 bg-white px-3 py-2 text-[11px] font-bold uppercase tracking-[0.11em] text-slate-800 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
          >
            {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
          </button>
          
          {isAuthenticated && variant === 'app' ? (
            <>
              <Link to="/profile" title="Profile">
                <img
                  src={avatarUrl || '/branding/defaultAvatar.png'}
                  alt="Profile"
                  className="h-9 w-9 rounded-full border border-slate-300 object-cover dark:border-slate-700"
                />
              </Link>
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                {user?.name || user?.email?.split('@')[0]}
              </span>
              <button
                type="button"
                onClick={logout}
                className="rounded-full border border-slate-300 bg-white px-3 py-2 text-[11px] font-bold uppercase tracking-[0.11em] text-slate-800 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                Logout
              </button>
            </>
          ) : (
            <Link
              to={isAuthenticated ? '/dashboard' : '/auth'}
              className="rounded-full border border-zinc-900 bg-zinc-900 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-white transition hover:bg-black dark:border-zinc-200 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            >
              {isAuthenticated ? 'Open Dashboard' : 'Start Coding'}
            </Link>
          )}
        </div>
      </nav>
    </header>
  )
}

export default Navbar
