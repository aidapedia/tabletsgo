import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth, getSetupStatus } from '@/features/auth'
import LoginPage from '@/pages/auth/LoginPage'
import SetupPage from '@/pages/auth/SetupPage'
import AcceptInvitePage from '@/pages/auth/AcceptInvitePage'
import ForgotPasswordPage from '@/pages/auth/ForgotPasswordPage'
import ResetPasswordPage from '@/pages/auth/ResetPasswordPage'
import HomeLayout from '@/pages/home/HomeLayout'
import DashboardPage from '@/pages/home/DashboardPage'
import ConnectionsPage from '@/pages/home/ConnectionsPage'
import S3Page from '@/pages/home/S3Page'
import NotificationPage from '@/pages/home/NotificationPage'
import WorkspaceSettingsPage from '@/pages/home/WorkspaceSettingsPage'
import SettingsPage from '@/pages/home/SettingsPage'
import WorkspacePage from '@/pages/console/WorkspacePage'

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
      {/* Home shell — each sidebar section is its own page rendered into the layout's <Outlet/>. */}
      <Route
        element={
          <RequireAuth>
            <HomeLayout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        <Route path="/connections" element={<ConnectionsPage />} />
        <Route path="/s3" element={<S3Page />} />
        <Route path="/notification" element={<NotificationPage />} />
        <Route path="/workspace" element={<WorkspaceSettingsPage />} />
        <Route path="/workspace/:sub" element={<WorkspaceSettingsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/:sub" element={<SettingsPage />} />
      </Route>
      <Route
        path="/connection/:id"
        element={
          <RequireAuth>
            <WorkspacePage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
