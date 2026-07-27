import type { TableFolder } from '../types'

/**
 * Helpers for the (up to 3 level) table-folder tree. The flat lists — the
 * picker panel and the quick-assign flyout — use these to show where a nested
 * folder sits without rendering the tree itself.
 */

// "Parent / Child" trail of a folder's ancestors ('' for a root folder).
export function folderParentPath(folders: TableFolder[], folder: TableFolder): string {
  const byId = new Map(folders.map((f) => [f.id, f]))
  const names: string[] = []
  const seen = new Set<string>()
  let cur = folder.parentId ? byId.get(folder.parentId) : undefined
  while (cur && !seen.has(cur.id)) {
    names.unshift(cur.name)
    seen.add(cur.id)
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  return names.join(' / ')
}

// Folders ordered as the tree reads: each parent immediately followed by its
// children, siblings A–Z. Keeps flat lists predictable once folders nest.
export function foldersInTreeOrder(folders: TableFolder[]): TableFolder[] {
  const byName = (a: TableFolder, b: TableFolder) => a.name.localeCompare(b.name)
  const out: TableFolder[] = []
  const walk = (parentId: string | null) => {
    for (const f of folders.filter((x) => (x.parentId || null) === parentId).sort(byName)) {
      out.push(f)
      walk(f.id)
    }
  }
  walk(null)
  // Anything unreachable (orphaned parent) still gets listed, once.
  for (const f of folders) if (!out.includes(f)) out.push(f)
  return out
}
