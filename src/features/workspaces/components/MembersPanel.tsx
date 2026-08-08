import { useEffect, useState } from 'react'
import Button from '@/shared/ui/buttons/Button'
import TextButton from '@/shared/ui/buttons/TextButton'
import Badge from '@/shared/ui/Badge'
import PersonRow from '@/shared/ui/PersonRow'
import Select from '@/shared/ui/form/Select'
import { Input, controlClass } from '@/shared/ui/form/Input'
import { FormField } from '@/shared/ui/form/Form'
import SearchInput from '@/shared/ui/form/SearchInput'
import Modal from '@/shared/ui/overlay/Modal'
import Tooltip from '@/shared/ui/overlay/Tooltip'
import EmptyState from '@/shared/ui/feedback/EmptyState'
import ConfirmDialog from '@/shared/ui/feedback/ConfirmDialog'
import { useToast } from '@/shared/ui/feedback/Toast'
import DataTable, { type Column } from '@/shared/ui/table/DataTable'
import { RowAction, RowActions } from '@/shared/ui/table/RowActions'
import useDataTable from '@/shared/ui/table/useDataTable'
import { CopyIcon, TrashIcon } from '@/shared/ui/icons'
import { listMembers, inviteMember, listRoles, removeMember, setMemberRole, Member, Role } from '@/features/workspaces/api'

/**
 * Member management for a workspace: invite by email (with copyable link), move
 * people between roles, and remove members. `canManage` gates the controls —
 * without it the table is a read-only roster.
 *
 * The role list comes from the instance's catalog, which an admin edits — so
 * this renders whatever roles exist rather than a hardcoded Owner/Member pair,
 * and "is this an owner" is `m.isOwner` (does their role carry workspace.manage)
 * rather than a name comparison. A workspace may have any number of owners but
 * never zero, so the last owner's controls are disabled rather than hidden.
 *
 * The invite dialog is controlled (`inviting` / `onInvitingChange`) so the page
 * can put its button in the section header, next to the title — where
 * AdminUsersPanel and ConnectionsPage put theirs.
 */
export default function MembersPanel({
  workspaceId,
  canManage,
  inviting,
  onInvitingChange,
}: {
  workspaceId: string
  canManage: boolean
  inviting: boolean
  onInvitingChange: (next: boolean) => void
}) {
  const toast = useToast()
  const [members, setMembers] = useState<Member[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
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

  const q = query.trim().toLowerCase()
  const filtered = members.filter(
    (m) => m.email.toLowerCase().includes(q) || (m.name || '').toLowerCase().includes(q),
  )

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

  const columns: Column<Member>[] = [
    {
      key: 'name',
      header: 'Member',
      sortable: true,
      sortValue: (m) => m.name || m.email,
      render: (m) => (
        <div className="flex items-center gap-2">
          <PersonRow stacked name={m.name} email={m.email} />
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      sortValue: (m) => (m.status === 'pending' ? 0 : 1),
      width: 110,
      render: (m) =>
        m.status === 'pending' ? (
          <Tooltip label="Invited, but hasn't accepted yet." multiline>
            <Badge tone="amber">pending</Badge>
          </Tooltip>
        ) : (
          <Tooltip label="Accepted the invite and able to sign in.">
            <Badge tone="green">active</Badge>
          </Tooltip>
        ),
    },
    {
      key: 'role',
      header: 'Role',
      sortable: true,
      sortValue: (m) => roleName(m.role),
      width: 150,
      render: (m) =>
        canManage ? (
          <Tooltip label={isLastOwner(m) ? 'The last owner cannot be moved out of the owner role.' : ''}>
            <Select
              // Portaled: DataTable's body is `overflow-x-auto`, which clips an
              // in-flow menu (and the last rows' menus would be cut off entirely).
              portal
              className={`${controlClass} !w-[132px] !py-1`}
              value={m.role}
              disabled={isLastOwner(m)}
              options={roleOptions}
              onChange={(role) => role !== m.role && changeRole(m, role)}
            />
          </Tooltip>
        ) : (
          <Badge tone={m.isOwner ? 'green' : 'neutral'}>{roleName(m.role)}</Badge>
        ),
    },
    // Only rendered when the caller can manage — a read-only roster has no
    // actions column at all rather than a column of dead buttons.
    ...(canManage
      ? [
          {
            key: 'actions',
            header: '',
            width: 70,
            align: 'right' as const,
            render: (m: Member) => (
              <RowActions>
                <RowAction
                  icon={TrashIcon}
                  label="Remove"
                  aria={`Remove ${m.email}`}
                  disabledHint="A workspace never loses its last owner"
                  tone="danger"
                  disabled={isLastOwner(m)}
                  onClick={() => setRemoving(m)}
                />
              </RowActions>
            ),
          },
        ]
      : []),
  ]

  const table = useDataTable({ rows: filtered, columns, pageSize: 10, resetKey: query })

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput
          className="min-w-[220px] flex-1"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or email…"
        />
      </div>

      <DataTable
        columns={columns}
        rowKey={(m) => m.userId}
        loading={loading}
        empty={q ? <EmptyState>No members match that search.</EmptyState> : 'No members yet.'}
        {...table}
      />

      {inviting && (
        <InviteDialog
          workspaceId={workspaceId}
          roleOptions={roleOptions}
          onClose={() => onInvitingChange(false)}
          onInvited={load}
        />
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

/**
 * Invite by email straight into a role.
 *
 * The dialog stays open on the link the server hands back: with no mail server
 * configured that link is the only copy of the invite, so closing on success
 * would lose it.
 */
function InviteDialog({
  workspaceId,
  roleOptions,
  onClose,
  onInvited,
}: {
  workspaceId: string
  roleOptions: { value: string; label: string }[]
  onClose: () => void
  onInvited: () => void
}) {
  const toast = useToast()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('member')
  const [saving, setSaving] = useState(false)
  const [inviteLink, setInviteLink] = useState<string | null>(null)

  const submit = async (e) => {
    e.preventDefault()
    if (!email.trim()) return
    setSaving(true)
    setInviteLink(null)
    try {
      const { inviteLink: link, emailed } = await inviteMember(workspaceId, email.trim(), role)
      setEmail('')
      onInvited()
      if (link) {
        setInviteLink(link)
        toast.success(emailed ? 'Invite emailed. Link also copied below.' : 'Invite created — share the link below.')
      } else {
        toast.success('Member added.')
        onClose()
      }
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="Invite a member" onClose={onClose}>
      {inviteLink ? (
        <div>
          <p className="text-[12px] leading-relaxed text-ink-dim">Send this link so they can join the workspace.</p>
          <div className="mt-3 flex items-center gap-2 rounded-soft border border-edge bg-elevated px-2.5 py-2">
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-dim">{inviteLink}</span>
            <TextButton
              className="shrink-0"
              aria-label="Copy invite link"
              onClick={() => {
                navigator.clipboard?.writeText(inviteLink)
                toast.success('Invite link copied.')
              }}
            >
              <CopyIcon width={15} height={15} />
            </TextButton>
          </div>
          <div className="mt-5 flex justify-end">
            <Button variant="primary" size="sm" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit}>
          <FormField label="Email">
            <Input
              autoFocus
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@example.com"
            />
          </FormField>
          <FormField label="Role" hint="What they may do here. Change it any time from the members table.">
            <Select className={controlClass} value={role} options={roleOptions} onChange={setRole} />
          </FormField>
          <div className="mt-5 flex justify-end gap-2">
            <Button size="sm" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" type="submit" disabled={saving || !email.trim()}>
              {saving ? 'Inviting…' : 'Send invite'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}
