import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ClerkProvider } from '@clerk/clerk-react'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

const MissingClerkConfig = () => (
  <div className="center-page">
    <div className="card auth-card">
      <h2>Clerk setup required</h2>
      <p>Add <strong>VITE_CLERK_PUBLISHABLE_KEY</strong> in your <strong>.env</strong> and restart Vite.</p>
      <p>Also set <strong>CLERK_SECRET_KEY</strong> for backend auth.</p>
    </div>
  </div>
)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {clerkPublishableKey ? (
      <ClerkProvider publishableKey={clerkPublishableKey}>
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </ClerkProvider>
    ) : (
      <MissingClerkConfig />
    )}
  </StrictMode>,
)
