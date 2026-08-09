import type { NodeType, ResourceNode } from '../types'

/**
 * Nest the flat node list the server sends.
 *
 * The payload is flat on purpose — a member sees a sparse slice of the tree and
 * nesting it server-side would mean shipping the gaps too. Roots are whatever has
 * no parent *in this payload*, so a slice that starts three levels down still
 * renders instead of silently coming out empty.
 */
export function nestNodes(nodes: ResourceNode[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const children = new Map<string, ResourceNode[]>()
  const roots: ResourceNode[] = []

  for (const n of nodes) {
    if (n.parentId && byId.has(n.parentId)) {
      const list = children.get(n.parentId)
      list ? list.push(n) : children.set(n.parentId, [n])
    } else {
      roots.push(n)
    }
  }

  // Groups before resources, then alphabetical — the same order the server uses,
  // repeated here because the client re-sorts after an optimistic insert.
  const order = (a: ResourceNode, b: ResourceNode) =>
    Number(b.kind === 'group') - Number(a.kind === 'group') || a.name.localeCompare(b.name)

  roots.sort(order)
  for (const list of children.values()) list.sort(order)

  return { roots, childrenOf: (id: string) => children.get(id) || [] }
}

/** Ids of every ancestor of `id` within the payload — what to expand to reveal it. */
export function ancestorIds(nodes: ResourceNode[], id: string): string[] {
  const node = nodes.find((n) => n.id === id)
  if (!node) return []
  // The materialized path already lists them, root-first, minus the node itself.
  return node.path.split('/').filter(Boolean).slice(0, -1)
}

/** Where a node click should navigate, or null when it only expands. */
export function nodeHref(node: ResourceNode): string | null {
  if (!node.resourceId) return null
  switch (node.type) {
    case 'connection':
      return node.canOpen === false ? null : `/connection/${node.resourceId}`
    case 'storage':
      return '/storage'
    case 'workspace':
      return '/workspace'
    default:
      return null
  }
}

/** Human label for a type, for the places that don't have the catalog to hand. */
export const TYPE_LABEL: Record<NodeType, string> = {
  application: 'Application',
  workspace: 'Workspace',
  group: 'Group',
  connection: 'Connection',
  storage: 'Storage',
  dashboard: 'Dashboard',
  workflow: 'Workflow',
}
