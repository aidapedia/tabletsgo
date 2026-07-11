import { useEffect, useState } from 'react'
import Button from '@/shared/ui/buttons/Button'
import TextButton from '@/shared/ui/buttons/TextButton'
import ConfirmDialog from '@/shared/ui/feedback/ConfirmDialog'
import { useToast } from '@/shared/ui/feedback/Toast'
import { CopyIcon, TrashIcon } from '@/shared/ui/icons'
import Avatar from '@/shared/ui/Avatar'
import Badge from '@/shared/ui/Badge'
import { Input } from '@/shared/ui/form/Input'
import { Label } from '@/shared/ui/form/Form'
import { listMembers, inviteMember, removeMember, Member } from '@/features/workspaces/api'
import LoadingState from '@/shared/ui/feedback/LoadingState'

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

  // The workspace must keep at least one admin, so the sole admin can't be removed.
  const adminCount = members.filter((m) => m.role === 'admin').length

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
          <Label>Invite a member by email</Label>
          <div className="flex gap-2">
            <Input
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
              <TextButton className="shrink-0" onClick={copyLink} aria-label="Copy invite link">
                <CopyIcon width={15} height={15} />
              </TextButton>
            </div>
          )}
        </form>
      )}

      <Label>Members ({members.length})</Label>
      {loading ? (
        <LoadingState />
      ) : (
        <div className="flex flex-col divide-y divide-edge overflow-hidden rounded-soft border border-edge">
          {members.map((m) => (
            <div key={m.userId} className="flex items-center gap-3 bg-elevated/30 px-3 py-2.5">
              <Avatar label={m.name || m.email} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-medium text-ink">{m.name || m.email}</div>
                <div className="truncate text-[11px] text-ink-faint">{m.email}</div>
              </div>
              <Badge tone={m.role === 'admin' ? 'green' : 'neutral'} className="shrink-0">{m.role}</Badge>
              {m.status === 'pending' && <Badge tone="amber" className="shrink-0">pending</Badge>}
              {canManage && !(m.role === 'admin' && adminCount <= 1) && (
                <TextButton
                  tone="faint"
                  className="shrink-0 hover:!text-red"
                  onClick={() => setRemoving(m)}
                  aria-label={`Remove ${m.email}`}
                >
                  <TrashIcon width={15} height={15} />
                </TextButton>
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
