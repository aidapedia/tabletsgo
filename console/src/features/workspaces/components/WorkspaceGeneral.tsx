import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useWorkspaces, can, updateWorkspace, deleteWorkspace } from '@/features/workspaces'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import { Button } from '@/shared/ui/button'
import { Label } from '@/shared/ui/label'
import { Input } from '@/shared/ui/input'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'

// General workspace settings: rename the workspace and (admin) delete it.
// Workspace-wide defaults (e.g. the session limit) live in WorkspaceConfig.
export default function WorkspaceGeneral() {
  const navigate = useNavigate()
  const { current, refresh } = useWorkspaces()
  const [name, setName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (current) setName(current.name)
  }, [current?.id, current?.name])

  if (!current) return <LoadingState className="" />

  // Renaming is workspace.manage; deleting is its own permission, so a role can
  // be trusted with the settings without being able to destroy the workspace.
  const canManage = can(current, 'workspace.manage')
  const canDelete = can(current, 'workspace.delete')

  const saveName = async () => {
    if (!name.trim() || name.trim() === current.name) return
    setSavingName(true)
    try {
      await updateWorkspace(current.id, { name: name.trim() })
      await refresh()
      toast.success('Workspace renamed.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSavingName(false)
    }
  }

  const doDelete = async () => {
    setConfirmDelete(false)
    try {
      await deleteWorkspace(current.id)
      await refresh()
      toast.success('Workspace deleted.')
      navigate('/')
    } catch (err) {
      toast.error(err.message)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="max-w-[360px]">
        <Label className="mb-2">Workspace name</Label>
        <div className="flex gap-2">
          <Input value={name} disabled={!canManage} onChange={(e) => setName(e.target.value)} />
          {canManage && (
            <Button variant="default" size="sm" onClick={saveName} disabled={savingName || !name.trim() || name.trim() === current.name}>
              Save
            </Button>
          )}
        </div>
        {!canManage && <p className="mt-2 text-[11px] text-faint">Your role can’t change these settings.</p>}
      </div>

      {canDelete && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5">
          <div className="text-[13px] font-bold text-destructive">Delete workspace</div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Permanently deletes this workspace and all of its connections, saved queries and history.
          </p>
          <Button variant="ghost" size="sm" className="mt-3 !border-destructive/40 !text-destructive hover:!bg-destructive/10" onClick={() => setConfirmDelete(true)}>
            Delete this workspace
          </Button>
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete workspace?"
          description={`This permanently deletes "${current.name}" and everything in it. This cannot be undone.`}
          confirmLabel="Delete workspace"
          cancelLabel="Cancel"
          destructive
          onConfirm={doDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  )
}
