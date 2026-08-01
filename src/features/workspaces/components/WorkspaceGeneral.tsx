import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '@/shared/ui/buttons/Button'
import ConfirmDialog from '@/shared/ui/feedback/ConfirmDialog'
import { useToast } from '@/shared/ui/feedback/Toast'
import { Input } from '@/shared/ui/form/Input'
import { Label } from '@/shared/ui/form/Form'
import { useWorkspaces, updateWorkspace, deleteWorkspace, getWorkspace } from '@/features/workspaces'
import NumberStepper from '@/shared/ui/form/NumberStepper'
import LoadingState from '@/shared/ui/feedback/LoadingState'

// General workspace settings: rename the workspace, set the default session
// limit every connection inherits, and (admin) delete it.
export default function WorkspaceGeneral() {
  const navigate = useNavigate()
  const toast = useToast()
  const { current, refresh } = useWorkspaces()
  const [name, setName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  // Session policy lives on the workspace *detail* response, not the list.
  const [maxSessions, setMaxSessions] = useState(0)
  const [savedMaxSessions, setSavedMaxSessions] = useState(0)
  const [instanceDefault, setInstanceDefault] = useState(0)
  const [savingSessions, setSavingSessions] = useState(false)

  useEffect(() => {
    if (current) setName(current.name)
  }, [current?.id, current?.name])

  useEffect(() => {
    if (!current) return
    let alive = true
    getWorkspace(current.id)
      .then((w) => {
        if (!alive) return
        setMaxSessions(w.sessions?.maxPerConnection || 0)
        setSavedMaxSessions(w.sessions?.maxPerConnection || 0)
        setInstanceDefault(w.sessions?.instanceDefault || 0)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [current?.id])

  if (!current) return <LoadingState className="" />

  const isOwner = current.role === 'owner'

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

  const saveSessions = async () => {
    if (!isOwner || maxSessions === savedMaxSessions) return
    setSavingSessions(true)
    try {
      await updateWorkspace(current.id, { sessions: { maxPerConnection: maxSessions } })
      setSavedMaxSessions(maxSessions)
      toast.success(maxSessions ? `Connections now allow ${maxSessions} concurrent session(s) by default.` : 'Session limit removed.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSavingSessions(false)
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
          <Input value={name} disabled={!isOwner} onChange={(e) => setName(e.target.value)} />
          {isOwner && (
            <Button variant="primary" size="sm" onClick={saveName} disabled={savingName || !name.trim() || name.trim() === current.name}>
              Save
            </Button>
          )}
        </div>
        {!isOwner && <p className="mt-2 text-[11px] text-ink-faint">Only workspace admins can change these settings.</p>}
      </div>

      {/* Default session limit — every connection that doesn't set its own inherits this. */}
      <div className="max-w-[360px]">
        <Label>Max sessions per connection</Label>
        <div className="flex gap-2">
          <NumberStepper
            value={maxSessions}
            min={0}
            max={999}
            ariaLabel="Max sessions per connection"
            onChange={(n) => setMaxSessions(n || 0)}
          />
          {isOwner && (
            <Button variant="primary" size="sm" onClick={saveSessions} disabled={savingSessions || maxSessions === savedMaxSessions}>
              Save
            </Button>
          )}
        </div>
        <p className="mt-2 text-[11px] text-ink-faint">
          How many connections to a database this workspace keeps open at once — one per database being browsed. 0 means{' '}
          {instanceDefault ? `the server default (${instanceDefault})` : 'unlimited'}. A connection can override it in its own settings.
        </p>
      </div>

      {isOwner && (
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
