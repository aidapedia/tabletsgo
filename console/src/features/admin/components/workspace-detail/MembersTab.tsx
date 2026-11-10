import { useEffect, useState } from 'react'
import PersonRow from '@/shared/ui/PersonRow'
import { toast } from 'sonner'
import SearchInput from '@/shared/ui/form/SearchInput'
import Segmented from '@/shared/ui/form/Segmented'
import { TrashIcon } from '@/shared/ui/icons'
import DataTable, { type Column } from '@/shared/ui/table/DataTable'
import { RowAction, RowActions } from '@/shared/ui/table/RowActions'
import useDataTable from '@/shared/ui/table/useDataTable'
import useListView from '@/shared/ui/table/useListView'
import ViewToggle from '@/shared/ui/table/ViewToggle'
import { listRoles, type Role } from '@/features/workspaces'
import {
  listUsers,
  listWorkspaceMembersAs,
  removeWorkspaceMemberAs,
  setWorkspaceRoleAs,
  type AdminUser,
  type AdminWorkspaceMember,
} from '../../api'
import { formatDate } from './ui'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import OptionSelect from '@/shared/ui/form/OptionSelect'

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'owners', label: 'Owners' },
  { value: 'active', label: 'Active' },
  { value: 'pending', label: 'Pending' },
  { value: 'blocked', label: 'Blocked' },
]

const SIGN_IN = { password: 'Password', google: 'Google', github: 'GitHub' }

const stateOf = (m: AdminWorkspaceMember) => (m.blocked ? 'blocked' : m.status)

const STATE_TONE = { active: 'default', pending: 'warning', blocked: 'destructive' } as const

/**
 * Who is in the workspace and what they may do. This is the admin's lever over a
 * workspace they can't enter, including rescuing one whose owners have all left:
 * anyone on the instance can be added, so an ownerless workspace is never a dead
 * end. Starts on the owner role then, since that is what the admin came to do.
 */
export default function MembersTab({ workspaceId, ownerless, onChanged }: { workspaceId: string; ownerless: boolean; onChanged: () => void }) {
  const [members, setMembers] = useState<AdminWorkspaceMember[]>([])
  const [users, setUsers] = useState<AdminUser[]>([])
  // The instance's role catalog: an admin may have defined more than the builtins.
  const [roles, setRoles] = useState<Role[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState('')
  const [addRole, setAddRole] = useState(ownerless ? 'owner' : 'member')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')

  const load = () =>
    Promise.all([listWorkspaceMembersAs(workspaceId), listUsers(), listRoles()]).then(([m, u, r]) => {
      setMembers(m)
      setUsers(u)
      setRoles(r)
      setLoading(false)
    })
  useEffect(() => {
    load()
  }, [workspaceId])

  // "Owner" is whoever holds workspace.manage, which the server resolves — a
  // custom role can carry it too, so this never compares a role name.
  const ownerCount = members.filter((m) => m.isOwner).length
  const roleOptions = roles.map((r) => ({ value: r.slug, label: r.name }))
  const isLastOwner = (m: AdminWorkspaceMember) => !!m.isOwner && ownerCount <= 1

  // Instance admins can't join a workspace.
  const memberIds = new Set(members.map((m) => m.userId))
  const candidates = users.filter((u) => u.role !== 'admin' && !memberIds.has(u.id))

  const changed = () => {
    load()
    onChanged()
  }

  const add = async () => {
    if (!adding) return
    const who = candidates.find((u) => u.id === adding)
    try {
      await setWorkspaceRoleAs(workspaceId, adding, addRole)
      setAdding('')
      setAddRole('member')
      changed()
      toast.success(`${who?.name || who?.email || 'They'} joined as ${roles.find((r) => r.slug === addRole)?.name || addRole}.`)
    } catch (err) {
      toast.error(err.message)
    }
  }

  const changeRole = async (m: AdminWorkspaceMember, role: string) => {
    const prev = members
    setMembers((list) => list.map((x) => (x.userId === m.userId ? { ...x, role } : x)))
    try {
      await setWorkspaceRoleAs(workspaceId, m.userId, role)
      changed() // isOwner/permissions for the new role come from the server
    } catch (err) {
      setMembers(prev)
      toast.error(err.message)
    }
  }

  const remove = async (m: AdminWorkspaceMember) => {
    try {
      await removeWorkspaceMemberAs(workspaceId, m.userId)
      changed()
    } catch (err) {
      toast.error(err.message)
    }
  }

  const needle = query.trim().toLowerCase()
  const filtered = members
    .filter((m) => filter === 'all' || (filter === 'owners' ? m.isOwner : stateOf(m) === filter))
    .filter((m) => !needle || `${m.name} ${m.email}`.toLowerCase().includes(needle))

  const columns: Column<AdminWorkspaceMember>[] = [
    {
      key: 'name',
      header: 'Member',
      sortable: true,
      render: (m) => (
        <div className="flex items-center gap-2.5">
          <PersonRow stacked size="md" name={m.name} email={m.email} emailClassName="!text-[11px] !text-muted-foreground" />
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      width: 164,
      render: (m) => (
        <OptionSelect
           // the table scrolls sideways, which would clip the menu
          className="!w-[132px] !py-1"
          value={m.role}
          placeholder="No role"
          disabled={isLastOwner(m)}
          options={roleOptions}
          onChange={(role) => changeRole(m, role)}
        />
      ),
    },
    {
      key: 'state',
      header: 'State',
      width: 100,
      sortValue: stateOf,
      sortable: true,
      render: (m) => <Badge variant={STATE_TONE[stateOf(m)]}>{stateOf(m)}</Badge>,
    },
    {
      key: 'signIn',
      header: 'Sign-in',
      width: 170,
      render: (m) => <span className="whitespace-nowrap text-[12px] text-muted-foreground">{m.signIn?.map((s) => SIGN_IN[s]).join(', ') || '—'}</span>,
    },
    { key: 'groupCount', header: 'Groups', sortable: true, align: 'right', width: 90 },
    {
      key: 'createdAt',
      header: 'Joined',
      sortable: true,
      width: 130,
      render: (m) => <span className="text-[12px] text-muted-foreground">{formatDate(m.createdAt)}</span>,
    },
    {
      key: 'actions',
      header: '',
      width: 60,
      align: 'right',
      render: (m) => (
        <RowActions>
          <RowAction
            icon={TrashIcon}
            label="Remove"
            aria={`Remove ${m.email}`}
            tone="danger"
            disabled={isLastOwner(m)}
            disabledHint="A workspace needs at least one owner. Make someone else an owner first."
            onClick={() => remove(m)}
          />
        </RowActions>
      ),
    },
  ]

  const [view, setView] = useListView('admin-workspace-members')
  const table = useDataTable({ rows: filtered, columns, pageSize: 10, resetKey: `${query}|${filter}`, view })

  return (
    <div className="flex flex-col gap-4">
      {!loading && (
        <div className="rounded-xl border border-border bg-card p-3">
          {candidates.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">
              {users.filter((u) => u.role !== 'admin').length === 0
                ? 'No accounts yet — create one on the Users page first.'
                : 'Everyone on this instance is already in this workspace.'}
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {/* `!w-…` because controlClass leads with `w-full`, and Tailwind
                  resolves width by stylesheet order rather than class order. */}
              <OptionSelect
                className="!w-auto min-w-[240px] flex-1"
                value={adding}
                placeholder="Add someone by name or email"
                searchable
                searchPlaceholder="Name or email…"
                options={candidates.map((u) => ({
                  value: u.id,
                  label: u.name || u.email,
                  hint: u.name ? u.email : undefined,
                  keywords: u.email,
                }))}
                onChange={setAdding}
              />
              <OptionSelect className="!w-[132px] shrink-0" value={addRole} options={roleOptions} onChange={setAddRole} />
              <Button variant="default" className="shrink-0" disabled={!adding} onClick={add}>
                Add member
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput className="min-w-[220px] flex-1" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search members…" />
        <Segmented value={filter} onChange={setFilter} options={FILTERS} />
        <ViewToggle value={view} onChange={setView} />
      </div>

      <DataTable
        columns={columns}
        rowKey={(m) => m.userId}
        loading={loading}
        empty={members.length ? 'No members match that filter.' : 'Nobody is in this workspace yet.'}
        {...table}
      />
    </div>
  )
}
