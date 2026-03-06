import { Outlet } from 'react-router-dom'

const AppLayout = () => {
  return (
    <div className="app-shell">
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}

export default AppLayout
