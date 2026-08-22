import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useConnections, ConnectionForm } from '@/features/connections'
import { useWorkspaces } from '@/features/workspaces'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import EmptyState from '@/shared/ui/feedback/EmptyState'

/**
 * `/connections/new` and `/connections/:id/edit/:tab` — the create/edit form.
 *
 * Both modes are the same component; `id` is what tells them apart. A new
 * connection's preselected engine rides in `?type=` (the db-type picker on the
 * list page sets it), and the form's own tab is a path segment so
 * `/connections/42/edit/backup` opens straight on the backup settings.
 */
export default function ConnectionFormPage() {
  const { id, tab } = useParams()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { connections, loading, addConnection, updateConnection } = useConnections()
  // Same cold-load ordering as the detail page: workspace first, then its list.
  const { loading: workspaceLoading } = useWorkspaces()

  const isEdit = !!id
  const conn = isEdit ? connections.find((c) => String(c.id) === String(id)) : null

  // Where "back"/"cancel"/"saved" all land: the record you were working on if it
  // exists, otherwise the list.
  const backTo = () => navigate(isEdit ? `/connections/${id}` : '/connections')

  if (isEdit && (loading || workspaceLoading)) return <LoadingState className="py-20 text-center" />
  if (isEdit && !conn) {
    return (
      <EmptyState className="py-20">
        This connection no longer exists in this workspace.{' '}
        <button className="text-green hover:underline" onClick={() => navigate('/connections')}>
          Back to connections
        </button>
      </EmptyState>
    )
  }

  const handleSave = async (data) => {
    if (isEdit) {
      await updateConnection(conn.id, data)
      navigate(`/connections/${conn.id}`)
      return
    }
    const created = await addConnection(data)
    navigate(created ? `/connections/${created.id}` : '/connections')
  }

  return (
    <ConnectionForm
      // Remount on the connection being edited so the form never carries one
      // record's draft into another.
      key={id || 'new'}
      initial={conn}
      initialType={params.get('type') || undefined}
      tab={tab || 'general'}
      onTab={(next) => navigate(`/connections/${id}/edit/${next}`, { replace: true })}
      onClose={backTo}
      onList={() => navigate('/connections')}
      onSave={handleSave}
    />
  )
}
