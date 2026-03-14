import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { apiRequest } from '../lib/api'

const landingNavLinks = [
  { href: '#about', label: 'Products' },
  { href: '#workflow', label: 'Workflow' },
  { href: '#demo', label: 'Demo' },
]

const appNavLinks = [
  { to: '/dashboard', label: 'Workspaces' },
  { to: '/profile', label: 'Account' },
]

const Navbar = ({ variant = 'landing', theme: externalTheme, setTheme: externalSetTheme }) => {
  const { isAuthenticated, user, logout, getAuthToken } = useAuth()
  const location = useLocation()
  const [avatarUrl, setAvatarUrl] = useState('')
  const [activeLandingHref, setActiveLandingHref] = useState(landingNavLinks[0]?.href || '#workflow')
  
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

  useEffect(() => {
    if (!isLanding || typeof window === 'undefined') return undefined

    const validHrefs = new Set(landingNavLinks.map((link) => link.href))

    const syncFromHash = () => {
      const hash = String(window.location.hash || '').trim()
      if (validHrefs.has(hash)) {
        setActiveLandingHref(hash)
      }
    }

    syncFromHash()
    window.addEventListener('hashchange', syncFromHash)

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntries = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)

        if (visibleEntries.length === 0) return
        const topEntry = visibleEntries[0]
        const href = `#${topEntry.target.id}`
        if (validHrefs.has(href)) {
          setActiveLandingHref(href)
        }
      },
      {
        root: null,
        threshold: [0.45, 0.6, 0.75],
      },
    )

    landingNavLinks.forEach((link) => {
      const sectionId = String(link.href || '').replace('#', '')
      const section = document.getElementById(sectionId)
      if (section) observer.observe(section)
    })

    return () => {
      window.removeEventListener('hashchange', syncFromHash)
      observer.disconnect()
    }
  }, [isLanding])

  return (
    <header className="fixed inset-x-0 top-0 z-40 px-3 py-4">
      <nav className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-300/60 bg-white/82 px-4 py-2.5 shadow-xl shadow-slate-300/30 backdrop-blur-xl dark:border-slate-700/80 dark:bg-slate-950/88 dark:shadow-black/55">
        <Link to="/" className="flex items-center gap-2.5">
          <img
            src={theme === 'dark' ? '/branding/logo1.png' : '/branding/logo2.png'}
            alt="Logo"
            className="h-11 w-11 rounded-full object-cover"
          />
        </Link>

        <div className="relative flex flex-wrap items-center justify-center gap-4 text-sm font-semibold text-slate-700 dark:text-slate-200">
          {navLinks.map((link) =>
            isLanding ? (
              (() => {
                const isActive = activeLandingHref === link.href
                return (
                  <a
                    key={link.href}
                    href={link.href}
                    onClick={() => setActiveLandingHref(link.href)}
                    className={`relative rounded-lg px-2 py-2 transition duration-150 hover:-translate-y-0.5 hover:text-slate-900 dark:hover:text-white ${
                      isActive ? 'text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-300'
                    } after:absolute after:bottom-0.5 after:left-1/2 after:h-0.5 after:w-[calc(100%-10px)] after:-translate-x-1/2 after:rounded-full after:bg-slate-900 after:transition-transform after:duration-150 dark:after:bg-white ${
                      isActive ? 'after:scale-x-100' : 'after:scale-x-0 hover:after:scale-x-100'
                    }`}
                  >
                    {link.label}
                  </a>
                )
              })()
            ) : (
              (() => {
                const isActive = location.pathname === link.to
                return (
                  <Link
                    key={link.to}
                    to={link.to}
                    className={`relative rounded-lg px-2 py-2 transition duration-150 hover:-translate-y-0.5 hover:text-slate-900 dark:hover:text-white ${
                      isActive ? 'text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-300'
                    } after:absolute after:bottom-0.5 after:left-1/2 after:h-0.5 after:w-[calc(100%-10px)] after:-translate-x-1/2 after:rounded-full after:bg-slate-900 after:transition-transform after:duration-150 dark:after:bg-white ${
                      isActive ? 'after:scale-x-100' : 'after:scale-x-0 hover:after:scale-x-100'
                    }`}
                  >
                    {link.label}
                  </Link>
                )
              })()
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
