import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/features/auth'
import { PageLoading } from '@/shared/ui/feedback/LoadingState'
import { useWorkspaces } from '../stores/WorkspaceContext'
import NoWorkspace from './NoWorkspace'

// Route guard for the pages that work on the current workspace. They read
// `current` and would otherwise wait on it forever when the person is in none.
// An instance admin in none — right after enrolling with Hayat, before any
// workspace exists — has the admin area to work in, so they go there.
// (Anyone else in none never gets this far: `NoWorkspaceGate` stops them first.)
export default function RequireWorkspace() {
  const { user } = useAuth()
  const { current, loading } = useWorkspaces()
  if (loading) return <PageLoading />
  if (current) return <Outlet />
  return user?.role === 'admin' ? <Navigate to="/admin" replace /> : <NoWorkspace />
}

/**
 * Wraps the whole signed-in app: someone in no workspace who isn't an instance
 * admin sees why, on its own page, instead of the app around an empty middle.
 * An admin passes — the admin area needs no workspace.
 */
export function NoWorkspaceGate({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const { workspaces, loading } = useWorkspaces()
  if (user?.role === 'admin') return children
  if (loading) return <PageLoading screen />
  return workspaces.length ? children : <NoWorkspace />
}
