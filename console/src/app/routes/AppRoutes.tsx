import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth, useIdentity, AuthCard, EnterpriseOnly, SoloSetup, SoloSignIn } from '@/features/auth'
import { Section } from '@/shared/ui/page/Section'
import { RequireWorkspace } from '@/features/workspaces'
import { PageLoading } from '@/shared/ui/feedback/LoadingState'

// Each address loads its page only when visited. The console and schema editor
// have large editor dependencies; importing every page here made them part of
// the initial download.
const CallbackPage = lazy(() => import('@/features/auth/CallbackPage'))
const HomeLayout = lazy(() => import('@/app/layouts/HomeLayout'))
const HomePage = lazy(() => import('@/features/workspaces/HomePage'))
const DashboardsPage = lazy(() => import('@/features/dashboard/DashboardsPage'))
const ConnectionsPage = lazy(() => import('@/features/connections/ConnectionsPage'))
const ConnectionDetailPage = lazy(() => import('@/features/connections/ConnectionDetailPage'))
const ConnectionFormPage = lazy(() => import('@/features/connections/ConnectionFormPage'))
const WorkspaceSettingsPage = lazy(() => import('@/features/workspaces/WorkspaceSettingsPage'))
const MembersPage = lazy(() => import('@/features/workspaces/MembersPage'))
const MemberDetailPage = lazy(() => import('@/features/workspaces/MemberDetailPage'))
const NotificationsPage = lazy(() => import('@/features/workspaces/NotificationsPage'))
const StoragePage = lazy(() => import('@/features/backup/StoragePage'))
const SshHostsPage = lazy(() => import('@/features/ssh/SshHostsPage'))
const SshKeysPage = lazy(() => import('@/features/ssh/SshKeysPage'))
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage'))
const WorkflowsPage = lazy(() => import('@/features/workflow/WorkflowsPage'))
const SchemasPage = lazy(() => import('@/features/schema-designer/SchemasPage'))
const SchemaDraftPage = lazy(() => import('@/features/schema-designer/SchemaDraftPage'))
const WorkspacePage = lazy(() => import('@/features/workspace/WorkspacePage'))
const AdminEmailPage = lazy(() => import('@/features/admin/AdminEmailPage'))
const AdminModulesPage = lazy(() => import('@/features/modules/AdminModulesPage'))
const AdminUpdatesPage = lazy(() => import('@/features/system-update/AdminUpdatesPage'))

const routeFallback = <PageLoading screen />

/**
 * Signed in, or on the way there. Enterprise: a visitor without a token is sent
 * to Hayat's sign-in page and comes back to where they were. Solo: the owner's
 * sign-in (or the first-run setup) is drawn right here, at the address asked for.
 */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { status, config, signIn } = useAuth()
  const location = useLocation()
  const solo = config?.mode === 'solo'
  useEffect(() => {
    if (status === 'signedOut' && !solo) void signIn(location.pathname + location.search)
  }, [status, solo, signIn, location.pathname, location.search])
  if (status === 'unconfigured') return <SignInUnavailable />
  if (status === 'setup') return <SoloSetup />
  if (status === 'signedOut' && solo) return <SoloSignIn />
  return status === 'signedIn' ? children : routeFallback
}

// Pages about other people. A solo instance has nobody else: say why at the
// address instead of showing an empty roster (the menu doesn't list them).
function RequirePeople({ children }: { children: React.ReactNode }) {
  const { people } = useIdentity()
  if (people) return children
  return (
    <Section title="Member" desc="Who belongs to this workspace.">
      <EnterpriseOnly />
    </Section>
  )
}

// The admin area is for whoever holds tabletsgo's admin role at Hayat's root.
function RequireSystemAdmin({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  return <RequireAuth>{user?.role === 'admin' ? children : <Navigate to="/" replace />}</RequireAuth>
}

// The server refuses to start in enterprise mode without Hayat, so this is a
// misconfigured proxy or an old server answering — say so instead of looping
// through a sign-in.
function SignInUnavailable() {
  return (
    <AuthCard>
      <h1 className="mb-2 text-[16px] font-semibold">Signing in isn’t set up</h1>
      <p className="text-[13px] text-muted-foreground">
        This instance signs people in with Hayat, and doesn’t know where Hayat is. An administrator needs to set the HAYAT_* settings.
      </p>
    </AuthCard>
  )
}

export function AppRoutes() {
  return (
    <Suspense fallback={routeFallback}><Routes>
      {/* Hayat sends the browser back here after signing in. */}
      <Route path="/callback" element={<CallbackPage />} />
      {/* Old addresses of pages Hayat now owns; land somewhere useful. */}
      <Route path="/login" element={<Navigate to="/" replace />} />
      {/* Instance administration — the admin's half of the app, same shell. */}
      <Route
        element={
          <RequireSystemAdmin>
            <HomeLayout />
          </RequireSystemAdmin>
        }
      >
        <Route path="/admin" element={<Navigate to="/admin/modules" replace />} />
        <Route path="/admin/email" element={<AdminEmailPage />} />
        <Route path="/admin/modules" element={<AdminModulesPage />} />
        <Route path="/admin/updates" element={<AdminUpdatesPage />} />
      </Route>
      {/* Home shell — each sidebar section is its own page rendered into the layout's <Outlet/>. */}
      <Route
        element={
          <RequireAuth>
            <HomeLayout />
          </RequireAuth>
        }
      >
        {/* Everything below works on the current workspace; someone in none
            sees why instead of a page waiting on one. */}
        <Route element={<RequireWorkspace />}>
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
        <Route path="/members" element={<RequirePeople><MembersPage /></RequirePeople>} />
        {/* One member and what reaches them — an address, so it can be linked to. */}
        <Route path="/members/:userId" element={<RequirePeople><MemberDetailPage /></RequirePeople>} />
        <Route path="/notifications" element={<NotificationsPage />} />
        {/* The section lost its tabs when SMTP moved to the admin area; the
            :sub route stays so old links (e.g. /notifications/smtp) still land
            here instead of bouncing to the dashboard. */}
        <Route path="/notifications/:sub" element={<NotificationsPage />} />
        <Route path="/storage" element={<StoragePage />} />
        {/* SSH has no page of its own: its two sidebar rows are the
            addresses, and the bare path lands on the first. */}
        <Route path="/ssh" element={<Navigate to="/ssh/hosts" replace />} />
        <Route path="/ssh/hosts" element={<SshHostsPage />} />
        <Route path="/ssh/keys" element={<SshKeysPage />} />
        {/* Workflows live on connections; this is the workspace-wide list of
            them. A row opens the workflow in its connection's console. */}
        <Route path="/workflows" element={<WorkflowsPage />} />
        {/* Same for schema drafts — the cross-connection list. */}
        <Route path="/schemas" element={<SchemasPage />} />
        </Route>
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
          <RequireAuth>
            <SchemaDraftPage />
          </RequireAuth>
        }
      />
      <Route
        path="/schemas/:id"
        element={
          <RequireAuth>
            <SchemaDraftPage />
          </RequireAuth>
        }
      />
      {/* Personal settings (theme, local data) belong to the account,
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
          <RequireAuth>
            <WorkspacePage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes></Suspense>
  )
}
