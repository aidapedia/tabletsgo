import { useEffect, useState } from 'react'
import Button from '@/shared/ui/buttons/Button'
import TextButton from '@/shared/ui/buttons/TextButton'
import Badge from '@/shared/ui/Badge'
import Avatar from '@/shared/ui/Avatar'
import Select from '@/shared/ui/form/Select'
import { Input, controlClass } from '@/shared/ui/form/Input'
import { FormField, Label } from '@/shared/ui/form/Form'
import SearchInput from '@/shared/ui/form/SearchInput'
import EmptyState from '@/shared/ui/feedback/EmptyState'
import TypeToConfirmDialog from '@/shared/ui/feedback/TypeToConfirmDialog'
import { useToast } from '@/shared/ui/feedback/Toast'
import DataTable, { type Column } from '@/shared/ui/table/DataTable'
import { RowAction, RowActions } from '@/shared/ui/table/RowActions'
import useDataTable from '@/shared/ui/table/useDataTable'
import { CopyIcon, PlusIcon, TrashIcon } from '@/shared/ui/icons'
import {
  createWorkspaceAs,
  deleteWorkspaceAs,
  listAllWorkspaces,
  listUsers,
  listWorkspaceMembersAs,
  removeWorkspaceMemberAs,
  renameWorkspaceAs,
  setWorkspaceRoleAs,
  type AdminUser,
  type AdminWorkspace,
  type AdminWorkspaceMember,
} from '../api'

/**
 * Every workspace on the instance, and who owns it.
 *
 * An admin never joins a workspace, so this panel is deliberately about a
 * workspace's *existence and ownership* — not its contents. There's no way in
 * from here to a connection or a database; handing someone ownership is how
 * work gets done inside one.
 *
 * The "new workspace" dialog is controlled (`creating` / `onCreatingChange`) so
 * the page can put its button in the section header, next to the title — where
 * ConnectionsPage puts "New connection".
 */
export default function AdminWorkspacesPanel({
  creating,
  onCreatingChange,
}: {
  creating: boolean
  onCreatingChange: (next: boolean) => void
}) {
  const toast = useToast()
  const [rows, setRows] = useState<AdminWorkspace[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<AdminWorkspace | null>(null)
  const [deleting, setDeleting] = useState<AdminWorkspace | null>(null)

  const load = async () => {
    setLoading(true)
    const list = await listAllWorkspaces()
    setRows(list)
    setSelected((s) => (s ? list.find((w) => w.id === s.id) || null : null))
    setLoading(false)
  }
  useEffect(() => {
    load()
  }, [])

  const filtered = rows.filter((w) => w.name.toLowerCase().includes(query.trim().toLowerCase()))

  const confirmDelete = async () => {
    const w = deleting
    setDeleting(null)
    if (!w) return
    try {
      const { connectionsDeleted } = await deleteWorkspaceAs(w.id)
      toast.success(`Deleted “${w.name}” and ${connectionsDeleted} connection${connectionsDeleted === 1 ? '' : 's'}.`)
      if (selected?.id === w.id) setSelected(null)
      load()
    } catch (err) {
      toast.error(err.message)
    }
  }

  const columns: Column<AdminWorkspace>[] = [
    {
      key: 'name',
      header: 'Workspace',
      sortable: true,
      render: (w) => (
        <div className="flex items-center gap-2.5">
          <Avatar label={w.name} />
          <span className="truncate font-medium text-ink">{w.name}</span>
        </div>
      ),
    },
    {
      key: 'owners',
      header: 'Owners',
      sortable: true,
      sortValue: (w) => w.owners.length,
      // An ownerless workspace is a real state (its owners left, or an admin
      // created it and hasn't assigned one yet) and the one an admin must act on.
      render: (w) =>
        w.owners.length ? (
          <span className="truncate text-ink-dim">{w.owners.map((o) => o.name || o.email).join(', ')}</span>
        ) : (
          <Badge tone="amber">no owner</Badge>
        ),
    },
    { key: 'memberCount', header: 'Members', sortable: true, align: 'right', width: 90 },
    { key: 'connectionCount', header: 'Connections', sortable: true, align: 'right', width: 110 },
    {
      key: 'actions',
      header: '',
      width: 60,
      align: 'right',
      render: (w) => (
        <RowActions>
          <RowAction
            icon={TrashIcon}
            label="Delete"
            aria={`Delete ${w.name}`}
            tone="danger"
            onClick={() => setDeleting(w)}
          />
        </RowActions>
      ),
    },
  ]

  const table = useDataTable({ rows: filtered, columns, pageSize: 10, resetKey: query })

  return (
    <div>
      {/* Search — bare row, same shape as the connections list. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput
          className="min-w-[220px] flex-1"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search workspaces…"
        />
      </div>

      <DataTable
        columns={columns}
        rowKey={(w) => w.id}
        onRowClick={(w) => setSelected(w)}
        loading={loading}
        empty={
          query.trim() ? (
            <EmptyState>No workspaces match that search.</EmptyState>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <span>No workspaces yet — create one and hand it to an owner.</span>
              <Button variant="primary" size="sm" icon={PlusIcon} onClick={() => onCreatingChange(true)}>
                Add new workspace
              </Button>
            </div>
          )
        }
        {...table}
      />

      {creating && (
        <CreateWorkspaceDialog
          onClose={() => onCreatingChange(false)}
          onCreated={() => {
            onCreatingChange(false)
            load()
          }}
        />
      )}

      {selected && <OwnershipDialog workspace={selected} onClose={() => setSelected(null)} onChanged={load} />}

      {deleting && (
        <TypeToConfirmDialog
          title="Delete workspace?"
          message={`This permanently deletes “${deleting.name}”, its ${deleting.connectionCount} connection(s), teams and everything stored against them. Type the workspace name to confirm.`}
          confirmText={deleting.name}
          confirmLabel="Delete workspace"
          onConfirm={confirmDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  )
}

// A workspace needs an owner to be useful, so the owner's email is part of
// creating one rather than a follow-up step. An unknown address gets a pending
// account plus an invite link.
function CreateWorkspaceDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [inviteLink, setInviteLink] = useState<string | null>(null)

  const submit = async (e) => {
    e.preventDefault()
    if (!name.trim() || !ownerEmail.trim()) return
    setSaving(true)
    try {
      const { inviteLink: link, emailed } = await createWorkspaceAs(name.trim(), ownerEmail.trim())
      if (link) {
        setInviteLink(link)
        toast.success(emailed ? 'Workspace created. Invite emailed to the owner.' : 'Workspace created — share the invite link.')
      } else {
        toast.success('Workspace created.')
        onCreated()
      }
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="New workspace" onClose={inviteLink ? onCreated : onClose}>
      {inviteLink ? (
        <div>
          <p className="text-[12px] leading-relaxed text-ink-dim">
            The owner doesn’t have an account yet. Send them this link so they can set a password and take over the
            workspace.
          </p>
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
          <FormField label="Workspace name">
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Production" />
          </FormField>
          <FormField
            label="Owner email"
            hint="They manage the workspace: members, teams and connections. Unknown addresses get an invite."
          >
            <Input type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} placeholder="owner@example.com" />
          </FormField>
          <div className="mt-5 flex justify-end gap-2">
            <Button size="sm" onClick={onClose} type="button">
              Cancel
            </Button>
            <Button variant="primary" size="sm" type="submit" disabled={saving}>
              {saving ? 'Creating…' : 'Create workspace'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}

// Rename, and change who owns it. This is the admin's only lever over a
// workspace they can't enter — including rescuing one whose owners have all left.
function OwnershipDialog({
  workspace,
  onClose,
  onChanged,
}: {
  workspace: AdminWorkspace
  onClose: () => void
  onChanged: () => void
}) {
  const toast = useToast()
  const [members, setMembers] = useState<AdminWorkspaceMember[]>([])
  // Every account on the instance, so someone who isn't in this workspace yet
  // can be pulled into it — without this the dialog is a dead end for a
  // workspace with no members (nothing to promote).
  const [users, setUsers] = useState<AdminUser[]>([])
  const [adding, setAdding] = useState('')
  const [addRole, setAddRole] = useState<AdminWorkspaceMember['role']>('member')
  const [name, setName] = useState(workspace.name)
  const [loading, setLoading] = useState(true)

  const load = () => {
    setLoading(true)
    Promise.all([listWorkspaceMembersAs(workspace.id), listUsers()]).then(([m, u]) => {
      setMembers(m)
      setUsers(u)
      setLoading(false)
    })
  }
  useEffect(load, [workspace.id])

  const ownerCount = members.filter((m) => m.role === 'owner').length

  // Instance admins can't join a workspace, and existing members are already
  // listed below with their own role control.
  const memberIds = new Set(members.map((m) => m.userId))
  const candidates = users.filter((u) => u.role !== 'admin' && !memberIds.has(u.id))

  const add = async () => {
    if (!adding) return
    const who = candidates.find((u) => u.id === adding)
    try {
      await setWorkspaceRoleAs(workspace.id, adding, addRole)
      setAdding('')
      setAddRole('member')
      load()
      onChanged()
      toast.success(`${who?.name || who?.email || 'They'} joined as ${addRole}.`)
    } catch (err) {
      toast.error(err.message)
    }
  }

  const rename = async () => {
    if (!name.trim() || name.trim() === workspace.name) return
    try {
      await renameWorkspaceAs(workspace.id, name.trim())
      toast.success('Workspace renamed.')
      onChanged()
    } catch (err) {
      toast.error(err.message)
      setName(workspace.name)
    }
  }

  const changeRole = async (m: AdminWorkspaceMember, role: AdminWorkspaceMember['role']) => {
    const prev = members
    setMembers((list) => list.map((x) => (x.userId === m.userId ? { ...x, role } : x)))
    try {
      await setWorkspaceRoleAs(workspace.id, m.userId, role)
      onChanged()
    } catch (err) {
      setMembers(prev)
      toast.error(err.message)
    }
  }

  const remove = async (m: AdminWorkspaceMember) => {
    try {
      await removeWorkspaceMemberAs(workspace.id, m.userId)
      load()
      onChanged()
    } catch (err) {
      toast.error(err.message)
    }
  }

  return (
    <Modal title={workspace.name} onClose={onClose}>
      <FormField label="Name">
        <div className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={rename} />
          <Button size="sm" className="shrink-0" onClick={rename} disabled={!name.trim() || name.trim() === workspace.name}>
            Rename
          </Button>
        </div>
      </FormField>

      <Label>Members ({members.length})</Label>
      {loading ? (
        <div className="py-6 text-center text-[12px] text-ink-faint">Loading…</div>
      ) : members.length === 0 ? (
        <div className="rounded-soft border border-dashed border-edge-strong px-3 py-5 text-center text-[12px] text-ink-dim">
          Nobody is in this workspace yet — add someone below and make them its owner.
        </div>
      ) : (
        <div className="flex max-h-[280px] flex-col divide-y divide-edge overflow-y-auto rounded-soft border border-edge">
          {members.map((m) => (
            <div key={m.userId} className="flex items-center gap-2.5 bg-elevated/30 px-3 py-2.5">
              <Avatar label={m.name || m.email} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-medium text-ink">{m.name || m.email}</div>
                <div className="truncate text-[11px] text-ink-faint">{m.email}</div>
              </div>
              {m.status === 'pending' && <Badge tone="amber" className="shrink-0">pending</Badge>}
              <Select
                portal // the member list scrolls (max-h + overflow-y-auto), which would clip the menu
                className={`${controlClass} !w-[104px] shrink-0 !py-1`}
                value={m.role}
                // The workspace must keep at least one owner.
                disabled={m.role === 'owner' && ownerCount <= 1}
                options={[
                  { value: 'owner', label: 'Owner' },
                  { value: 'member', label: 'Member' },
                ]}
                onChange={(role) => changeRole(m, role as AdminWorkspaceMember['role'])}
              />
              <TextButton
                tone="faint"
                className="shrink-0 hover:!text-red"
                aria-label={`Remove ${m.email}`}
                onClick={() => remove(m)}
              >
                <TrashIcon width={15} height={15} />
              </TextButton>
            </div>
          ))}
        </div>
      )}

      {/* Add anyone on the instance: pick the person, pick the role, Add. This is
          what makes an ownerless workspace recoverable — promoting needs someone
          to promote. Once added they appear in the list above, where the same
          role control edits it and the trash button removes them. */}
      {!loading && (
        <div className="mt-3">
          {candidates.length === 0 ? (
            <p className="text-[11px] text-ink-faint">
              {users.filter((u) => u.role !== 'admin').length === 0
                ? 'No accounts yet — create one on the Users tab first.'
                : 'Everyone on this instance is already in this workspace.'}
            </p>
          ) : (
            <div className="flex items-center gap-2">
              {/* `!w-…` because controlClass leads with `w-full` and Tailwind resolves
                  width by stylesheet order, not class order — same reason the schema
                  designer's selects use `!w-auto`. */}
              <Select
                className={`${controlClass} !w-auto min-w-0 flex-1`}
                value={adding}
                placeholder="Add someone…"
                options={candidates.map((u) => ({ value: u.id, label: u.name ? `${u.name} · ${u.email}` : u.email }))}
                onChange={setAdding}
              />
              <Select
                className={`${controlClass} !w-[104px] shrink-0`}
                value={addRole}
                options={[
                  { value: 'member', label: 'Member' },
                  { value: 'owner', label: 'Owner' },
                ]}
                onChange={(r) => setAddRole(r as AdminWorkspaceMember['role'])}
              />
              <Button variant="primary" size="sm" className="shrink-0" disabled={!adding} onClick={add}>
                Add
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="mt-5 flex justify-end">
        <Button size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  )
}

// Local modal shell — the admin dialogs are plain forms, not slide-overs.
function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[60] flex animate-fade items-center justify-center bg-black/60 p-6 backdrop-blur-[3px]"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-[460px] animate-pop rounded-[16px] border border-edge-strong bg-panel p-5"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 text-sm font-bold text-ink">{title}</h3>
        {children}
      </div>
    </div>
  )
}
