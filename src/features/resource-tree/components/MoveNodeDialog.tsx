import { useMemo, useState } from 'react'
import Button from '@/shared/ui/buttons/Button'
import EmptyState from '@/shared/ui/feedback/EmptyState'
import { useToast } from '@/shared/ui/feedback/Toast'
import SearchInput from '@/shared/ui/form/SearchInput'
import Modal from '@/shared/ui/overlay/Modal'
import { moveNode } from '../api'
import { TYPE_LABEL } from '../lib/tree'
import type { NodeTypeMeta, ResourceNode } from '../types'
import NodeIcon from './NodeIcon'

/**
 * Re-file one node under a different group — the everyday move: dragging a
 * connection out of the workspace and into the group you made to scope access
 * with.
 *
 * The list only offers destinations the server would accept, resolved the same
 * two ways it resolves them:
 *
 *   - **Shape** — the catalog's `children` list says which type may hold which,
 *     so a connection is never offered a dashboard and a workspace is never
 *     offered a group.
 *   - **Permission** — `canOrganise` is answered per node, so a group you were
 *     granted deep in the tree is offered while its parent workspace is not.
 *     Those rows still render, greyed, because "the group exists but isn't yours
 *     to file into" is a more useful answer than a list that quietly omits it.
 *
 * The node's own subtree is excluded outright: moving a group inside itself
 * would detach it from the root, which the server refuses and `chainOf` would
 * never recover from.
 *
 * Moving changes nothing about *who* has access — a grant is made on a node, so
 * what the node now inherits from its new parent is the whole point. That is
 * said in the dialog rather than left to be discovered.
 */
export default function MoveNodeDialog({
  node,
  nodes,
  nodeTypes,
  onClose,
  onMoved,
}: {
  node: ResourceNode
  /** The flat tree, as the server sent it — the candidates come from here. */
  nodes: ResourceNode[]
  nodeTypes: NodeTypeMeta[]
  onClose: () => void
  onMoved: () => void
}) {
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [targetId, setTargetId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const nameById = useMemo(() => new Map(nodes.map((n) => [n.id, n.name])), [nodes])

  // Types that may hold this one, straight from the catalog the server publishes
  // — the client never keeps its own copy of the hierarchy rules.
  const holders = useMemo(
    () => new Set(nodeTypes.filter((t) => t.children.includes(node.type)).map((t) => t.type)),
    [nodeTypes, node.type]
  )

  const candidates = useMemo(
    () =>
      nodes
        .filter(
          (n) =>
            holders.has(n.type) &&
            n.id !== node.id &&
            n.id !== node.parentId &&
            // The node's own subtree — `path` already lists the ancestors, so
            // this is the whole check.
            !n.path.startsWith(`${node.path}/`)
        )
        .sort((a, b) => a.path.localeCompare(b.path)),
    [nodes, holders, node]
  )

  const term = query.trim().toLowerCase()
  const shown = term ? candidates.filter((n) => n.name.toLowerCase().includes(term)) : candidates

  // Ancestor names, so two groups called "Production" in different workspaces
  // are told apart without opening either.
  const trailOf = (n: ResourceNode) =>
    n.path
      .split('/')
      .filter(Boolean)
      .slice(0, -1)
      .map((id) => nameById.get(id))
      .filter(Boolean)
      .join(' / ')

  const submit = async () => {
    if (!targetId || busy) return
    setBusy(true)
    try {
      await moveNode(node.id, targetId)
      toast.success(`Moved to ${nameById.get(targetId) || 'the group'}.`)
      onMoved()
    } catch (error: any) {
      toast.error(error?.message || 'Could not move it.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={`Move "${node.name}"`} onClose={onClose} width={520}>
      <div className="flex flex-col gap-3">
        <p className="text-[11px] leading-relaxed text-ink-faint">
          Pick where this {TYPE_LABEL[node.type].toLowerCase()} should be filed. Access follows the tree, so it will inherit
          whatever has been granted on its new parent — and stop inheriting what was granted on the old one.
        </p>

        {candidates.length > 0 && (
          <SearchInput
            autoFocus
            value={query}
            placeholder="Search groups"
            onChange={(e) => setQuery(e.target.value)}
            inputClassName="h-8 text-[12px]"
          />
        )}

        <div className="flex max-h-[320px] flex-col gap-0.5 overflow-y-auto">
          {shown.length === 0 ? (
            <EmptyState className="py-8">
              {candidates.length === 0
                ? `Nothing you can see can hold a ${TYPE_LABEL[node.type].toLowerCase()}.`
                : 'No group matches that.'}
            </EmptyState>
          ) : (
            shown.map((n) => {
              const allowed = n.canOrganise !== false
              const selected = n.id === targetId
              return (
                <button
                  key={n.id}
                  type="button"
                  disabled={!allowed}
                  title={allowed ? undefined : `You cannot file anything into ${n.name}.`}
                  onClick={() => setTargetId(n.id)}
                  className={`flex items-center gap-2 rounded-[7px] border px-2.5 py-2 text-left text-xs transition-colors ${
                    selected
                      ? 'border-green/40 bg-green/10 text-ink'
                      : allowed
                        ? 'border-transparent text-ink-dim hover:bg-elevated hover:text-ink'
                        : 'cursor-not-allowed border-transparent text-ink-faint opacity-50'
                  }`}
                >
                  <NodeIcon type={n.type} size={14} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{n.name}</span>
                    {trailOf(n) && <span className="block truncate text-[10px] text-ink-faint">{trailOf(n)}</span>}
                  </span>
                  <span className="shrink-0 text-[10px] text-ink-faint">{TYPE_LABEL[n.type]}</span>
                </button>
              )
            })
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-edge pt-3">
          <Button variant="subtle" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!targetId || busy}>
            {busy ? 'Moving…' : 'Move here'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
