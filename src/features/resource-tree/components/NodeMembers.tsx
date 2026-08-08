import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/features/auth'
import { listMembers, type Member } from '@/features/workspaces/api'
import { safeRequest } from '@/shared/api/request'
import Badge from '@/shared/ui/Badge'
import Button from '@/shared/ui/buttons/Button'
import IconButton from '@/shared/ui/buttons/IconButton'
import Select from '@/shared/ui/form/Select'
import { controlClass } from '@/shared/ui/form/Input'
import ConfirmDialog from '@/shared/ui/feedback/ConfirmDialog'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import { useToast } from '@/shared/ui/feedback/Toast'
import PersonRow from '@/shared/ui/PersonRow'
import DataTable, { type Column } from '@/shared/ui/table/DataTable'
import { RowAction, RowActions } from '@/shared/ui/table/RowActions'
import useDataTable from '@/shared/ui/table/useDataTable'
import { PlusIcon, TrashIcon } from '@/shared/ui/icons'
import { addNodeMember, removeGrant, removeNodeMember } from '../api'
import type { RosterRole } from '../lib/access'
import type { NodeMember, ResourceNode } from '../types'

/**
 * Who is inside this group — the first block of `NodePeople`, and the only one
 * that writes to `node_members`.
 *
 * It sits under the same heading as the grant list now, but it is still a
 * different table gated on a different permission (`teams.manage`, not
 * `resources.organise`), because the two do different things: a grant says what
 * its holder may do *at this node*, while the roster decides who every grant
 * made *to* this group reaches — often somewhere else entirely, where none of it
 * shows on that node's grant list.
 *
 * The roster also answers a question no grant does: being on it is what lets
 * someone open the connections filed under this group, without a row on each
 * connection's access list. That is the point of filing a resource into a group
 * — so this list is a door, and adding to it is admitting someone.
 *
 * What the block gained in the merge is the answer to "and what do they get for
 * being here?", which used to be a separate, unreadable row in the list above:
 * `rosterRole` is the group's grant to itself, and it heads the list because it
 * applies to everyone on it equally.
 *
 * Membership is flat by design: a group holds people, never other groups, so
 * nesting a group under another organises resources and says nothing about who
 * belongs to it. Re-filing a folder must never hand anyone access.
 *
 * A workspace node uses this too — it is a group like any other, and its roster
 * *is* its membership (one roster table since meta migration v16). There the
 * governing permission is `members.manage` rather than `teams.manage`, which the
 * server decides; being on it is what makes the workspace's resources visible,
 * and each member's role is their own grant rather than the shared one.
 */
export default function NodeMembers({
  node,
  heading: Heading = 'h4',
  members,
  rosterRole,
  detail,
  canManage,
  canGrant,
  onChanged,
}: {
  node: ResourceNode
  /** `h3` when this block is the whole People section, `h4` under its header. */
  heading?: 'h3' | 'h4'
  members: NodeMember[]
  /** The group's grant to its own roster: what everyone here holds. */
  rosterRole: RosterRole | null
  /**
   * Per person: the role they hold here, whether they can open anything, and —
   * only when this block absorbed their own grant on this node — the grant to
   * revoke. `grantId` and the roster's own remove are never both set, so a row
   * never offers two deletions that mean different things.
   */
  detail: Map<string, { roleName: string | null; noData: boolean; grantId?: string }>
  canManage: boolean
  /** `resources.grant` — governs the role on a row, not the seat. */
  canGrant: boolean
  onChanged: () => void
}) {
  const toast = useToast()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [adding, setAdding] = useState(false)
  const [candidates, setCandidates] = useState<Member[] | null>(null)
  const [picked, setPicked] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirm, setConfirm] = useState<NodeMember | null>(null)
  const [confirmRole, setConfirmRole] = useState<{ member: NodeMember; grantId: string; roleName: string | null } | null>(null)
  // A workspace's roster *is* its membership: these people are the workspace, and
  // being on it is what makes every resource inside it visible to them.
  const isWorkspace = node.type === 'workspace'
  // Joining a workspace is an invitation, not a roster edit — it needs an email,
  // an invite token and the last-owner rule. That flow already exists on the
  // workspace's Members page, so this block shows the membership and sends you
  // there rather than half-reimplementing it. (The API still accepts roster
  // writes on a workspace node; it enforces the same rules.)
  const canEdit = canManage && !isWorkspace

  // An instance admin holds no membership, so the member-scoped route 403s for
  // them — they read the workspace's people through the admin route instead.
  useEffect(() => {
    if (!adding || !node.workspaceId) return
    const wsId = node.workspaceId
    let alive = true
    const load = isAdmin
      ? safeRequest<Member[]>(`/admin/workspaces/${wsId}/members`, [])
      : listMembers(wsId).catch(() => [] as Member[])
    load.then((m) => alive && setCandidates(m))
    return () => {
      alive = false
    }
  }, [adding, node.workspaceId, isAdmin])

  // Only people who aren't in it yet — the server ignores a duplicate, but
  // offering one is a dead option.
  const options = useMemo(() => {
    const already = new Set(members.map((m) => m.userId))
    return (candidates || [])
      .filter((c) => !already.has(c.userId))
      .map((c) => ({ value: c.userId, label: c.name || c.email }))
  }, [candidates, members])

  const submit = async () => {
    if (!picked) return
    setSaving(true)
    try {
      await addNodeMember(node.id, picked)
      toast.success(isWorkspace ? 'Added to the workspace.' : 'Added to the group.')
      setAdding(false)
      setPicked('')
      onChanged()
    } catch (error: any) {
      toast.error(error?.message || 'Could not add them to the group.')
    } finally {
      setSaving(false)
    }
  }

  // Takes the role away and leaves the seat: they still belong, and still see
  // everything in the workspace, but hold nothing here.
  const submitRevokeRole = async (grantId: string) => {
    try {
      await removeGrant(node.id, grantId)
      toast.success('Role revoked.')
      setConfirmRole(null)
      onChanged()
    } catch (error: any) {
      toast.error(error?.message || 'Could not revoke the role.')
    }
  }

  const submitRemove = async (member: NodeMember) => {
    try {
      await removeNodeMember(node.id, member.userId)
      toast.success(isWorkspace ? 'Removed from the workspace.' : 'Removed from the group.')
      setConfirm(null)
      onChanged()
    } catch (error: any) {
      toast.error(error?.message || 'Could not remove them.')
    }
  }

  const columns: Column<NodeMember>[] = [
    {
      key: 'name',
      header: isWorkspace ? 'Member' : 'In this group',
      sortable: true,
      sortValue: (m) => m.name || m.email,
      render: (m) => (
        <div className="flex items-center gap-2">
          <PersonRow
            stacked
            name={m.name}
            email={m.email}
            /* Permissions without membership can't happen on this list — being
               on it *is* the membership — but a seat in a group inside a
               workspace they left can, and it is worth saying. */
            suffix={detail.get(m.userId)?.noData ? <Badge tone="amber" className="ml-1.5">No data access</Badge> : undefined}
          />
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      sortable: true,
      width: 150,
      sortValue: (m) => detail.get(m.userId)?.roleName || '',
      render: (m) => {
        const roleName = detail.get(m.userId)?.roleName
        return roleName ? <Badge tone="faint">{roleName}</Badge> : <span className="text-[11px] text-ink-faint">No role here</span>
      },
    },
    // A row with neither control gets no buttons, but the column stays so the
    // table doesn't reshape between rows.
    ...(canGrant || canEdit
      ? [
          {
            key: 'actions',
            header: '',
            width: 96,
            align: 'right' as const,
            render: (m: NodeMember) => {
              const info = detail.get(m.userId)
              return (
                <RowActions>
                  {canGrant && info?.grantId && (
                    <RowAction
                      icon={TrashIcon}
                      label="Revoke this role — they stay a member"
                      aria={`Revoke ${m.name || m.email}'s role`}
                      tone="danger"
                      onClick={() => setConfirmRole({ member: m, grantId: info.grantId!, roleName: info.roleName })}
                    />
                  )}
                  {canEdit && (
                    <RowAction
                      icon={TrashIcon}
                      label="Remove from this group"
                      aria={`Remove ${m.name || m.email}`}
                      tone="danger"
                      onClick={() => setConfirm(m)}
                    />
                  )}
                </RowActions>
              )
            },
          },
        ]
      : []),
  ]

  const table = useDataTable({ rows: members, columns, pageSize: 10, resetKey: node.id })

  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5">
        <Heading className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">
          {isWorkspace ? 'In this workspace' : 'In this group'}
          {members.length > 0 && <span className="ml-1 font-normal normal-case tracking-normal">({members.length})</span>}
        </Heading>
        {canEdit && !adding && (
          <IconButton size="sm" className="ml-auto" onClick={() => setAdding(true)} aria-label="Add someone to this group">
            <PlusIcon width={13} height={13} />
          </IconButton>
        )}
      </div>

      {/* What being on this list is worth *here*. Stated once, above the names,
          because it is the same for all of them — which is exactly what made it
          unreadable as a row in the grant list. */}
      <p className="mb-2 flex flex-wrap items-center gap-1 text-[10px] leading-relaxed text-ink-faint">
        {isWorkspace ? (
          'These people are the workspace — being here is what makes everything inside it visible to them, and each one holds the role shown beside their name.'
        ) : rosterRole ? (
          <>
            Everyone here holds <Badge tone="faint">{rosterRole.roleName}</Badge> on this group, can open the connections filed
            under it, and gets whatever the group was granted elsewhere.
          </>
        ) : (
          'This group grants its own members nothing — they can still open the connections filed under it, and get whatever the group was granted elsewhere. Grant a role to the group itself to change that.'
        )}
      </p>

      {adding && (
        <div className="mb-2 flex flex-col gap-2 rounded-[7px] border border-edge p-2.5">
          {candidates === null ? (
            <LoadingState className="py-2 text-center" />
          ) : (
            <>
              <Select
                value={picked}
                onChange={setPicked}
                placeholder="Who…"
                options={options}
                className={controlClass}
                disabled={!options.length}
              />
              {!options.length && (
                <p className="text-[10px] leading-relaxed text-ink-faint">
                  {isWorkspace
                    ? 'Everyone on the instance already belongs to this workspace.'
                    : 'Everyone in this workspace is already in this group.'}
                </p>
              )}
              <div className="flex gap-2">
                <Button size="sm" onClick={submit} disabled={!picked || saving}>
                  {saving ? 'Adding…' : 'Add'}
                </Button>
                <Button
                  size="sm"
                  variant="subtle"
                  onClick={() => {
                    setAdding(false)
                    setPicked('')
                  }}
                >
                  Cancel
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      <DataTable
        columns={columns}
        rowKey={(m) => m.userId}
        empty={
          isWorkspace
            ? 'Nobody yet — members of this workspace see everything in it.'
            : 'Nobody yet — whoever is in it can open the connections filed here, plus whatever the group was granted elsewhere.'
        }
        {...table}
      />

      {confirm && (
        <ConfirmDialog
          title="Remove from group"
          message={
            isWorkspace
              ? `Remove ${confirm.name || confirm.email} from "${node.name}"? They lose access to everything in the workspace, including any group seats and anything they were granted inside it.`
              : `Remove ${confirm.name || confirm.email} from "${node.name}"? They lose everything this group is granted, wherever it is granted.`
          }
          confirmLabel="Remove"
          danger
          onConfirm={() => submitRemove(confirm)}
          onCancel={() => setConfirm(null)}
        />
      )}

      {confirmRole && (
        <ConfirmDialog
          title="Revoke role"
          message={`Remove ${confirmRole.member.name || confirmRole.member.email} as ${
            confirmRole.roleName || 'their role'
          } on "${node.name}"? They stay a member and still see everything in it — they just won't be able to do anything here.`}
          confirmLabel="Revoke"
          danger
          onConfirm={() => submitRevokeRole(confirmRole.grantId)}
          onCancel={() => setConfirmRole(null)}
        />
      )}
    </div>
  )
}
