import type { TableFolder } from '../types'

/**
 * Return `list` with `table` moved out of every folder and into `folderId`
 * (`null` = ungrouped). A table belongs to at most one folder, so this is the
 * single source of truth for the optimistic reassignment the sidebar tree, the
 * picker panel and the quick-assign menu apply before the API call resolves.
 */
export function withTableAssignment(list: TableFolder[], table: string, folderId: string | null): TableFolder[] {
  return list.map((f) => ({
    ...f,
    tables:
      f.id === folderId
        ? [...f.tables.filter((n) => n !== table), table]
        : f.tables.filter((n) => n !== table),
  }))
}
