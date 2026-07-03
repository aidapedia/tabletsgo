import { useEffect, useState } from 'react'
import Button from '@/shared/ui/Button'
import ConfirmDialog from '@/shared/ui/ConfirmDialog'
import { useToast } from '@/shared/ui/Toast'
import { CopyIcon, TrashIcon } from '@/shared/ui/icons'
import { fieldInput, fieldLabel } from '@/shared/lib/styles'
import { listMembers, inviteMember, removeMember, Member } from '@/features/workspaces/api'

// Member management for a workspace: invite by email (with copyable link) and
// remove members. `canManage` gates the admin-only controls.
export default function MembersPanel({ workspaceId, canManage }: { workspaceId: string; canManage: boolean }) {
  const toast = useToast()
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [removing, setRemoving] = useState<Member | null>(null)

  const load = () => {
    setLoading(true)
    listMembers(workspaceId).then((m) => {
      setMembers(m)
      setLoading(false)
    })
  }
  useEffect(load, [workspaceId])

  const submitInvite = async (e) => {
    e.preventDefault()
    if (!email.trim()) return
    setInviting(true)
    setInviteLink(null)
    try {
      const { inviteLink: link, emailed } = await inviteMember(workspaceId, email.trim())
      setEmail('')
      load()
      if (link) {
        setInviteLink(link)
        toast.success(emailed ? 'Invite emailed. Link also copied below.' : 'Invite created — share the link below.')
      } else {
        toast.success('Member added.')
      }
    } catch (err) {
      toast.error(err.message)
    } finally {
      setInviting(false)
    }
  }

  const copyLink = () => {
    if (inviteLink) {
      navigator.clipboard?.writeText(inviteLink)
      toast.success('Invite link copied.')
    }
  }

  const confirmRemove = async () => {
    const m = removing
    setRemoving(null)
    if (!m) return
    setMembers((prev) => prev.filter((x) => x.userId !== m.userId))
    try {
      await removeMember(workspaceId, m.userId)
    } catch (err) {
      toast.error(err.message)
      load()
    }
  }

  return (
    <div>
      {canManage && (
        <form onSubmit={submitInvite} className="mb-5">
          <label className={fieldLabel}>Invite a member by email</label>
          <div className="flex gap-2">
            <input
              className={fieldInput}
              type="email"
              placeholder="teammate@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Button type="submit" variant="primary" size="sm" disabled={inviting}>
              {inviting ? 'Inviting…' : 'Invite'}
            </Button>
          </div>
          {inviteLink && (
            <div className="mt-2 flex items-center gap-2 rounded-soft border border-edge bg-elevated px-2.5 py-2">
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-dim">{inviteLink}</span>
              <button type="button" onClick={copyLink} className="shrink-0 text-ink-dim hover:text-ink" aria-label="Copy invite link">
                <CopyIcon width={15} height={15} />
              </button>
            </div>
          )}
        </form>
      )}

      <label className={fieldLabel}>Members ({members.length})</label>
      {loading ? (
        <div className="py-6 text-center text-xs text-ink-faint">Loading…</div>
      ) : (
        <div className="flex flex-col divide-y divide-edge overflow-hidden rounded-soft border border-edge">
          {members.map((m) => (
            <div key={m.userId} className="flex items-center gap-3 bg-elevated/30 px-3 py-2.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-green/15 text-[11px] font-bold text-green-bright">
                {(m.name || m.email)[0]?.toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-medium text-ink">{m.name || m.email}</div>
                <div className="truncate text-[11px] text-ink-faint">{m.email}</div>
              </div>
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${m.role === 'admin' ? 'bg-green/15 text-green-bright' : 'bg-edge text-ink-dim'}`}>
                {m.role}
              </span>
              {m.status === 'pending' && (
                <span className="shrink-0 rounded bg-amber/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber">pending</span>
              )}
              {canManage && (
                <button
                  onClick={() => setRemoving(m)}
                  className="shrink-0 text-ink-faint hover:text-red"
                  aria-label={`Remove ${m.email}`}
                >
                  <TrashIcon width={15} height={15} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {removing && (
        <ConfirmDialog
          title="Remove member?"
          message={`Remove ${removing.name || removing.email} from this workspace?`}
          confirmLabel="Remove"
          cancelLabel="Cancel"
          danger
          onConfirm={confirmRemove}
          onCancel={() => setRemoving(null)}
        />
      )}
    </div>
  )
}
