import { useEffect, useState } from 'react'
import Button from '@/shared/ui/buttons/Button'
import TextButton from '@/shared/ui/buttons/TextButton'
import Badge from '@/shared/ui/Badge'
import PersonRow from '@/shared/ui/PersonRow'
import Select from '@/shared/ui/form/Select'
import { Input, controlClass } from '@/shared/ui/form/Input'
import PasswordInput from '@/shared/ui/form/PasswordInput'
import { FormField } from '@/shared/ui/form/Form'
import SearchInput from '@/shared/ui/form/SearchInput'
import EmptyState from '@/shared/ui/feedback/EmptyState'
import ConfirmDialog from '@/shared/ui/feedback/ConfirmDialog'
import { useToast } from '@/shared/ui/feedback/Toast'
import DataTable, { type Column } from '@/shared/ui/table/DataTable'
import useDataTable from '@/shared/ui/table/useDataTable'
import { CopyIcon, KeyIcon, PlusIcon, TrashIcon } from '@/shared/ui/icons'
import { useAuth } from '@/features/auth'
import { createUser, deleteUser, listUsers, updateUser, type AdminUser, type SystemRole } from '../api'

/**
 * Every account on the instance.
 *
 * The role control here switches the *system* role, which is a bigger move than
 * it looks: promoting someone to admin removes them from every workspace they
 * belonged to, because an instance admin holds no workspace access. The
 * "Workspaces" column is what that costs, so it's shown right next to the
 * control and the change is confirmed.
 */
export default function AdminUsersPanel() {
  const toast = useToast()
  const { user: me } = useAuth()
  const [rows, setRows] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [promoting, setPromoting] = useState<{
    user: AdminUser
    role: SystemRole
  } | null>(null)
  const [resetting, setResetting] = useState<AdminUser | null>(null)
  const [deleting, setDeleting] = useState<AdminUser | null>(null)

  const load = async () => {
    setLoading(true)
    setRows(await listUsers())
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
          <PersonRow name={u.name || u.email} email={u.email} />
          {u.status === 'pending' && (
            <Badge tone="amber" className="shrink-0">
              pending
            </Badge>
          )}
        </div>
      ),
    },
    // Workspaces and the role held in each are two columns, stacked one entry
    // per line so the badge on the right lines up with the name on the left.
    // (An instance admin belongs to none, hence the em dash rather than "none" —
    // it isn't an empty list, it's not applicable.)
    {
      key: 'workspaces',
      header: 'Workspaces',
      sortable: true,
      sortValue: (u) => u.workspaces.length,
      className: 'max-[900px]:hidden',
      render: (u) =>
        u.role === 'admin' ? (
          <span className="text-ink-faint">—</span>
        ) : u.workspaces.length ? (
          <div className="flex flex-col gap-1">
            {u.workspaces.map((w) => (
              <span key={w.id} className="truncate text-ink-dim">
                {w.name}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-ink-faint">none</span>
        ),
    },
    {
      key: 'workspaceRole',
      header: 'Workspace role',
      sortable: true,
      // Owners first, then plain members, then accounts in no workspace at all.
      sortValue: (u) => (u.role === 'admin' ? 3 : u.workspaces.some((w) => w.role === 'owner') ? 0 : u.workspaces.length ? 1 : 2),
      width: 130,
      className: 'max-[900px]:hidden',
      render: (u) =>
        u.role === 'admin' || !u.workspaces.length ? (
          <span className="text-ink-faint">—</span>
        ) : (
          <div className="flex flex-col items-start gap-1">
            {u.workspaces.map((w) => (
              <Badge key={w.id} tone={w.role === 'owner' ? 'green' : 'neutral'}>
                {w.role}
              </Badge>
            ))}
          </div>
        ),
    },
    {
      key: 'role',
      header: 'System role',
      sortable: true,
      width: 130,
      render: (u) => (
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
      ),
    },
    {
      key: 'actions',
      header: '',
      width: 70,
      align: 'right',
      render: (u) => (
        <div className="flex items-center justify-end gap-1">
          <TextButton tone="faint" aria-label={`Set a password for ${u.email}`} onClick={() => setResetting(u)}>
            <KeyIcon width={15} height={15} />
          </TextButton>
          {u.id !== me?.id && (
            <TextButton tone="faint" className="hover:!text-red" aria-label={`Delete ${u.email}`} onClick={() => setDeleting(u)}>
              <TrashIcon width={15} height={15} />
            </TextButton>
          )}
        </div>
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
      <div className="mb-4 flex items-center gap-2">
        <SearchInput
          className="flex-1"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or email…"
        />
        <Button variant="primary" size="sm" className="shrink-0" onClick={() => setCreating(true)}>
          <PlusIcon width={14} height={14} /> New user
        </Button>
      </div>

      <DataTable
        columns={columns}
        rowKey={(u) => u.id}
        loading={loading}
        empty={<EmptyState>No accounts match that search.</EmptyState>}
        {...table}
      />

      {creating && (
        <CreateUserDialog
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            load()
          }}
        />
      )}

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
          <FormField label="Name" className="mt-3">
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Optional" />
          </FormField>
          <FormField label="Password" hint="Leave blank to send an invite link instead." className="mt-3">
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
            className="mt-3"
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

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[60] flex animate-fade items-center justify-center bg-black/60 p-6 backdrop-blur-[3px]"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-[440px] animate-pop rounded-[16px] border border-edge-strong bg-panel p-5"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 text-sm font-bold text-ink">{title}</h3>
        {children}
      </div>
    </div>
  )
}
