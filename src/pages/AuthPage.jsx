import { Navigate } from 'react-router-dom'
import { SignIn, SignUp } from '@clerk/clerk-react'
import { useAuth } from '../context/AuthContext'
import { useState } from 'react'
import Navbar from '../components/Navbar'

const clerkAppearance = {
  variables: {
    colorPrimary: '#2563eb',
    colorBackground: '#0f172a',
    colorInputBackground: '#0b1324',
    colorInputText: '#e2e8f0',
    colorText: '#e2e8f0',
    colorTextSecondary: '#94a3b8',
    colorDanger: '#ef4444',
    colorSuccess: '#10b981',
    borderRadius: '10px',
  },
  elements: {
    rootBox: { width: '100%' },
    card: {
      boxShadow: 'none',
      border: 'none',
      background: 'transparent',
      width: '100%',
      padding: '0.25rem 0 0',
    },
    headerTitle: { color: '#e2e8f0' },
    headerSubtitle: { color: '#94a3b8' },
    socialButtonsBlockButton: {
      background: '#0b1324',
      border: '1px solid #334155',
      color: '#e2e8f0',
    },
    socialButtonsBlockButtonText: { color: '#e2e8f0' },
    dividerLine: { background: '#334155' },
    dividerText: { color: '#94a3b8' },
    formFieldLabel: { color: '#cbd5e1' },
    formFieldInput: {
      background: '#0b1324',
      border: '1px solid #334155',
      color: '#e2e8f0',
    },
    formButtonPrimary: {
      background: '#2563eb',
      color: '#ffffff',
    },
    formButtonReset: { color: '#93c5fd' },
    footerActionText: { color: '#94a3b8' },
    footerActionLink: { color: '#93c5fd' },
    identityPreviewText: { color: '#e2e8f0' },
    identityPreviewEditButton: { color: '#93c5fd' },
    formFieldSuccessText: { color: '#10b981' },
    formFieldWarningText: { color: '#f59e0b' },
    formFieldErrorText: { color: '#fca5a5' },
    alertText: { color: '#fca5a5' },
    footer: { background: 'transparent' },
  },
}

const AuthPage = () => {
  const { isAuthenticated } = useAuth()
  const [mode, setMode] = useState('login')

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />
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
            onClick={() => setMode('login')}
          >
            Login
          </button>
          <button
            type="button"
            className={mode === 'register' ? 'active' : ''}
            onClick={() => setMode('register')}
          >
            Register
          </button>
        </div>

        {mode === 'login' ? (
          <SignIn
            routing="virtual"
            fallbackRedirectUrl="/dashboard"
            signUpUrl="/auth"
            appearance={clerkAppearance}
          />
        ) : (
          <SignUp
            routing="virtual"
            fallbackRedirectUrl="/dashboard"
            signInUrl="/auth"
            appearance={clerkAppearance}
          />
        )}
      </div>
    </div>
    </>
  )
}

export default AuthPage
