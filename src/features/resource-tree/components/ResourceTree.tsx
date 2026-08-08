import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, MoveIcon, PlusIcon } from '@/shared/ui/icons'
import EmptyState from '@/shared/ui/feedback/EmptyState'
import { useToast } from '@/shared/ui/feedback/Toast'
import { Input } from '@/shared/ui/form/Input'
import MenuItem from '@/shared/ui/navigation/MenuItem'
import ContextMenu from '@/shared/ui/overlay/ContextMenu'
import { createGroup } from '../api'
import { ancestorIds, nestNodes } from '../lib/tree'
import type { NodeTypeMeta, ResourceNode } from '../types'
import MoveNodeDialog from './MoveNodeDialog'
import NodeIcon from './NodeIcon'

// The same compact row the folder panels in the data browser use, so the tree
// reads as one component family with them.
const rowBase = 'group flex w-full items-center gap-2 rounded-[7px] px-2.5 py-1.5 text-left text-xs'
const rowIdle = 'text-ink-dim hover:bg-elevated hover:text-ink'

/**
 * The resource hierarchy, rendered as a collapsible tree.
 *
 * Nodes that are only present so their descendants have a path back to the root
 * (`context`) render dimmed — the caller holds nothing there — but they still
 * select. The detail panel has something honest to say about them: what they are,
 * what of theirs is filed inside, and that access here comes from elsewhere. The
 * server scopes that payload to the same nodes this tree shows, so opening one
 * discloses nothing the tree didn't already.
 *
 * Right-clicking offers the two things that change the shape of the tree: a new
 * group inside a group, and re-filing this node somewhere else. Both are gated on
 * `canOrganise`, which the server resolves per node — a grant deep in the tree
 * lets you organise there without holding anything at workspace level, so the row
 * itself is the only place that answer can come from.
 */
export default function ResourceTree({
  nodes,
  nodeTypes = [],
  selectedId,
  activeResourceId,
  onSelect,
  onOpen,
  onChanged,
  emptyLabel = 'Nothing here yet.',
}: {
  nodes: ResourceNode[]
  /** The node-type catalog. Without it the move picker has no shape rules to
   *  filter by, so the menu leaves the item out rather than offering a list the
   *  server would refuse. */
  nodeTypes?: NodeTypeMeta[]
  selectedId?: string | null
  /** Highlights the connection currently open in the console. */
  activeResourceId?: string | null
  onSelect?: (node: ResourceNode) => void
  /** A resource node was activated — navigate to it. */
  onOpen?: (node: ResourceNode) => void
  /** The tree changed (a group was created) — reload it. */
  onChanged?: () => void
  emptyLabel?: string
}) {
  const toast = useToast()
  const { roots, childrenOf } = useMemo(() => nestNodes(nodes), [nodes])

  // Collapsed rather than expanded ids: a tree that grows while you're looking at
  // it should reveal the new node, not hide it.
  const [collapsed, setCollapsed] = useState(() => new Set<string>())
  const [menu, setMenu] = useState<{ x: number; y: number; node: ResourceNode } | null>(null)
  // Which group is being filled in, and with what. The row renders in place
  // among that group's children, so you name it where it will live.
  const [creatingIn, setCreatingIn] = useState<string | null>(null)
  const [moving, setMoving] = useState<ResourceNode | null>(null)
  const [draftName, setDraftName] = useState('')
  const [busy, setBusy] = useState(false)

  // Reveal the selection when it changes from outside (a deep link, a search
  // result) — collapsing an ancestor is otherwise the one way to lose it.
  useEffect(() => {
    if (!selectedId) return
    const reveal = ancestorIds(nodes, selectedId)
    if (!reveal.length) return
    setCollapsed((prev) => {
      if (!reveal.some((id) => prev.has(id))) return prev
      const next = new Set(prev)
      for (const id of reveal) next.delete(id)
      return next
    })
  }, [selectedId, nodes])

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const expand = (id: string) =>
    setCollapsed((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })

  const handleClick = (node: ResourceNode, hasChildren: boolean) => {
    onSelect?.(node)
    // Only a group is ever `context` (ancestors are), so this never opens a
    // resource the caller can't reach.
    if (node.kind === 'resource') onOpen?.(node)
    else if (hasChildren) toggle(node.id)
  }

  // A row with nothing to offer keeps the browser's own menu: the root can only
  // hold a new group, and a resource can only be moved.
  const handleContextMenu = (e: React.MouseEvent, node: ResourceNode) => {
    if (node.kind !== 'group' && !node.parentId) return
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, node })
  }

  const startCreate = (node: ResourceNode) => {
    setMenu(null)
    setDraftName('')
    expand(node.id)
    setCreatingIn(node.id)
  }

  const cancelCreate = () => {
    setCreatingIn(null)
    setDraftName('')
  }

  const submitCreate = async (parentId: string) => {
    const name = draftName.trim()
    if (!name || busy) return
    setBusy(true)
    try {
      const created = await createGroup(parentId, name)
      toast.success('Group created.')
      cancelCreate()
      onChanged?.()
      // Land on what you just made — its roster and grants are the reason it
      // exists, and both live in the detail panel.
      onSelect?.(created)
    } catch (error: any) {
      toast.error(error?.message || 'Could not create the group.')
    } finally {
      setBusy(false)
    }
  }

  const renderNode = (node: ResourceNode) => {
    const kids = childrenOf(node.id)
    const hasChildren = kids.length > 0
    const expanded = !collapsed.has(node.id)
    const creatingHere = creatingIn === node.id
    const active = !!activeResourceId && node.resourceId === activeResourceId
    const selected = node.id === selectedId

    const tone = active
      ? 'bg-green/10 text-green'
      : selected
      ? 'bg-elevated text-ink'
      : node.context
      ? 'text-ink-faint hover:bg-elevated hover:text-ink-dim'
      : rowIdle

    return (
      <div key={node.id}>
        <button
          type="button"
          onClick={() => handleClick(node, hasChildren)}
          onContextMenu={(e) => handleContextMenu(e, node)}
          title={node.context ? `${node.name} — you hold nothing here; it's shown so what's inside has a path` : node.name}
          className={`${rowBase} ${tone}`}
        >
          {/* The twisty always occupies the same slot, whether or not there is
              one to draw — a leaf and its expandable sibling must line their
              icons up, and letting the svg size the gap itself doesn't
              guarantee that. */}
          <span
            className="flex h-3 w-3 shrink-0 items-center justify-center"
            onClick={(e) => {
              if (!hasChildren) return
              // Expanding shouldn't also select — they're different intentions
              // and a resource row would navigate away.
              e.stopPropagation()
              toggle(node.id)
            }}
          >
            {hasChildren && (
              <ChevronRight
                width={12}
                height={12}
                className={`text-ink-faint transition-transform ${expanded ? 'rotate-90' : ''}`}
              />
            )}
          </span>
          <NodeIcon type={node.type} />
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
          {hasChildren && <span className="shrink-0 text-[10px] text-ink-faint">{kids.length}</span>}
        </button>

        {(hasChildren || creatingHere) && expanded && (
          <div className="ml-3 flex flex-col gap-0.5 border-l border-edge pl-1.5">
            {kids.map(renderNode)}
            {creatingHere && (
              <div className="flex items-center gap-1.5 py-0.5 pl-2.5">
                <Input
                  autoFocus
                  value={draftName}
                  placeholder="Group name"
                  disabled={busy}
                  onChange={(e: any) => setDraftName(e.target.value)}
                  onBlur={() => !draftName.trim() && cancelCreate()}
                  onKeyDown={(e: any) => {
                    if (e.key === 'Enter') submitCreate(node.id)
                    if (e.key === 'Escape') cancelCreate()
                  }}
                  className="h-7 text-[12px]"
                />
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  if (!nodes.length) return <EmptyState className="py-6">{emptyLabel}</EmptyState>

  return (
    <div className="flex flex-col gap-0.5">
      {roots.map(renderNode)}

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} width={220} onClose={() => setMenu(null)}>
          {menu.node.kind === 'group' && (
            <MenuItem disabled={!menu.node.canOrganise} onClick={() => startCreate(menu.node)}>
              <PlusIcon width={14} height={14} /> New group
            </MenuItem>
          )}
          {nodeTypes.length > 0 && menu.node.parentId && (
            <MenuItem
              disabled={!menu.node.canOrganise}
              onClick={() => {
                setMoving(menu.node)
                setMenu(null)
              }}
            >
              <MoveIcon width={14} height={14} /> Move…
            </MenuItem>
          )}
          {/* A greyed-out row that won't say why is the same as no row at all.
              The reason is always the same one — both items ask for the same
              permission at this node — so it is stated once, in the menu, rather
              than hidden in a title attribute nobody hovers long enough to see. */}
          {!menu.node.canOrganise && (
            <p className="px-2.5 pb-1 pt-1.5 text-[10px] leading-relaxed text-ink-faint">
              Needs <span className="text-ink-dim">Organise resources</span> on {menu.node.name} — your role here doesn't
              carry it.
            </p>
          )}
        </ContextMenu>
      )}

      {moving && (
        <MoveNodeDialog
          node={moving}
          nodes={nodes}
          nodeTypes={nodeTypes}
          onClose={() => setMoving(null)}
          onMoved={() => {
            setMoving(null)
            onChanged?.()
          }}
        />
      )}
    </div>
  )
}
