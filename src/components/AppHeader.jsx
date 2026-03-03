import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const AppHeader = () => {
  const { user, logout } = useAuth()
  const location = useLocation()

  return (
    <header className="app-header">
      <div className="header-brand">
        <h1>Live Collaborative Code Editor</h1>
      </div>

      <nav className="header-nav">
        <Link className={location.pathname.includes('/dashboard') ? 'active' : ''} to="/dashboard">
          Dashboard
        </Link>
      </nav>

      <div className="header-user">
        <span>{user?.name}</span>
        <button type="button" onClick={logout}>
          Logout
        </button>
      </div>
    </header>
  )
}

export default AppHeader
