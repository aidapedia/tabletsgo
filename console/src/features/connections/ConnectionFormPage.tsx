import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useConnections, ConnectionForm } from '@/features/connections'
import { useWorkspaces, can } from '@/features/workspaces'
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
  const { current, loading: workspaceLoading } = useWorkspaces()

  const isEdit = !!id
  const conn = isEdit ? connections.find((c) => String(c.id) === String(id)) : null

  // Where "back"/"cancel"/"saved" all land: the record you were working on if it
  // exists, otherwise the list.
  const backTo = () => navigate(isEdit ? `/connections/${id}` : '/connections')

  if (isEdit && (loading || workspaceLoading)) return <LoadingState className="py-20 text-center" />
  // The add buttons are hidden without `connections.create`, but the address
  // still opens; say so here rather than let the save be refused.
  if (!isEdit && workspaceLoading) return <LoadingState className="py-20 text-center" />
  if (!isEdit && !can(current, 'connections.create')) {
    return (
      <EmptyState className="py-20">
        You can't add connections in {current?.name || 'this workspace'} — ask a workspace owner to grant you a role that
        includes "Add connections" in Hayat.{' '}
        <button className="text-primary hover:underline" onClick={() => navigate('/connections')}>
          Back to connections
        </button>
      </EmptyState>
    )
  }
  if (isEdit && !conn) {
    return (
      <EmptyState className="py-20">
        This connection no longer exists in this workspace.{' '}
        <button className="text-primary hover:underline" onClick={() => navigate('/connections')}>
          Back to connections
        </button>
      </EmptyState>
    )
  }

  // `connect` lands a new connection straight in its console (the form already
  // probed it); a plain save lands on its detail page.
  // A refused save stays on the form with the server's reason, so nothing is
  // lost and nobody is sent to a list that doesn't have it.
  const handleSave = async (data, { connect = false } = {}) => {
    try {
      if (isEdit) {
        await updateConnection(conn.id, data)
        navigate(`/connections/${conn.id}`)
        return
      }
      const created = await addConnection(data)
      navigate(connect ? `/connection/${created.id}` : `/connections/${created.id}`)
    } catch (error) {
      toast.error((error as Error).message || 'Could not save the connection.')
    }
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
      onSave={handleSave}
    />
  )
}
