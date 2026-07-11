import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '@/shared/ui/buttons/Button'
import ConfirmDialog from '@/shared/ui/feedback/ConfirmDialog'
import { useToast } from '@/shared/ui/feedback/Toast'
import { Input } from '@/shared/ui/form/Input'
import { Label } from '@/shared/ui/form/Form'
import { useWorkspaces, updateWorkspace, deleteWorkspace } from '@/features/workspaces'
import LoadingState from '@/shared/ui/feedback/LoadingState'

// General workspace settings: rename the workspace and (admin) delete it.
export default function WorkspaceGeneral() {
  const navigate = useNavigate()
  const toast = useToast()
  const { current, refresh } = useWorkspaces()
  const [name, setName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (current) setName(current.name)
  }, [current?.id, current?.name])

  if (!current) return <LoadingState className="" />

  const isAdmin = current.role === 'admin'

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
        <Label>Workspace name</Label>
        <div className="flex gap-2">
          <Input value={name} disabled={!isAdmin} onChange={(e) => setName(e.target.value)} />
          {isAdmin && (
            <Button variant="primary" size="sm" onClick={saveName} disabled={savingName || !name.trim() || name.trim() === current.name}>
              Save
            </Button>
          )}
        </div>
        {!isAdmin && <p className="mt-2 text-[11px] text-ink-faint">Only workspace admins can change these settings.</p>}
      </div>

      {isAdmin && (
        <div className="rounded-card border border-red/30 bg-red/5 p-5">
          <div className="text-[13px] font-bold text-red">Delete workspace</div>
          <p className="mt-1.5 text-[11px] text-ink-dim">
            Permanently deletes this workspace and all of its connections, saved queries and history.
          </p>
          <Button variant="subtle" size="sm" className="mt-3 !border-red/40 !text-red hover:!bg-red/10" onClick={() => setConfirmDelete(true)}>
            Delete this workspace
          </Button>
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete workspace?"
          message={`This permanently deletes "${current.name}" and everything in it. This cannot be undone.`}
          confirmLabel="Delete workspace"
          cancelLabel="Cancel"
          danger
          onConfirm={doDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  )
}
