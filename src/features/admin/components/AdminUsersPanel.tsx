import { useEffect, useState } from 'react'
import Button from '@/shared/ui/buttons/Button'
import TextButton from '@/shared/ui/buttons/TextButton'
import Badge from '@/shared/ui/Badge'
import Avatar from '@/shared/ui/Avatar'
import PersonRow from '@/shared/ui/PersonRow'
import Select from '@/shared/ui/form/Select'
import { Input, controlClass } from '@/shared/ui/form/Input'
import PasswordInput from '@/shared/ui/form/PasswordInput'
import { FormField, Label } from '@/shared/ui/form/Form'
import SearchInput from '@/shared/ui/form/SearchInput'
import Tooltip from '@/shared/ui/overlay/Tooltip'
import EmptyState from '@/shared/ui/feedback/EmptyState'
import ConfirmDialog from '@/shared/ui/feedback/ConfirmDialog'
import { useToast } from '@/shared/ui/feedback/Toast'
import Modal from '@/shared/ui/overlay/Modal'
import DataTable, { type Column } from '@/shared/ui/table/DataTable'
import { RowAction, RowActions } from '@/shared/ui/table/RowActions'
import useDataTable from '@/shared/ui/table/useDataTable'
import { CopyIcon, KeyIcon, PlusIcon, TrashIcon, UnlockIcon } from '@/shared/ui/icons'
import { useAuth } from '@/features/auth'
import { createUser, deleteUser, listUsers, unblockUser, updateUser, type AdminUser, type SystemRole } from '../api'

/**
 * Every account on the instance.
 *
 * The role control here switches the *system* role, which is a bigger move than
 * it looks: promoting someone to admin removes them from every workspace they
 * belonged to, because an instance admin holds no workspace access. What that
 * costs is the account's workspace list — too tall for a table row, so the list
 * lives in the row's detail dialog (and in the confirmation, which names the
 * workspaces being given up).
 */
// Why the account can't sign in, on the badge. A block with an expiry lifts
// itself (that's what an instance admin gets, so the instance can't be locked
// out); the ordinary one waits for an admin.
const blockedHint = (u: AdminUser) =>
  u.blockedUntil
    ? `Too many failed sign-in attempts (${u.failedAttempts}). Signing in is blocked until ${new Date(u.blockedUntil).toLocaleString()}.`
    : `Blocked after ${u.failedAttempts} failed sign-in attempts. Unblock or set a new password to let them back in.`

/**
 * The "new user" dialog is controlled (`creating` / `onCreatingChange`) so the
 * page can put its button in the section header, next to the title — where
 * ConnectionsPage puts "New connection".
 */
export default function AdminUsersPanel({
  creating,
  onCreatingChange,
}: {
  creating: boolean
  onCreatingChange: (next: boolean) => void
}) {
  const toast = useToast()
  const { user: me } = useAuth()
  const [rows, setRows] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [promoting, setPromoting] = useState<{
    user: AdminUser
    role: SystemRole
  } | null>(null)
  const [viewing, setViewing] = useState<AdminUser | null>(null)
  const [resetting, setResetting] = useState<AdminUser | null>(null)
  const [unblocking, setUnblocking] = useState<AdminUser | null>(null)
  const [deleting, setDeleting] = useState<AdminUser | null>(null)

  const load = async () => {
    setLoading(true)
    const list = await listUsers()
    setRows(list)
    // Keep an open detail dialog on the fresh row — a role change rewrites the
    // very list it shows — and close it if the account is gone.
    setViewing((v) => (v ? list.find((u) => u.id === v.id) || null : null))
    setLoading(false)
  }
  useEffect(() => {
    load()
  }, [])

  const q = query.trim().toLowerCase()
  const filtered = rows.filter((u) => u.email.toLowerCase().includes(q) || (u.name || '').toLowerCase().includes(q))
  const adminCount = rows.filter((u) => u.role === 'admin').length

  const applyRole = async () => {
    const change = promoting
    setPromoting(null)
    if (!change) return
    try {
      await updateUser(change.user.id, { role: change.role })
      toast.success(
        change.role === 'admin'
          ? `${change.user.name || change.user.email} now administers the instance.`
          : `${change.user.name || change.user.email} is now a regular account.`,
      )
      load()
    } catch (err) {
      toast.error(err.message)
    }
  }

  const confirmUnblock = async () => {
    const u = unblocking
    setUnblocking(null)
    if (!u) return
    try {
      await unblockUser(u.id)
      toast.success(`${u.name || u.email} can sign in again.`)
      load()
    } catch (err) {
      toast.error(err.message)
    }
  }

  const confirmDelete = async () => {
    const u = deleting
    setDeleting(null)
    if (!u) return
    try {
      await deleteUser(u.id)
      toast.success('Account deleted.')
      load()
    } catch (err) {
      toast.error(err.message)
    }
  }

  const columns: Column<AdminUser>[] = [
    {
      key: 'name',
      header: 'User',
      sortable: true,
      render: (u) => (
        <div className="flex items-center gap-2">
          <PersonRow stacked name={u.name} email={u.email} />
        </div>
      ),
    },
    // Why the account can and can't sign in, in one place: the brute-force block
    // outranks the invite lifecycle, since a pending account that's also blocked
    // is blocked first. An instance admin only ever gets a cooldown that lifts
    // itself, hence the different word.
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      sortValue: (u) => (u.blocked ? 0 : u.status === 'pending' ? 1 : 2),
      width: 110,
      render: (u) =>
        u.blocked ? (
          <Tooltip label={blockedHint(u)} multiline>
            <Badge tone="red">{u.blockedUntil ? 'cooling down' : 'blocked'}</Badge>
          </Tooltip>
        ) : u.status === 'pending' ? (
          <Tooltip label="Invited, but hasn't set a password yet." multiline>
            <Badge tone="amber">pending</Badge>
          </Tooltip>
        ) : (
          <Tooltip label="Signed up and able to sign in.">
            <Badge tone="green">active</Badge>
          </Tooltip>
        ),
    },
    {
      key: 'role',
      header: 'System role',
      sortable: true,
      width: 130,
      // The select swallows its own clicks so picking a role doesn't also open
      // the row's detail dialog.
      render: (u) => (
        <div onClick={(e) => e.stopPropagation()}>
          <Select
            // Portaled: DataTable's body is `overflow-x-auto`, which clips an
            // in-flow menu (and the last rows' menus would be cut off entirely).
            portal
            className={`${controlClass} !w-[112px] !py-1`}
            value={u.role}
            // Never leave the instance without an admin, and never let someone
            // demote themselves out of this page.
            disabled={u.id === me?.id || (u.role === 'admin' && adminCount <= 1)}
            options={[
              { value: 'admin', label: 'Admin' },
              { value: 'user', label: 'User' },
            ]}
            onChange={(role) => role !== u.role && setPromoting({ user: u, role: role as SystemRole })}
          />
        </div>
      ),
    },
    // Every row offers the same three buttons in the same order — an action that
    // doesn't apply is disabled (with the reason on its tooltip) rather than
    // dropped, so the column doesn't reshuffle from row to row.
    {
      key: 'actions',
      header: '',
      width: 150,
      align: 'right',
      render: (u) => (
        <RowActions>
          <RowAction
            icon={UnlockIcon}
            label="Unblock"
            aria={`Unblock ${u.email}`}
            disabledHint="Not blocked"
            tone="positive"
            disabled={!u.blocked}
            onClick={() => setUnblocking(u)}
          />
          <RowAction
            icon={KeyIcon}
            label="Change password"
            aria={`Change the password for ${u.email}`}
            onClick={() => setResetting(u)}
          />
          <RowAction
            icon={TrashIcon}
            label="Delete"
            aria={`Delete ${u.email}`}
            disabledHint="This is your own account"
            tone="danger"
            disabled={u.id === me?.id}
            onClick={() => setDeleting(u)}
          />
        </RowActions>
      ),
    },
  ]

  const table = useDataTable({
    rows: filtered,
    columns,
    pageSize: 10,
    resetKey: query,
  })

  return (
    <div>
      {/* Search — bare row, same shape as the connections list. */}
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
        rowKey={(u) => u.id}
        onRowClick={(u) => setViewing(u)}
        loading={loading}
        empty={
          q ? (
            <EmptyState>No accounts match that search.</EmptyState>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <span>No accounts yet.</span>
              <Button variant="primary" size="sm" icon={PlusIcon} onClick={() => onCreatingChange(true)}>
                Add new user
              </Button>
            </div>
          )
        }
        {...table}
      />

      {creating && (
        <CreateUserDialog
          onClose={() => onCreatingChange(false)}
          onCreated={() => {
            onCreatingChange(false)
            load()
          }}
        />
      )}

      {viewing && <UserDetailDialog user={viewing} onClose={() => setViewing(null)} />}

      {resetting && (
        <SetPasswordDialog
          user={resetting}
          onClose={() => setResetting(null)}
          onSaved={() => {
            setResetting(null)
            load()
          }}
        />
      )}

      {promoting && (
        <ConfirmDialog
          title={promoting.role === 'admin' ? 'Make an instance admin?' : 'Make a regular account?'}
          message={
            promoting.role === 'admin'
              ? `${promoting.user.name || promoting.user.email} will manage workspaces and accounts — and will be removed from ${
                  promoting.user.workspaces.length
                    ? `${promoting.user.workspaces.map((w) => w.name).join(', ')}, losing access to every connection there`
                    : 'any workspace they join'
                }. Instance admins never hold workspace access. They'll be signed out.`
              : `${promoting.user.name || promoting.user.email} will lose access to this admin area. They belong to no workspace until someone adds them. They'll be signed out.`
          }
          confirmLabel={promoting.role === 'admin' ? 'Make admin' : 'Make regular'}
          danger={promoting.role === 'admin'}
          onConfirm={applyRole}
          onCancel={() => setPromoting(null)}
        />
      )}

      {unblocking && (
        <ConfirmDialog
          title="Unblock this account?"
          message={`${unblocking.name || unblocking.email} was blocked after ${unblocking.failedAttempts} failed sign-in attempts${
            unblocking.blockedAt ? ` on ${new Date(unblocking.blockedAt).toLocaleString()}` : ''
          }. Unblocking clears the counter and lets them sign in with their existing password — if you're not sure it was them, set a new password instead.`}
          confirmLabel="Unblock"
          onConfirm={confirmUnblock}
          onCancel={() => setUnblocking(null)}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete account?"
          message={`Permanently delete ${deleting.name || deleting.email}. They'll be removed from every workspace and signed out.`}
          confirmLabel="Delete"
          danger
          onConfirm={confirmDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  )
}

/**
 * One account, opened from its row.
 *
 * This is where the workspace list lives: it's a per-account list of arbitrary
 * length, which made the table row grow with it, and it's the thing an admin
 * looks up about one person rather than scans down a column. Read-only on
 * purpose — a membership is changed from the workspace it belongs to
 * (Administration → Workspaces), so there's one place that owns that edit.
 */
function UserDetailDialog({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  return (
    <Modal title="User detail" onClose={onClose}>
      <div className="flex items-center gap-2.5">
        <PersonRow stacked size="md" name={user.name} email={user.email} />
      </div>

      <div className="mt-4 flex flex-col gap-2.5 rounded-soft border border-edge bg-elevated/30 px-3 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-ink-faint">System role</span>
          <Badge tone={user.role === 'admin' ? 'green' : 'neutral'}>{user.role}</Badge>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-ink-faint">Status</span>
          {user.blocked ? (
            <Badge tone="red">{user.blockedUntil ? 'cooling down' : 'blocked'}</Badge>
          ) : user.status === 'pending' ? (
            <Badge tone="amber">pending</Badge>
          ) : (
            <Badge tone="green">active</Badge>
          )}
        </div>
        {/* The block is the one thing that needs the story, not just the badge. */}
        {user.blocked && <p className="text-[11px] leading-relaxed text-ink-dim">{blockedHint(user)}</p>}
      </div>

      {/* One workspace per line, its role badged beside the name it applies to.
          An instance admin belongs to none by design — that's not an empty list,
          it's not applicable, so it gets a sentence rather than "none". */}
      <div className="mt-4">
        <Label>Workspaces {user.role === 'admin' ? '' : `(${user.workspaces.length})`}</Label>
        {user.role === 'admin' ? (
          <p className="text-[11px] leading-relaxed text-ink-faint">
            Instance admins hold no workspace membership — they manage workspaces and accounts without access to the
            data inside them.
          </p>
        ) : user.workspaces.length === 0 ? (
          <p className="text-[11px] text-ink-faint">In no workspace yet — a workspace owner adds them.</p>
        ) : (
          <div className="flex max-h-[240px] flex-col divide-y divide-edge overflow-y-auto rounded-soft border border-edge">
            {user.workspaces.map((w) => (
              <div key={w.id} className="flex items-center gap-2.5 bg-elevated/30 px-3 py-2.5">
                <Avatar label={w.name} />
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{w.name}</span>
                <Badge tone={w.isOwner ? 'green' : 'neutral'} className="shrink-0">
                  {w.roleName || w.role}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-5 flex justify-end">
        <Button size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  )
}

// Create an account either way round: set a password now, or leave it blank and
// send the invite link the server hands back.
function CreateUserDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const toast = useToast()
  const [form, setForm] = useState({
    email: '',
    name: '',
    password: '',
    role: 'user' as SystemRole,
  })
  const [saving, setSaving] = useState(false)
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async (e) => {
    e.preventDefault()
    if (!form.email.trim()) return
    setSaving(true)
    try {
      const { inviteLink: link } = await createUser({
        email: form.email.trim(),
        name: form.name.trim() || undefined,
        password: form.password || undefined,
        role: form.role,
      })
      if (link) {
        setInviteLink(link)
        toast.success('Account created — share the invite link so they can set a password.')
      } else {
        toast.success('Account created.')
        onCreated()
      }
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="New user" onClose={inviteLink ? onCreated : onClose}>
      {inviteLink ? (
        <div>
          <p className="text-[12px] leading-relaxed text-ink-dim">Send this link so they can set their password.</p>
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
            <Button variant="primary" size="sm" onClick={onCreated}>
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
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
              placeholder="person@example.com"
            />
          </FormField>
          <FormField label="Name">
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Optional" />
          </FormField>
          <FormField label="Password" hint="Leave blank to send an invite link instead.">
            <PasswordInput
              value={form.password}
              onChange={(e) => set('password', e.target.value)}
              autoComplete="new-password"
            />
          </FormField>
          <FormField
            label="System role"
            hint={
              form.role === 'admin'
                ? 'Manages workspaces and accounts. Holds no workspace access, so they cannot open a database.'
                : 'A regular account. What they can do is set per workspace by its owner.'
            }
          >
            <Select
              className={controlClass}
              value={form.role}
              options={[
                { value: 'user', label: 'User' },
                { value: 'admin', label: 'Admin' },
              ]}
              onChange={(role) => set('role', role)}
            />
          </FormField>
          <div className="mt-5 flex justify-end gap-2">
            <Button size="sm" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" type="submit" disabled={saving}>
              {saving ? 'Creating…' : 'Create user'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}

function SetPasswordDialog({ user, onClose, onSaved }: { user: AdminUser; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (!password) return
    setSaving(true)
    try {
      await updateUser(user.id, { password })
      toast.success('Password set. They have been signed out everywhere.')
      onSaved()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={`Set a password for ${user.name || user.email}`} onClose={onClose}>
      <form onSubmit={submit}>
        <FormField label="New password" hint="Their open sessions are signed out.">
          <PasswordInput
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </FormField>
        <div className="mt-5 flex justify-end gap-2">
          <Button size="sm" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" type="submit" disabled={saving || !password}>
            {saving ? 'Saving…' : 'Set password'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

