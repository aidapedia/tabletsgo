import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '@/shared/ui/Button'
import ConfirmDialog from '@/shared/ui/ConfirmDialog'
import { useToast } from '@/shared/ui/Toast'
import { ChevronLeft } from '@/shared/ui/icons'
import { fieldInput, fieldLabel } from '@/shared/lib/styles'
import { useWorkspaces, MembersPanel, SmtpSettings, updateWorkspace, deleteWorkspace } from '@/features/workspaces'

const card = 'rounded-card border border-edge bg-card p-5'
const sectionTitle = 'text-[13px] font-bold text-ink'

export default function WorkspaceSettingsPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const { current, loading, refresh } = useWorkspaces()
  const [name, setName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (current) setName(current.name)
  }, [current?.id, current?.name])

  const isAdmin = current?.role === 'admin'

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
    <div className="mx-auto h-screen max-w-[760px] overflow-y-auto px-8 py-10 max-[720px]:px-5">
      <button onClick={() => navigate('/')} className="mb-6 inline-flex items-center gap-1.5 text-[12px] text-ink-dim hover:text-ink">
        <ChevronLeft width={16} height={16} /> Back
      </button>

      <h1 className="text-[22px] font-bold tracking-[-0.4px]">Workspace settings</h1>
      <p className="mt-1.5 text-[13px] text-ink-dim">Manage {current?.name || 'your workspace'} and its members.</p>

      {loading || !current ? (
        <div className="mt-8 text-xs text-ink-faint">Loading…</div>
      ) : (
        <div className="mt-7 flex flex-col gap-4">
          {/* General */}
          <div className={card}>
            <div className={sectionTitle}>General</div>
            <div className="mt-3 max-w-[360px]">
              <label className={fieldLabel}>Workspace name</label>
              <div className="flex gap-2">
                <input className={fieldInput} value={name} disabled={!isAdmin} onChange={(e) => setName(e.target.value)} />
                {isAdmin && (
                  <Button variant="primary" size="sm" onClick={saveName} disabled={savingName || !name.trim() || name.trim() === current.name}>
                    Save
                  </Button>
                )}
              </div>
              {!isAdmin && <p className="mt-2 text-[11px] text-ink-faint">Only workspace admins can change these settings.</p>}
            </div>
          </div>

          {/* Members */}
          <div className={card}>
            <div className={`${sectionTitle} mb-3`}>Members</div>
            <MembersPanel workspaceId={current.id} canManage={isAdmin} />
          </div>

          {/* Email / SMTP (admin) */}
          {isAdmin && (
            <div className={card}>
              <div className={`${sectionTitle} mb-3`}>Email (SMTP)</div>
              <SmtpSettings workspaceId={current.id} />
            </div>
          )}

          {/* Danger zone */}
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
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete workspace?"
          message={`This permanently deletes "${current?.name}" and everything in it. This cannot be undone.`}
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
