import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ExternalLink } from 'lucide-react'
import { useWorkspaces, can, deleteWorkspace, updateWorkspace } from '@/features/workspaces'
import { useIdentity } from '@/features/auth'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import { Button } from '@/shared/ui/button'
import { Label } from '@/shared/ui/label'
import { Input } from '@/shared/ui/input'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'

// General workspace settings. Enterprise: the workspace is a Hayat tenant, so
// its name is shown here and changed in Hayat. Solo: the one workspace's name
// is changed here. Either way what tabletsgo can remove is its own data.
// Workspace-wide defaults (e.g. the session limit) live in WorkspaceConfig.
export default function WorkspaceGeneral() {
  const navigate = useNavigate()
  const { current, refresh } = useWorkspaces()
  const { solo } = useIdentity()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [name, setName] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  if (!current) return <LoadingState className="" />
  const canDelete = can(current, 'workspace.delete')
  const canRename = solo && can(current, 'workspace.manage')
  const draft = name ?? current.name

  const rename = async () => {
    setSaving(true)
    try {
      await updateWorkspace(current.id, { name: draft })
      await refresh()
      setName(null)
      toast.success('Renamed the workspace.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async () => {
    setConfirmDelete(false)
    try {
      await deleteWorkspace(current.id)
      await refresh()
      toast.success('Removed the workspace’s data from tabletsgo.')
      navigate('/')
    } catch (err) {
      toast.error(err.message)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="max-w-[360px]">
        <Label className="mb-2" htmlFor="workspace-name">Workspace name</Label>
        {canRename ? (
          <div className="flex gap-2">
            <Input id="workspace-name" value={draft} onChange={(e) => setName(e.target.value)} />
            <Button size="sm" className="h-auto" disabled={saving || !draft.trim() || draft === current.name} onClick={rename}>
              {saving ? 'Saving…' : 'Rename'}
            </Button>
          </div>
        ) : (
          <Input id="workspace-name" value={current.name} disabled readOnly />
        )}
        {!solo && (
          <p className="mt-2 text-[11px] text-faint">
            The name, members and groups belong to the workspace in Hayat.{' '}
            {current.manageUrl && (
              <a className="inline-flex items-center gap-1 text-primary-bright hover:underline" href={current.manageUrl} target="_blank" rel="noreferrer">
                Open in Hayat <ExternalLink className="size-3" />
              </a>
            )}
          </p>
        )}
      </div>

      {canDelete && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5">
          <div className="text-[13px] font-bold text-destructive">Remove workspace data</div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Permanently deletes everything tabletsgo holds for this workspace: its connections, saved queries, history, storage destinations and SSH hosts.{' '}
            {solo ? 'The workspace itself stays, empty.' : 'The workspace itself stays in Hayat.'}
          </p>
          <Button variant="ghost" size="sm" className="mt-3 !border-destructive/40 !text-destructive hover:!bg-destructive/10" onClick={() => setConfirmDelete(true)}>
            Remove workspace data
          </Button>
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Remove workspace data?"
          description={`This permanently deletes every connection, saved query and history entry tabletsgo holds for "${current.name}". This cannot be undone.`}
          confirmLabel="Remove data"
          cancelLabel="Cancel"
          destructive
          typeToConfirm={current.name}
          onConfirm={doDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  )
}
