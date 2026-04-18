import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useState } from 'react'
import Navbar from '../components/Navbar'

const DEFAULT_API_BASE = 'http://localhost:4000/api'
const API_BASE = (import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE).replace(/\/+$/, '')

const AuthPage = () => {
  const { isAuthenticated, loading, setToken, setRefreshToken } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [passwordErrors, setPasswordErrors] = useState([])

  if (loading) {
    return (
      <>
        <Navbar variant="landing" />
        <div className="center-page" style={{ paddingTop: '5rem' }}>
          <div className="card auth-card" />
        </div>
      </>
    )
  }

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />
  }

  const handleLogin = async (e) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      const response = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      if (response.ok) {
        const data = await response.json()
        setToken(data.accessToken)
        setRefreshToken(data.refreshToken)
        navigate('/dashboard')
      } else {
        const errorData = await response.json()
        setError(errorData.message || 'Login failed')
      }
    } catch (err) {
      setError('Failed to connect to server')
      console.error(err)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSignup = async (e) => {
    e.preventDefault()
    setError('')
    setPasswordErrors([])
    setIsLoading(true)

    // Validate password strength
    const passwordRegex = {
      length: password.length >= 8,
      uppercase: /[A-Z]/.test(password),
      lowercase: /[a-z]/.test(password),
      number: /[0-9]/.test(password),
      special: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password),
    }

    const errors = []
    if (!passwordRegex.length) errors.push('Password must be at least 8 characters')
    if (!passwordRegex.uppercase) errors.push('Password must contain an uppercase letter')
    if (!passwordRegex.lowercase) errors.push('Password must contain a lowercase letter')
    if (!passwordRegex.number) errors.push('Password must contain a number')
    if (!passwordRegex.special) errors.push('Password must contain a special character')

    if (errors.length > 0) {
      setPasswordErrors(errors)
      setIsLoading(false)
      return
    }

    try {
      const response = await fetch(`${API_BASE}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name }),
      })

      if (response.status === 201) {
        const data = await response.json()
        setToken(data.accessToken)
        setRefreshToken(data.refreshToken)
        navigate('/dashboard')
      } else {
        const errorData = await response.json()
        setError(errorData.message || 'Signup failed')
      }
    } catch (err) {
      setError('Failed to connect to server')
      console.error(err)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <>
      <Navbar variant="landing" />
      <div className="center-page" style={{ paddingTop: '5rem' }}>
        <div className="card auth-card">
          <div className="auth-mode-switch">
            <button
              type="button"
              className={mode === 'login' ? 'active' : ''}
              onClick={() => {
                setMode('login')
                setError('')
                setPasswordErrors([])
              }}
            >
              Login
            </button>
            <button
              type="button"
              className={mode === 'register' ? 'active' : ''}
              onClick={() => {
                setMode('register')
                setError('')
                setPasswordErrors([])
              }}
            >
              Register
            </button>
          </div>

          <form onSubmit={mode === 'login' ? handleLogin : handleSignup} style={{ width: '100%', maxWidth: '400px' }}>
            {error && (
              <div style={{
                padding: '12px',
                marginBottom: '16px',
                background: '#7f1d1d',
                color: '#fca5a5',
                borderRadius: '8px',
                fontSize: '14px',
              }}>
                {error}
              </div>
            )}

            {mode === 'register' && (
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', marginBottom: '8px', color: '#cbd5e1', fontSize: '14px' }}>
                  Full Name (optional)
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your Name"
                  style={{
                    width: '100%',
                    padding: '10px',
                    background: '#0b1324',
                    border: '1px solid #334155',
                    borderRadius: '8px',
                    color: '#e2e8f0',
                    fontSize: '14px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            )}

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '8px', color: '#cbd5e1', fontSize: '14px' }}>
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="your@email.com"
                style={{
                  width: '100%',
                  padding: '10px',
                  background: '#0b1324',
                  border: '1px solid #334155',
                  borderRadius: '8px',
                  color: '#e2e8f0',
                  fontSize: '14px',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '8px', color: '#cbd5e1', fontSize: '14px' }}>
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                style={{
                  width: '100%',
                  padding: '10px',
                  background: '#0b1324',
                  border: '1px solid #334155',
                  borderRadius: '8px',
                  color: '#e2e8f0',
                  fontSize: '14px',
                  boxSizing: 'border-box',
                }}
              />
              {mode === 'register' && passwordErrors.length > 0 && (
                <div style={{ marginTop: '8px', color: '#fca5a5', fontSize: '12px' }}>
                  {passwordErrors.map((err, idx) => (
                    <div key={idx}>• {err}</div>
                  ))}
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading}
              style={{
                width: '100%',
                padding: '12px',
                background: '#2563eb',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: '600',
                cursor: isLoading ? 'not-allowed' : 'pointer',
                opacity: isLoading ? 0.7 : 1,
              }}
            >
              {isLoading ? 'Loading...' : mode === 'login' ? 'Login' : 'Create Account'}
            </button>
          </form>
        </div>
      </div>
    </>
  )
}

export default AuthPage
