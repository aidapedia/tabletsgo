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
import { listMembers, inviteMember, listRoles, removeMember, setMemberRole, Member, Role } from '@/features/workspaces/api'
import Select from '@/shared/ui/form/Select'
import { controlClass } from '@/shared/ui/form/Input'
import LoadingState from '@/shared/ui/feedback/LoadingState'

// Member management for a workspace: invite by email (with copyable link),
// move people between roles, and remove members. `canManage` gates the controls.
//
// The role list comes from the instance's catalog, which an admin edits — so
// this renders whatever roles exist rather than a hardcoded Owner/Member pair,
// and "is this an owner" is `m.isOwner` (does their role carry workspace.manage)
// rather than a name comparison. A workspace may have any number of owners but
// never zero, so the last owner's controls are disabled rather than hidden.
export default function MembersPanel({ workspaceId, canManage }: { workspaceId: string; canManage: boolean }) {
  const toast = useToast()
  const [members, setMembers] = useState<Member[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('member')
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
  useEffect(() => {
    listRoles().then(setRoles)
  }, [])

  const roleOptions = roles.map((r) => ({ value: r.slug, label: r.name }))
  const roleName = (slug: string) => roles.find((r) => r.slug === slug)?.name || slug

  const submitInvite = async (e) => {
    e.preventDefault()
    if (!email.trim()) return
    setInviting(true)
    setInviteLink(null)
    try {
      const { inviteLink: link, emailed } = await inviteMember(workspaceId, email.trim(), inviteRole)
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

  // The workspace must keep at least one owner, so the sole owner can neither be
  // removed nor moved to a role that doesn't carry workspace.manage. `isOwner`
  // is the server's answer to that, not a check on the role's name.
  const ownerCount = members.filter((m) => m.isOwner).length
  const isLastOwner = (m: Member) => !!m.isOwner && ownerCount <= 1

  const changeRole = async (m: Member, role: string) => {
    const prev = members
    setMembers((list) => list.map((x) => (x.userId === m.userId ? { ...x, role } : x)))
    try {
      await setMemberRole(workspaceId, m.userId, role)
      toast.success(`${m.name || m.email} is now ${roleName(role)}.`)
      load() // the new role's permissions/isOwner come from the server
    } catch (err) {
      setMembers(prev)
      toast.error(err.message)
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
          <Label>Invite a member by email</Label>
          <div className="flex gap-2">
            <Input
              type="email"
              placeholder="teammate@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Select
              className={`${controlClass} !w-[132px] shrink-0`}
              value={inviteRole}
              options={roleOptions}
              onChange={setInviteRole}
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
              {m.status === 'pending' && <Badge tone="amber" className="shrink-0">pending</Badge>}
              {canManage ? (
                <Select
                  portal // the member list is `overflow-hidden`, which would clip the menu
                  className={`${controlClass} !w-[132px] shrink-0 !py-1`}
                  value={m.role}
                  disabled={isLastOwner(m)}
                  options={roleOptions}
                  onChange={(role) => changeRole(m, role)}
                />
              ) : (
                <Badge tone={m.isOwner ? 'green' : 'neutral'} className="shrink-0">{roleName(m.role)}</Badge>
              )}
              {canManage && !isLastOwner(m) && (
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
