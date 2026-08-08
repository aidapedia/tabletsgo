import { useMemo, useState } from 'react'
import Avatar from '@/shared/ui/Avatar'
import Badge from '@/shared/ui/Badge'
import IconButton from '@/shared/ui/buttons/IconButton'
import ConfirmDialog from '@/shared/ui/feedback/ConfirmDialog'
import { useToast } from '@/shared/ui/feedback/Toast'
import DataTable, { type Column } from '@/shared/ui/table/DataTable'
import { RowAction, RowActions } from '@/shared/ui/table/RowActions'
import useDataTable from '@/shared/ui/table/useDataTable'
import { ChevronDown, ChevronRight, ExternalLinkIcon, KeyIcon, PlusIcon, TrashIcon, UsersIcon } from '@/shared/ui/icons'
import { removeGrant } from '../api'
import { buildAccessRows, describeSource, directRoleName, type AccessRow } from '../lib/access'
import type { GrantableRole, NodeAccess, NodeMember, ResourceGrant, ResourceNode } from '../types'
import GrantForm from './GrantForm'
import NodeMembers from './NodeMembers'

/**
 * Everyone this node has anything to do with, in one section.
 *
 * It absorbed the roster panel that used to sit underneath it, because the two
 * were one fact split across two lists that had to be read together to mean
 * anything. A group grants a role to *itself* (`createGroupNode` writes it), so
 * the old layout showed that grant as a person-shaped row saying "granted here
 * · group of 0" while the people it pays out to lived in the panel below — and
 * at a workspace, where `addMember` writes a seat and a grant together, every
 * member was simply listed twice.
 *
 * So the section states the roster once, headed by what the roster gets here.
 * What the merge must not do is blur where a thing is edited: a roster seat is
 * written to `node_members` under `teams.manage`, a grant to `resource_grants`
 * under `resources.grant`, and each block carries its own control for its own
 * table.
 *
 * Which blocks appear follows from where access is actually made:
 *
 *  - a node with a roster (workspace, group) is entered by being *on* the
 *    roster, so that is the only list — plus, if one exists, whatever was
 *    granted on the node itself, which is the part that can be revoked here.
 *    Resolving the ancestors again would restate the workspace's whole
 *    membership under every group inside it;
 *  - a connection or the root has no roster, so the resolved list *is* the
 *    section, and it keeps its own heading rather than one over the other.
 *
 * Both lists are `DataTable`s: a workspace roster or a widely granted node runs
 * to hundreds of names, and the answer you came for ("who is X here?") is a sort
 * on a column, not a scroll.
 */
export default function NodePeople({
  node,
  people,
  grants,
  roles,
  members,
  canGrant,
  canManageMembers,
  onSelect,
  onChanged,
}: {
  node: ResourceNode
  people: NodeAccess[]
  grants: ResourceGrant[]
  roles: GrantableRole[]
  members: NodeMember[]
  canGrant: boolean
  canManageMembers: boolean
  /** Jump to the node an inherited grant was made on — where it can be changed. */
  onSelect: (nodeId: string) => void
  onChanged: () => void
}) {
  const toast = useToast()
  const [adding, setAdding] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showWithout, setShowWithout] = useState(false)
  const [confirm, setConfirm] = useState<AccessRow | null>(null)

  // The application root is a group that holds no people: everything on the
  // instance hangs off it, so a roster there would mean "everyone", which
  // membership already means one level down.
  const hasRoster = node.kind === 'group' && node.type !== 'application'

  // On a node that has a roster, the roster *is* how people get in: a workspace
  // writes the seat and the role in one act (`addMember`), and a group hands its
  // members whatever it was granted elsewhere. So there is nothing to grant to a
  // person here — you put them on the list above — and the resolved view was the
  // same names a second time, or the workspace's whole membership repeated under
  // every group inside it.
  //
  // What is left is what was granted *on this node* and can be revoked from it.
  // Normally nothing, and then the block doesn't render at all.
  const grantable = !hasRoster

  // A workspace member's role *is* a per-user grant on this node, written with
  // the seat by `addMember`. Showing it on their roster row is what stops the
  // same names appearing twice; a group's per-user grants are a separate act and
  // keep their own revocable rows below.
  const absorbUserGrants = useMemo(
    () => (node.type === 'workspace' ? new Set(members.map((m) => m.userId)) : undefined),
    [node.type, members]
  )

  // A connection is the one node with something to *open*, and holding a role
  // that reaches it is not the same as being able to open it (`canOpen`). So
  // here the section answers who has access, not who has permissions; everyone
  // else is stated underneath rather than dropped.
  const gated = node.type === 'connection'

  const { rosterRole, groups, withoutAccess } = useMemo(
    () => buildAccessRows(node, people, grants, roles, { absorbUserGrants, requireAccess: gated }),
    [node, people, grants, roles, absorbUserGrants, gated]
  )

  // The role was the list's grouping; in a table it is a column, so the rows
  // flatten and stay in the catalog's strongest-first order until a header is
  // clicked — the label `buildAccessRows` computed per role rides along on each.
  const rows = useMemo(() => {
    const flat = groups.flatMap((group) => group.rows.map((row) => ({ ...row, roleName: group.label })))
    // A roster node lists only what was granted on it — see `grantable`. An
    // inherited row is not dropped from the model, it is stated on the node it
    // was granted on, which is where it can be changed.
    return grantable ? flat : flat.filter((row) => row.here)
  }, [groups, grantable])
  const total = rows.length

  // What each roster row needs that the roster itself doesn't know: the role
  // they hold here, and whether they can actually open anything.
  const memberDetail = useMemo(() => {
    const byId = new Map(people.map((p) => [p.userId, p]))
    return new Map(
      members.map((m) => [
        m.userId,
        {
          roleName: directRoleName(grants, roles, m.userId) || rosterRole?.roleName || null,
          // Absent from `people` means no resolved access at all, which is not
          // the same as reaching it without membership — only the latter is a
          // warning worth showing.
          noData: byId.get(m.userId)?.member === false,
          // Only set for a grant this block absorbed, so the row carries the
          // revoke that would otherwise have vanished with its old row. A member
          // holding no grant is a real state, and this is how you reach it.
          grantId: absorbUserGrants?.has(m.userId)
            ? grants.find((g) => g.principalType === 'user' && g.principalId === m.userId)?.id
            : undefined,
        },
      ])
    )
  }, [members, people, grants, roles, rosterRole, absorbUserGrants])

  const columns: Column<TableRow>[] = [
    {
      key: 'name',
      header: 'Who',
      sortable: true,
      sortValue: (row) => row.name,
      render: (row) => (
        <div className="flex min-w-0 flex-col gap-2">
          {row.kind === 'group' ? (
            // A group row expands to the people its roster reaches, which is the
            // part of a group grant that is otherwise invisible from here.
            <button
              type="button"
              onClick={() => setExpanded(expanded === row.key ? null : row.key)}
              className="flex min-w-0 items-center gap-2.5 text-left"
              aria-expanded={expanded === row.key}
            >
              <RowFace row={row} />
              {expanded === row.key ? (
                <ChevronDown width={12} height={12} className="shrink-0 text-ink-faint" />
              ) : (
                <ChevronRight width={12} height={12} className="shrink-0 text-ink-faint" />
              )}
            </button>
          ) : (
            <div className="flex min-w-0 items-center gap-2.5">
              <RowFace row={row} />
            </div>
          )}
          {expanded === row.key && <Reached row={row} gated={gated} />}
        </div>
      ),
    },
    {
      key: 'source',
      header: 'Via',
      sortable: true,
      width: 200,
      sortValue: (row) => (row.here ? '' : row.source.nodeName),
      render: (row) => (
        <span className="text-[11px] text-ink-faint">
          {describeSource(row.source, node.id)}
          {row.inherit === false && ' · this node only'}
          {row.source.instanceWide && ' · above every workspace'}
        </span>
      ),
    },
    {
      key: 'roleName',
      header: 'Role',
      sortable: true,
      width: 130,
      render: (row) => <Badge tone="faint">{row.roleName}</Badge>,
    },
    {
      key: 'actions',
      header: '',
      width: 70,
      align: 'right' as const,
      render: (row) =>
        canGrant && row.here && row.grantId ? (
          <RowActions>
            <RowAction
              icon={TrashIcon}
              label="Revoke"
              aria={`Revoke ${row.name}`}
              tone="danger"
              onClick={() => setConfirm(row)}
            />
          </RowActions>
        ) : (
          // Not editable here: the grant lives further up, so the row sends you
          // there rather than offering a control that would have to lie.
          !row.here && (
            <RowActions>
              <RowAction
                icon={ExternalLinkIcon}
                label={`Open "${row.source.nodeName}" — where this is set`}
                aria={`Open ${row.source.nodeName}`}
                onClick={() => onSelect(row.source.nodeId)}
              />
            </RowActions>
          )
        ),
    },
  ]

  const table = useDataTable({ rows, columns, pageSize: 10, resetKey: node.id })

  const revoke = async (row: AccessRow) => {
    if (!row.grantId) return
    try {
      await removeGrant(node.id, row.grantId)
      toast.success('Access revoked.')
      onChanged()
    } catch (error: any) {
      toast.error(error?.message || 'Could not revoke access.')
    } finally {
      setConfirm(null)
    }
  }

  // The "People" header groups the roster with the grant list. It earns its place
  // only when both are on screen — over a single block it is a heading on top of
  // a heading, and the block's own title already says what it is.
  const twoBlocks = hasRoster && total > 0
  const Heading = twoBlocks ? 'h4' : 'h3'

  return (
    <div>
      {twoBlocks && (
        <div className="mb-2 flex items-center gap-1.5">
          <UsersIcon width={12} height={12} className="text-ink-faint" />
          <h3 className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">People</h3>
        </div>
      )}

      {hasRoster && (
        <NodeMembers
          node={node}
          heading={Heading}
          members={members}
          rosterRole={rosterRole}
          detail={memberDetail}
          canManage={canManageMembers}
          canGrant={canGrant}
          onChanged={onChanged}
        />
      )}

      {(grantable || total > 0) && (
        <div className={hasRoster ? 'mt-4' : ''}>
          <div className="mb-2 flex items-center gap-1.5">
            <KeyIcon width={12} height={12} className="text-ink-faint" />
            <Heading className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">
              {hasRoster ? 'Also granted here' : gated ? 'Has access' : 'Granted access'}
              {total > 0 && <span className="ml-1 font-normal normal-case tracking-normal">({total})</span>}
            </Heading>
            {grantable && canGrant && node.workspaceId && !adding && (
              <IconButton size="sm" className="ml-auto" onClick={() => setAdding(true)} aria-label="Grant access">
                <PlusIcon width={13} height={13} />
              </IconButton>
            )}
          </div>

          {adding && <GrantForm node={node} roles={roles} onDone={() => setAdding(false)} onChanged={onChanged} />}

          <DataTable
            columns={columns}
            rowKey={(row) => row.key}
            empty={
              node.type === 'application'
                ? 'The root is held by ownership, not by grants.'
                : gated && withoutAccess.length
                  ? 'Nobody can open this connection yet.'
                  : 'Nothing is granted here yet.'
            }
            {...table}
          />

          {total > 0 && (
            <p className="mt-1.5 text-[10px] leading-relaxed text-ink-faint">
              {hasRoster
                ? 'Granted on this node itself — everyone reached from above is on the list at the top or on the node the grant was made on.'
                : `Resolved from this node and everything above it${
                    gated ? ', and limited to the people who can actually open this connection' : ''
                  }.`}{' '}
              Owners hold everything here without a grant, and instance admins administer every node — neither is listed.
            </p>
          )}

          {/* Held back from the list above, not hidden: they hold a role that
              reaches this node and still cannot open it, which is the state you
              come here to find. */}
          {gated && withoutAccess.length > 0 && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setShowWithout(!showWithout)}
                className="flex items-center gap-1 text-[10px] text-ink-faint hover:text-ink-dim"
                aria-expanded={showWithout}
              >
                {showWithout ? <ChevronDown width={11} height={11} /> : <ChevronRight width={11} height={11} />}
                {withoutAccess.length} {withoutAccess.length === 1 ? 'person holds' : 'people hold'} permissions here but cannot
                open this connection
              </button>
              {showWithout && (
                <ul className="mt-1.5 flex flex-col gap-1 rounded-soft border border-edge px-3 py-2">
                  {withoutAccess.map((p) => (
                    <li key={p.userId} className="flex items-center gap-1.5 text-[11px] text-ink-dim">
                      <span className="h-1 w-1 shrink-0 rounded-full bg-ink-faint" />
                      <span className="min-w-0 flex-1 truncate">{p.name || p.email}</span>
                      <Badge tone="amber">{p.member ? 'No data access' : 'Not a member'}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {confirm && (
        <ConfirmDialog
          title="Revoke access"
          message={
            confirm.kind === 'group'
              ? `Remove "${confirm.name}" as ${confirm.source.roleName} on ${node.name}? Everyone in the group loses it${
                  confirm.reached.length ? ` — ${confirm.reached.length} ${confirm.reached.length === 1 ? 'person' : 'people'} today` : ''
                }.`
              : `Remove ${confirm.name} as ${confirm.source.roleName} on ${node.name}?`
          }
          confirmLabel="Revoke"
          danger
          onConfirm={() => revoke(confirm)}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  )
}

/** A row is one path to this node, carrying the role it was grouped under. */
type TableRow = AccessRow & { roleName: string }

/** Avatar, name and the badges that say what kind of row this is. */
function RowFace({ row }: { row: TableRow }) {
  return (
    <>
      <Avatar size="sm" label={row.name} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-medium text-ink">{row.name}</span>
        {row.email && <span className="block truncate text-[10px] text-ink-faint">{row.email}</span>}
      </span>
      {row.kind === 'group' && <Badge tone="faint">Group of {row.reached.length}</Badge>}
      {/* Permissions without membership is permissions without data access —
          opening a database needs a membership row. */}
      {row.kind !== 'group' && row.noData && <Badge tone="amber">No data access</Badge>}
    </>
  )
}

/** The expanded half of a group row: who its roster actually reaches. */
function Reached({ row, gated }: { row: TableRow; /** Connection: `reached` counts who can open it. */ gated: boolean }) {
  return (
    <div className="rounded-soft border border-edge px-3 py-2">
      <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-ink-faint">
        {row.reached.length ? 'Reaches' : 'Reaches nobody'}
      </div>
      {row.reached.length ? (
        <ul className="flex flex-col gap-1">
          {row.reached.map((p) => (
            <li key={p.userId} className="flex items-center gap-1.5 text-[11px] text-ink-dim">
              <span className="h-1 w-1 shrink-0 rounded-full bg-ink-faint" />
              <span className="min-w-0 flex-1 truncate">{p.name || p.email}</span>
              {!p.member && <Badge tone="amber">No data access</Badge>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[10px] leading-relaxed text-ink-faint">
          {gated
            ? 'Nobody in this group can open this connection. Add people to the group on the group itself, or name them on this connection’s access list.'
            : 'Nobody is in this group yet, so the grant reaches no one. Add people to it on the group itself.'}
        </p>
      )}
    </div>
  )
}
