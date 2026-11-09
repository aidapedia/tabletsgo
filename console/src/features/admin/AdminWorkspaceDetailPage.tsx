import { useNavigate, useParams } from 'react-router-dom'
import { AdminWorkspaceDetail, WORKSPACE_DETAIL_TABS } from '@/features/admin'
import useTabRoute from '@/shared/hooks/useTabRoute'

/** `/admin/workspaces/:id/:tab` — binds the address to the feature's detail view. */
export default function AdminWorkspaceDetailPage() {
  const { id, tab } = useParams()
  const navigate = useNavigate()
  const { active, onTab } = useTabRoute(`/admin/workspaces/${id}`, WORKSPACE_DETAIL_TABS, tab)

  return <AdminWorkspaceDetail id={id as string} tab={active} onTab={onTab} onBack={() => navigate('/admin')} />
}
