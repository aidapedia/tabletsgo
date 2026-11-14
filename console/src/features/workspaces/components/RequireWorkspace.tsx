import { Outlet } from 'react-router-dom'
import { PageLoading } from '@/shared/ui/feedback/LoadingState'
import { useWorkspaces } from '../stores/WorkspaceContext'
import NoWorkspace from './NoWorkspace'

// Route guard for the pages that work on the current workspace. They read
// `current` and would otherwise wait on it forever when the person is in none.
export default function RequireWorkspace() {
  const { current, loading } = useWorkspaces()
  if (loading) return <PageLoading />
  return current ? <Outlet /> : <NoWorkspace />
}
