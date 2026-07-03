import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth, getSetupStatus } from '@/features/auth'
import LoginPage from '@/pages/LoginPage'
import SetupPage from '@/pages/SetupPage'
import AcceptInvitePage from '@/pages/AcceptInvitePage'
import ForgotPasswordPage from '@/pages/ForgotPasswordPage'
import ResetPasswordPage from '@/pages/ResetPasswordPage'
import ConnectionsPage from '@/pages/ConnectionsPage'
import WorkspacePage from '@/pages/WorkspacePage'
import WorkspaceSettingsPage from '@/pages/WorkspaceSettingsPage'
import SettingsPage from '@/pages/SettingsPage'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  return user ? children : <Navigate to="/login" replace />
}

export function AppRoutes() {
  const { user } = useAuth()
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null) // null = still checking

  useEffect(() => {
    getSetupStatus().then((s) => setNeedsSetup(s.needsSetup))
  }, [])

  if (needsSetup === null) return null // brief first-run check

  // Fresh install with no users → force the setup wizard ahead of everything.
  if (needsSetup && !user) {
    return (
      <Routes>
        <Route path="/setup" element={<SetupPage />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    )
  }

  return (
    <Routes>
      <Route path="/setup" element={<Navigate to="/" replace />} />
      <Route path="/invite/:token" element={<AcceptInvitePage />} />
      <Route path="/forgot" element={user ? <Navigate to="/" replace /> : <ForgotPasswordPage />} />
      <Route path="/reset/:token" element={<ResetPasswordPage />} />
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route
        path="/workspace/settings"
        element={
          <RequireAuth>
            <WorkspaceSettingsPage />
          </RequireAuth>
        }
      />
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
