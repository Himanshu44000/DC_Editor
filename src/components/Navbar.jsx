import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Menu, Moon, Sun, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { apiRequest } from '../lib/api'

const landingNavLinks = [
  { href: '#about', label: 'About' },
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
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  
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
  const onLandingRoot = location.pathname === '/'
  const themeIconColor = '#f8fafc'

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

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth > 527) {
        setIsMobileMenuOpen(false)
      }
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return (
    <header className="fixed inset-x-0 top-0 z-40 px-3 py-4">
      <nav
        className={`mx-auto flex w-full flex-wrap items-center justify-between gap-3 px-4 py-2.5 shadow-xl backdrop-blur-xl ${
          isLanding
            ? `max-w-7xl border border-slate-800 bg-black/92 shadow-black/35 ${
                isMobileMenuOpen ? 'rounded-[1.8rem]' : 'rounded-full'
              }`
            : 'max-w-7xl rounded-full border border-slate-800 bg-black/92 shadow-black/35'
        }`}
      >
        <Link to="/" className="flex items-center gap-2.5">
          <img
            src={theme === 'dark' ? '/branding/logo1.png' : '/branding/logo1.png'}
            alt="Logo"
            className="h-11 w-11 rounded-full object-cover"
          />
        </Link>

        {isLanding ? (
          <button
            type="button"
            className="landing-mobile-toggle hidden border-0! bg-transparent! p-0! shadow-none!"
            aria-label={isMobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            onClick={() => setIsMobileMenuOpen((prev) => !prev)}
          >
            {isMobileMenuOpen ? <X size={22} color="#f8fafc" /> : <Menu size={22} color="#f8fafc" />}
          </button>
        ) : null}

        <div
          className={`relative flex flex-wrap items-center justify-center gap-4 text-sm font-semibold ${
            isLanding ? 'text-slate-200' : 'text-slate-200'
          } ${isLanding ? 'landing-nav-menu' : ''} ${isMobileMenuOpen ? 'is-open' : ''}`}
        >
          {navLinks.map((link) =>
            isLanding ? (
              (() => {
                const isActive = activeLandingHref === link.href
                return (
                  <a
                    key={link.href}
                    href={onLandingRoot ? link.href : `/${link.href}`}
                    onClick={() => {
                      setActiveLandingHref(link.href)
                      setIsMobileMenuOpen(false)
                    }}
                    className={`landing-nav-link relative rounded-lg px-2 py-2 transition duration-150 hover:-translate-y-0.5 hover:text-white ${
                      isActive ? 'text-white' : 'text-slate-300'
                    } after:absolute after:bottom-0.5 after:left-1/2 after:h-0.5 after:w-[calc(100%-10px)] after:-translate-x-1/2 after:rounded-full after:bg-white after:transition-transform after:duration-150 ${
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
                    className={`relative rounded-lg px-2 py-2 transition duration-150 hover:-translate-y-0.5 hover:text-white ${
                      isActive ? 'text-white' : 'text-slate-300'
                    } after:absolute after:bottom-0.5 after:left-1/2 after:h-0.5 after:w-[calc(100%-10px)] after:-translate-x-1/2 after:rounded-full after:bg-white after:transition-transform after:duration-150 ${
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
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className={`border-0! bg-transparent! p-0! shadow-none! transition hover:opacity-75 ${
              isLanding ? 'text-slate-100' : 'text-slate-100'
            }`}
            style={{ borderRadius: 0 }}
          >
            {theme === 'dark' ? (
              <Sun size={24} strokeWidth={2.4} color={themeIconColor} />
            ) : (
              <Moon size={24} strokeWidth={2.4} color={themeIconColor} />
            )}
          </button>
          
          {isAuthenticated && variant === 'app' ? (
            <>
              <Link to="/profile" title="Profile">
                <img
                  src={avatarUrl || '/branding/defaultAvatar.png'}
                  alt="Profile"
                  className="h-9 w-9 rounded-full border border-slate-700 object-cover"
                />
              </Link>
              <span className="text-xs font-semibold text-slate-300">
                {user?.name || user?.email?.split('@')[0]}
              </span>
              <button
                type="button"
                onClick={logout}
                className="rounded-full border border-slate-700 bg-slate-950 px-3 py-2 text-[11px] font-bold uppercase tracking-[0.11em] text-slate-100 transition hover:bg-slate-900"
              >
                Logout
              </button>
            </>
          ) : (
            <Link
              to={isAuthenticated ? '/dashboard' : '/auth'}
              onClick={() => setIsMobileMenuOpen(false)}
              className="landing-primary-btn rounded-full px-4 py-2 text-[11px] font-bold uppercase tracking-[0.12em]"
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
