import { useMemo, useState } from 'react'
import Avatar from '@/shared/ui/Avatar'
import Badge from '@/shared/ui/Badge'
import IconButton from '@/shared/ui/buttons/IconButton'
import ConfirmDialog from '@/shared/ui/feedback/ConfirmDialog'
import EmptyState from '@/shared/ui/feedback/EmptyState'
import { useToast } from '@/shared/ui/feedback/Toast'
import { ChevronDown, ChevronRight, ExternalLinkIcon, KeyIcon, PlusIcon, TrashIcon } from '@/shared/ui/icons'
import { removeGrant } from '../api'
import { buildAccessRows, describeSource, type AccessRow } from '../lib/access'
import type { GrantableRole, NodeAccess, ResourceGrant, ResourceNode } from '../types'
import GrantForm from './GrantForm'

/**
 * Who may do what here — the whole answer, in one list, grouped by role.
 *
 * It merges what used to be three panels (the node's owner, the grants made
 * here, and the resolved list of everyone who can reach it) because they were
 * three views of one question that had to be read together to be understood:
 * the grant list alone can't tell you who gets in — access also arrives from an
 * inherited grant above, a group's roster, or ownership of an ancestor — and the
 * resolved list alone can't be edited.
 *
 * Grouping by role is what makes the merge legible: a role is the unit people
 * actually reason about ("who are the admins here?"), and ownership is simply
 * the strongest one, so it sorts to the top.
 *
 * Each row still names its origin, and only a row granted *on this node* offers
 * a revoke — everything else links to the node where it lives. That is the line
 * the merge must not cross: one grant, one place it is edited.
 */
export default function NodeAccessList({
  node,
  people,
  grants,
  roles,
  canGrant,
  onSelect,
  onChanged,
}: {
  node: ResourceNode
  people: NodeAccess[]
  grants: ResourceGrant[]
  roles: GrantableRole[]
  canGrant: boolean
  /** Jump to the node an inherited grant was made on — where it can be changed. */
  onSelect: (nodeId: string) => void
  onChanged: () => void
}) {
  const toast = useToast()
  const [adding, setAdding] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<AccessRow | null>(null)

  const groups = useMemo(() => buildAccessRows(node, people, grants, roles), [node, people, grants, roles])
  const total = groups.reduce((n, g) => n + g.rows.length, 0)

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

  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5">
        <KeyIcon width={12} height={12} className="text-ink-faint" />
        <h3 className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">
          Access
          {total > 0 && <span className="ml-1 font-normal normal-case tracking-normal">({total})</span>}
        </h3>
        {canGrant && node.workspaceId && !adding && (
          <IconButton size="sm" className="ml-auto" onClick={() => setAdding(true)} aria-label="Grant access">
            <PlusIcon width={13} height={13} />
          </IconButton>
        )}
      </div>

      {adding && <GrantForm node={node} roles={roles} onDone={() => setAdding(false)} onChanged={onChanged} />}

      {total === 0 ? (
        <EmptyState className="py-4">
          {node.type === 'application'
            ? 'The root is held by ownership, not by grants.'
            : 'Nobody can reach this yet.'}
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((group) => (
            <div key={group.slug}>
              <div className="mb-1 flex items-center gap-1.5 px-0.5">
                <span className="text-[11px] font-semibold text-ink-dim">{group.label}</span>
                <span className="text-[10px] text-ink-faint">{group.rows.length}</span>
              </div>
              <div className="flex flex-col divide-y divide-edge overflow-hidden rounded-soft border border-edge">
                {group.rows.map((row) => (
                  <Row
                    key={row.key}
                    row={row}
                    node={node}
                    canGrant={canGrant}
                    open={expanded === row.key}
                    onToggle={() => setExpanded(expanded === row.key ? null : row.key)}
                    onSelect={onSelect}
                    onRevoke={() => setConfirm(row)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {total > 0 && (
        <p className="mt-1.5 text-[10px] leading-relaxed text-ink-faint">
          Resolved from this node and everything above it. Instance admins administer every node and are not listed — they
          hold no data access of their own.
        </p>
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

/**
 * One path to this node. A group row expands to the people its roster reaches,
 * which is the part of a group grant that is otherwise invisible from here.
 */
function Row({
  row,
  node,
  canGrant,
  open,
  onToggle,
  onSelect,
  onRevoke,
}: {
  row: AccessRow
  node: ResourceNode
  canGrant: boolean
  open: boolean
  onToggle: () => void
  onSelect: (nodeId: string) => void
  onRevoke: () => void
}) {
  const expandable = row.kind === 'group'
  const canRevoke = canGrant && row.here && !!row.grantId

  return (
    <div className="bg-elevated/30">
      <div className="flex items-center gap-2.5 px-3 py-2">
        {expandable ? (
          <button
            type="button"
            onClick={onToggle}
            className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
            aria-expanded={open}
          >
            <RowFace row={row} node={node} />
            {open ? (
              <ChevronDown width={12} height={12} className="shrink-0 text-ink-faint" />
            ) : (
              <ChevronRight width={12} height={12} className="shrink-0 text-ink-faint" />
            )}
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <RowFace row={row} node={node} />
          </div>
        )}

        {canRevoke ? (
          <IconButton size="sm" className="shrink-0 hover:!text-red" onClick={onRevoke} aria-label={`Revoke ${row.name}`}>
            <TrashIcon width={13} height={13} />
          </IconButton>
        ) : (
          // Not editable here: the grant lives further up, so the row sends you
          // there rather than offering a control that would have to lie.
          !row.here && (
            <IconButton
              size="sm"
              className="shrink-0"
              onClick={() => onSelect(row.source.nodeId)}
              title={`Open "${row.source.nodeName}" — where this is set`}
              aria-label={`Open ${row.source.nodeName}`}
            >
              <ExternalLinkIcon width={12} height={12} />
            </IconButton>
          )
        )}
      </div>

      {open && (
        <div className="border-t border-edge px-3 py-2">
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
              Nobody is in this group yet, so the grant reaches no one. Add people to it on the group itself.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/** Avatar, name and the line that says where the access comes from. */
function RowFace({ row, node }: { row: AccessRow; node: ResourceNode }) {
  return (
    <>
      <Avatar size="sm" label={row.name} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-medium text-ink">{row.name}</span>
        <span className="block truncate text-[10px] text-ink-faint">
          {describeSource(row.source, node.id)}
          {row.kind === 'group' && ` · group of ${row.reached.length}`}
          {row.inherit === false && ' · this node only'}
          {row.source.instanceWide && ' · above every workspace'}
        </span>
      </span>
      {row.kind === 'group' && <Badge tone="faint">Group</Badge>}
      {/* Permissions without membership is permissions without data access —
          opening a database needs a membership row. */}
      {row.kind !== 'group' && row.noData && <Badge tone="amber">No data access</Badge>}
    </>
  )
}
