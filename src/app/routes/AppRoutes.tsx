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
import MembersPage from '@/pages/home/MembersPage'
import NotificationsPage from '@/pages/home/NotificationsPage'
import StoragePage from '@/pages/home/StoragePage'
import SettingsPage from '@/pages/home/SettingsPage'
import ResourceTreePage from '@/pages/home/ResourceTreePage'
import WorkspacePage from '@/pages/console/WorkspacePage'
import AdminWorkspacesPage from '@/pages/admin/AdminWorkspacesPage'
import AdminUsersPage from '@/pages/admin/AdminUsersPage'
import AdminEmailPage from '@/pages/admin/AdminEmailPage'

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
  // null = still checking. `needsSetup` means the instance has no administrator,
  // which is not the same as having no users — see getSetupStatus.
  const [setup, setSetup] = useState<{ needsSetup: boolean; hasUsers: boolean } | null>(null)

  useEffect(() => {
    getSetupStatus().then(setSetup)
  }, [])

  if (setup === null) return null // brief first-run check

  const setupDone = () => setSetup({ needsSetup: false, hasUsers: true })

  // Empty install → the wizard is the only thing there is. An instance that has
  // accounts but no admin is *not* forced through it: the people who already
  // have accounts still need the login page, so the wizard stays reachable at
  // /setup and the login page points at it.
  if (setup.needsSetup && !setup.hasUsers && !user) {
    return (
      <Routes>
        <Route path="/setup" element={<SetupPage onComplete={setupDone} />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    )
  }

  return (
    <Routes>
      <Route
        path="/setup"
        element={setup.needsSetup ? <SetupPage hasUsers onComplete={setupDone} /> : <Navigate to="/" replace />}
      />
      <Route path="/invite/:token" element={<AcceptInvitePage />} />
      <Route path="/forgot" element={user ? <Navigate to="/" replace /> : <ForgotPasswordPage />} />
      <Route path="/reset/:token" element={<ResetPasswordPage />} />
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage adminless={setup.needsSetup} />} />
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
        {/* Member left the Workspace tab bar for its own section; the old tab
            address stays as a redirect so existing links don't land on General.
            A static segment outranks `:sub`, so this wins. */}
        <Route path="/workspace/member" element={<Navigate to="/members" replace />} />
        <Route path="/workspace/:sub" element={<WorkspaceSettingsPage />} />
        <Route path="/members" element={<MembersPage />} />
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
        {/* The selected node is in the URL, so a refresh keeps it and a link
            lands on it. */}
        <Route path="/resource-tree" element={<ResourceTreePage />} />
        <Route path="/resource-tree/:nodeId" element={<ResourceTreePage />} />
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
