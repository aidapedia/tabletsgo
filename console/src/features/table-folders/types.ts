import type { Folder } from '@/shared/api/folders'

// A table folder is a generic folder (type='table') that groups a connection's
// tables: a name, an optional color and the table names inside it. Each table
// belongs to at most one folder; folders nest up to MAX_TABLE_FOLDER_DEPTH.
// Superseded the old "domains" concept — meta migration v5 folded every domain
// into the folders tree, keeping its id, name and color.
export type TableFolder = Folder & { tables: string[] }

// Table folders nest like dashboard/workflow folders (server-enforced).
export const MAX_TABLE_FOLDER_DEPTH = 3

// The palette offered when creating/editing a folder. Kept small and legible in
// both themes; the first entry is the default for a new folder.
export const FOLDER_COLORS = [
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
