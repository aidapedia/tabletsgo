// A domain is a named, colored grouping of a connection's tables. Each table
// belongs to at most one domain. `tables` lists the tables grouped under it.
export type Domain = {
  id: string
  name: string
  color: string | null
  ts: number
  tables: string[]
}

// The palette offered when creating/editing a domain. Kept small and legible in
// both themes; the first entry is the default for a new domain.
export const DOMAIN_COLORS = [
  '#6366f1', // indigo
  '#3b82f6', // blue
  '#06b6d4', // cyan
  '#10b981', // emerald
  '#84cc16', // lime
  '#eab308', // amber
  '#f97316', // orange
  '#ef4444', // red
  '#ec4899', // pink
  '#a855f7', // purple
  '#64748b', // slate
] as const
