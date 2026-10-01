import { lazy, Suspense, useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth, getSetupStatus } from '@/features/auth'

// Each address loads its page only when visited. The console and schema editor
// have large editor dependencies; importing every page here made them part of
// the initial download even for someone opening the login screen.
const LoginPage = lazy(() => import('@/pages/auth/LoginPage'))
const SetupPage = lazy(() => import('@/pages/auth/SetupPage'))
const AcceptInvitePage = lazy(() => import('@/pages/auth/AcceptInvitePage'))
const ForgotPasswordPage = lazy(() => import('@/pages/auth/ForgotPasswordPage'))
const ResetPasswordPage = lazy(() => import('@/pages/auth/ResetPasswordPage'))
const HomeLayout = lazy(() => import('@/app/layouts/HomeLayout'))
const HomePage = lazy(() => import('@/pages/home/HomePage'))
const DashboardsPage = lazy(() => import('@/pages/home/DashboardsPage'))
const ConnectionsPage = lazy(() => import('@/pages/home/ConnectionsPage'))
const ConnectionDetailPage = lazy(() => import('@/pages/home/ConnectionDetailPage'))
const ConnectionFormPage = lazy(() => import('@/pages/home/ConnectionFormPage'))
const WorkspaceSettingsPage = lazy(() => import('@/pages/home/WorkspaceSettingsPage'))
const MembersPage = lazy(() => import('@/pages/home/MembersPage'))
const NotificationsPage = lazy(() => import('@/pages/home/NotificationsPage'))
const StoragePage = lazy(() => import('@/pages/home/StoragePage'))
const SshHostsPage = lazy(() => import('@/pages/home/SshHostsPage'))
const SshKeysPage = lazy(() => import('@/pages/home/SshKeysPage'))
const SettingsPage = lazy(() => import('@/pages/home/SettingsPage'))
const ResourceTreePage = lazy(() => import('@/pages/home/ResourceTreePage'))
const WorkflowsPage = lazy(() => import('@/pages/home/WorkflowsPage'))
const SchemasPage = lazy(() => import('@/pages/home/SchemasPage'))
const SchemaDraftPage = lazy(() => import('@/pages/home/SchemaDraftPage'))
const WorkspacePage = lazy(() => import('@/pages/console/WorkspacePage'))
const AdminWorkspacesPage = lazy(() => import('@/pages/admin/AdminWorkspacesPage'))
const AdminUsersPage = lazy(() => import('@/pages/admin/AdminUsersPage'))
const AdminEmailPage = lazy(() => import('@/pages/admin/AdminEmailPage'))

const routeFallback = <div role="status" className="p-8 text-center text-sm text-ink-dim">Loading…</div>

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
      <Suspense fallback={routeFallback}><Routes>
        <Route path="/setup" element={<SetupPage onComplete={setupDone} />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes></Suspense>
    )
  }

  return (
    <Suspense fallback={routeFallback}><Routes>
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
        <Route path="/" element={<HomePage />} />
        {/* Dashboards live on connections; this is the workspace-wide list of
            them, alongside /workflows. A row opens the dashboard in its
            connection's console. */}
        <Route path="/dashboards" element={<DashboardsPage />} />
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
        {/* SSH is a sidebar group, not a page: its two rows are the
            addresses, and the bare group path lands on the first. */}
        <Route path="/ssh" element={<Navigate to="/ssh/hosts" replace />} />
        <Route path="/ssh/hosts" element={<SshHostsPage />} />
        <Route path="/ssh/keys" element={<SshKeysPage />} />
        {/* Workflows live on connections; this is the workspace-wide list of
            them. A row opens the workflow in its connection's console. */}
        <Route path="/workflows" element={<WorkflowsPage />} />
        {/* Same for schema drafts — the cross-connection list. */}
        <Route path="/schemas" element={<SchemasPage />} />
      </Route>
      {/* The schema editor page: it hosts the designer for either kind of
          draft — one designed against a connection (drawn from that live
          database, for anyone with access to it) or one from scratch, which
          has no console to open in at all. The console has no diagram of its
          own; this address is the diagram and its drafts.

          Two ways in. `/schemas/connection/:connectionId` is the console's rail
          icon: a database in hand but no draft id, which the page resolves to
          that connection's newest draft (or an unsaved canvas over its live
          tables). `/schemas/:id` is a draft by id, where the Schema list and
          that redirect both land. The static `connection` segment outranks
          `:id`, so the two never collide.

          Both sit *outside* HomeLayout on purpose: a diagram is a canvas, so it
          gets the whole viewport the way the console does, rather than a panel
          inside the shell's padded scroller. Its own header carries the way
          back. */}
      <Route
        path="/schemas/connection/:connectionId"
        element={
          <RequireWorkspaceUser>
            <SchemaDraftPage />
          </RequireWorkspaceUser>
        }
      />
      <Route
        path="/schemas/:id"
        element={
          <RequireWorkspaceUser>
            <SchemaDraftPage />
          </RequireWorkspaceUser>
        }
      />
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
    </Routes></Suspense>
  )
}
