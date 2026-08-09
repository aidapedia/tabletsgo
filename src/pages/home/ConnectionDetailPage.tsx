import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  useConnections,
  ConnectionDetail,
  DETAIL_TABS,
  ConnectionExportModal,
  ConnectHandshakeDialog,
  useConnectHandshake,
} from '@/features/connections'
import { useWorkspaces } from '@/features/workspaces'
import ConfirmDialog from '@/shared/ui/feedback/ConfirmDialog'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import EmptyState from '@/shared/ui/feedback/EmptyState'
import useTabRoute from './useTabRoute'

/**
 * `/connections/:id/:tab` — one connection.
 *
 * Its own route rather than a mode of the list page, so the view survives a
 * refresh and can be linked to. The connection itself comes from the workspace's
 * already-loaded list: a connection this workspace doesn't have (a stale link,
 * or one deleted in another tab) resolves to nothing once loading is done, and
 * the page says so instead of rendering a broken shell.
 */
export default function ConnectionDetailPage() {
  const { id, tab } = useParams()
  const navigate = useNavigate()
  const { connections, loading, reload, removeConnection } = useConnections()
  // On a cold load of this URL the workspace resolves first and the connection
  // list only after it — count both, or the page flashes "doesn't exist".
  const { loading: workspaceLoading } = useWorkspaces()
  const { connect, connectingId, failure, dismiss, openAnyway } = useConnectHandshake()

  const [deleting, setDeleting] = useState<any>(null)
  const [exporting, setExporting] = useState<any>(null)

  const conn = connections.find((c) => String(c.id) === String(id))
  const { active, onTab } = useTabRoute(`/connections/${id}`, DETAIL_TABS, tab)

  if (loading || workspaceLoading) return <LoadingState className="py-20 text-center" />
  if (!conn) {
    return (
      <EmptyState className="py-20">
        This connection no longer exists in this workspace.{' '}
        <button className="text-green hover:underline" onClick={() => navigate('/connections')}>
          Back to connections
        </button>
      </EmptyState>
    )
  }

  const confirmDelete = async () => {
    setDeleting(null)
    await removeConnection(conn.id)
    navigate('/connections')
  }

  return (
    <>
      <ConnectionDetail
        conn={conn}
        tab={active}
        onTab={onTab}
        onBack={() => navigate('/connections')}
        onOpen={() => connect(conn)}
        connecting={connectingId === conn.id}
        onEdit={(c, formTab) => navigate(`/connections/${c.id}/edit${formTab ? `/${formTab}` : ''}`)}
        onDelete={setDeleting}
        onExport={setExporting}
        onRefresh={reload}
      />

      {exporting && <ConnectionExportModal conn={exporting} onClose={() => setExporting(null)} />}

      {deleting && (
        <ConfirmDialog
          title="Delete connection?"
          message={`Delete connection "${deleting.name}"? Its saved queries, workflows and history will be removed too.`}
          confirmLabel="Delete"
          cancelLabel="Cancel"
          danger
          onConfirm={confirmDelete}
          onCancel={() => setDeleting(null)}
        />
      )}

      {failure && (
        <ConnectHandshakeDialog
          conn={failure.conn}
          result={failure.result}
          busy={connectingId === failure.conn.id}
          onRetry={() => connect(failure.conn)}
          onEdit={() => {
            dismiss()
            navigate(`/connections/${failure.conn.id}/edit`)
          }}
          onOpenAnyway={() => openAnyway(failure.conn)}
          onClose={dismiss}
        />
      )}
    </>
  )
}
