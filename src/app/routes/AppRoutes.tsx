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
import ConnectionDetailPage from '@/pages/home/ConnectionDetailPage'
import ConnectionFormPage from '@/pages/home/ConnectionFormPage'
import WorkspaceSettingsPage from '@/pages/home/WorkspaceSettingsPage'
import NotificationsPage from '@/pages/home/NotificationsPage'
import StoragePage from '@/pages/home/StoragePage'
import SettingsPage from '@/pages/home/SettingsPage'
import WorkspacePage from '@/pages/console/WorkspacePage'
import AdminWorkspacesPage from '@/pages/admin/AdminWorkspacesPage'
import AdminUsersPage from '@/pages/admin/AdminUsersPage'
import AdminEmailPage from '@/pages/admin/AdminEmailPage'
import AdminRolesPage from '@/pages/admin/AdminRolesPage'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  return user ? children : <Navigate to="/login" replace />
}

/**
 * The two role tiers split the app into two non-overlapping halves, so each
 * guard sends the wrong audience to the other's home rather than showing an
 * empty shell. An instance admin holds no workspace membership: every
 * workspace-scoped page would render nothing and every call behind it would
 * 403, so `/admin` *is* their home.
 */
function RequireSystemAdmin({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  return user.role === 'admin' ? children : <Navigate to="/" replace />
}

function RequireWorkspaceUser({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  return user.role === 'admin' ? <Navigate to="/admin" replace /> : children
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
      {/* Instance administration — the admin's half of the app, same shell. */}
      <Route
        element={
          <RequireSystemAdmin>
            <HomeLayout />
          </RequireSystemAdmin>
        }
      >
        <Route path="/admin" element={<AdminWorkspacesPage />} />
        <Route path="/admin/users" element={<AdminUsersPage />} />
        <Route path="/admin/roles" element={<AdminRolesPage />} />
        <Route path="/admin/email" element={<AdminEmailPage />} />
      </Route>
      {/* Home shell — each sidebar section is its own page rendered into the layout's <Outlet/>. */}
      <Route
        element={
          <RequireWorkspaceUser>
            <HomeLayout />
          </RequireWorkspaceUser>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        {/* Connections: list, create, detail (tab in the path) and edit are four
            addresses, not four states of one page — each survives a refresh and
            can be pasted to a teammate. `new` and `edit` are static segments, so
            react-router ranks them above `/connections/:id/:tab`. */}
        <Route path="/connections" element={<ConnectionsPage />} />
        <Route path="/connections/new" element={<ConnectionFormPage />} />
        <Route path="/connections/:id" element={<ConnectionDetailPage />} />
        <Route path="/connections/:id/edit" element={<ConnectionFormPage />} />
        <Route path="/connections/:id/edit/:tab" element={<ConnectionFormPage />} />
        <Route path="/connections/:id/:tab" element={<ConnectionDetailPage />} />
        <Route path="/workspace" element={<WorkspaceSettingsPage />} />
        <Route path="/workspace/:sub" element={<WorkspaceSettingsPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        {/* The section lost its tabs when SMTP moved to the admin area; the
            :sub route stays so old links (e.g. /notifications/smtp) still land
            here instead of bouncing to the dashboard. */}
        <Route path="/notifications/:sub" element={<NotificationsPage />} />
        <Route path="/storage" element={<StoragePage />} />
      </Route>
      {/* Personal settings (theme, local data, updates) belong to the account,
          not to a workspace — so both halves of the app get them. */}
      <Route
        element={
          <RequireAuth>
            <HomeLayout />
          </RequireAuth>
        }
      >
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/:sub" element={<SettingsPage />} />
      </Route>
      <Route
        path="/connection/:id"
        element={
          <RequireWorkspaceUser>
            <WorkspacePage />
          </RequireWorkspaceUser>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
