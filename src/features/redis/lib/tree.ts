import type { RedisKeyMeta } from './api'

/**
 * Redis has no folders — but by convention keys are namespaced with a separator
 * (`user:42:profile`, `cache/page/home`). The sidebar turns that convention into
 * a real tree: every separator-delimited prefix becomes a branch, and each key
 * lands as a leaf under its own prefix.
 *
 * A branch that would hold exactly one child branch and nothing else is folded
 * into its parent (`a` → `a:b` → `a:b:c` renders as one `a:b:c` row), which is
 * what keeps a deeply-namespaced keyspace readable.
 */

export type RedisTreeNode =
  | { kind: 'key'; id: string; label: string; meta: RedisKeyMeta }
  | { kind: 'branch'; id: string; label: string; prefix: string; children: RedisTreeNode[]; keyCount: number }

type Branch = {
  segments: string[]
  children: Map<string, Branch>
  keys: RedisKeyMeta[]
}

const newBranch = (segments: string[]): Branch => ({ segments, children: new Map(), keys: [] })

/**
 * Build the tree. `delimiter` is the namespace separator (":" by default);
 * passing an empty string yields a flat list, which is the right rendering for
 * keyspaces that don't use a convention.
 */
export function buildKeyTree(keys: RedisKeyMeta[], delimiter = ':'): RedisTreeNode[] {
  if (!delimiter) {
    return sortNodes(keys.map((meta) => ({ kind: 'key' as const, id: meta.key, label: meta.key, meta })))
  }

  const root = newBranch([])
  for (const meta of keys) {
    const parts = meta.key.split(delimiter)
    // The last segment names the key itself, so only the ones before it branch.
    let node = root
    for (const segment of parts.slice(0, -1)) {
      if (!node.children.has(segment)) node.children.set(segment, newBranch([...node.segments, segment]))
      node = node.children.get(segment)!
    }
    node.keys.push(meta)
  }
  return sortNodes(collapse(root, delimiter))
}

// A branch's contents: its child branches (single-child chains folded) followed
// by the keys that sit directly on it.
function collapse(branch: Branch, delimiter: string): RedisTreeNode[] {
  const nodes: RedisTreeNode[] = []
  for (const child of branch.children.values()) {
    let node = child
    // Fold `a` → `a:b` into one row while the chain has no keys of its own and
    // exactly one way forward.
    while (node.keys.length === 0 && node.children.size === 1) {
      node = node.children.values().next().value!
    }
    const children = sortNodes(collapse(node, delimiter))
    nodes.push({
      kind: 'branch',
      id: `branch:${node.segments.join(delimiter)}`,
      // Label covers every segment folded into this row, so the full path is
      // still readable without expanding the chain.
      label: node.segments.slice(branch.segments.length).join(delimiter),
      prefix: node.segments.join(delimiter),
      children,
      keyCount: countKeys(children),
    })
  }
  for (const meta of branch.keys) nodes.push(keyNode(meta, delimiter))
  return nodes
}

// A key's row label is just its last segment — the branch above it carries the
// prefix, so repeating it on every leaf is noise.
function keyNode(meta: RedisKeyMeta, delimiter: string): RedisTreeNode {
  const parts = meta.key.split(delimiter)
  return { kind: 'key', id: meta.key, label: parts[parts.length - 1] || meta.key, meta }
}

const countKeys = (nodes: RedisTreeNode[]): number =>
  nodes.reduce((n, node) => n + (node.kind === 'key' ? 1 : node.keyCount), 0)

// Branches first, then keys; alphabetical within each.
function sortNodes(nodes: RedisTreeNode[]): RedisTreeNode[] {
  return [...nodes].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'branch' ? -1 : 1
    return a.label.localeCompare(b.label)
  })
}

/** Every branch id in the tree — used to expand/collapse everything at once. */
export function allBranchIds(nodes: RedisTreeNode[], out: string[] = []): string[] {
  for (const node of nodes) {
    if (node.kind === 'branch') {
      out.push(node.id)
      allBranchIds(node.children, out)
    }
  }
  return out
}

/** Human TTL for a key row: "5m 12s", "2h", "—" when it never expires. */
export function formatTtl(ttlMs: number | null): string {
  if (ttlMs == null) return '—'
  const s = Math.max(Math.round(ttlMs / 1000), 0)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`
}

/** Per-type accent used by the type badge on a key row. */
export const TYPE_COLOR: Record<string, string> = {
  string: 'text-[#7aa2f7] border-[#7aa2f7]/30 bg-[#7aa2f7]/10',
  list: 'text-[#c792ea] border-[#c792ea]/30 bg-[#c792ea]/10',
  set: 'text-[#5fb3b3] border-[#5fb3b3]/30 bg-[#5fb3b3]/10',
  zset: 'text-[#d6a73a] border-[#d6a73a]/30 bg-[#d6a73a]/10',
  hash: 'text-green-bright border-green-dim bg-green/10',
  stream: 'text-[#ff9b9b] border-red/30 bg-red/10',
}

/** Short label for the type badge — Redis's own names, trimmed to fit. */
export const TYPE_LABEL: Record<string, string> = {
  string: 'str',
  list: 'list',
  set: 'set',
  zset: 'zset',
  hash: 'hash',
  stream: 'strm',
}
