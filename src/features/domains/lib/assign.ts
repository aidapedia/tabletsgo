import type { Domain } from '../types'

/**
 * Return `list` with `table` moved out of every domain and into `domainId`
 * (`null` = ungrouped). A table belongs to at most one domain, so this is the
 * single source of truth for the optimistic reassignment both the picker panel
 * and the quick-assign menu apply before the API call resolves.
 */
export function withTableAssignment(list: Domain[], table: string, domainId: string | null): Domain[] {
  return list.map((d) => ({
    ...d,
    tables:
      d.id === domainId
        ? [...d.tables.filter((n) => n !== table), table]
        : d.tables.filter((n) => n !== table),
  }))
}
