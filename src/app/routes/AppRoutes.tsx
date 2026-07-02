import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from '@/features/auth'
import LoginPage from '@/pages/LoginPage'
import ConnectionsPage from '@/pages/ConnectionsPage'
import WorkspacePage from '@/pages/WorkspacePage'
import SettingsPage from '@/pages/SettingsPage'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  return user ? children : <Navigate to="/login" replace />
}

export function AppRoutes() {
  const { user } = useAuth()
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <ConnectionsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/connection/:id"
        element={
          <RequireAuth>
            <WorkspacePage />
          </RequireAuth>
        }
      />
      <Route
        path="/settings"
        element={
          <RequireAuth>
            <SettingsPage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
