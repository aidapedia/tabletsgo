import { request, safeRequest } from '@/shared/api/request'

// ---- Connection access (which teams/members may see a connection) ----
// The team/member domain lives in `features/workspaces`; this endpoint is
// connection-scoped, so its client belongs here.
export type ConnectionAccess = { teams: string[]; users: string[] }

export async function getConnectionAccess(connectionId: string) {
  return safeRequest<ConnectionAccess>(`/connections/${connectionId}/access`, { teams: [], users: [] })
}
export async function setConnectionAccess(connectionId: string, access: ConnectionAccess) {
  return request<ConnectionAccess>(`/connections/${connectionId}/access`, { method: 'PUT', body: access })
}

// ---- Connection export / import ----
// One JSON document per connection: its settings plus every artifact hanging
// off it (folders, table grouping, saved queries, workflows, dashboards, backup
// schedule). The server owns the shape (see buildConnectionExport in server.js);
// the client only reads the counts it shows in the import summary, so the
// payload stays opaque and dialect-agnostic.
export type ConnectionExport = {
  kind: 'connection'
  version: number
  exportedAt: number
  app?: { name?: string; version?: string }
  /** False when the export was taken without the stored password (the default). */
  includesSecrets: boolean
  connection: { type: string; name: string; environment?: string | null; folder?: string; tags?: string[]; settings: Record<string, any> }
  folders: any[]
  tableFolders: any[]
  savedQueries: any[]
  workflows: any[]
  dashboards: any[]
  backupSchedule: any | null
}

export type ImportedCounts = { folders: number; tables: number; savedQueries: number; workflows: number; dashboards: number }
export type ImportResult = { connection: any; counts: ImportedCounts; warnings: string[] }

export async function exportConnection(connectionId: string, includeSecrets = false) {
  return request<ConnectionExport>(`/connections/${connectionId}/export${includeSecrets ? '?secrets=1' : ''}`)
}

/** Create a new connection from an export document. `settings` overrides
 *  individual credential fields (e.g. a password the file didn't carry). */
export async function importConnection(body: {
  workspaceId: string
  document: ConnectionExport
  name?: string
  settings?: Record<string, any>
}) {
  return request<ImportResult>('/connections/import', { method: 'POST', body })
}

/** Parse + shallow-validate a picked file. Throws a user-facing message. */
export async function readConnectionExportFile(file: File): Promise<ConnectionExport> {
  let doc: any
  try {
    doc = JSON.parse(await file.text())
  } catch {
    throw new Error("That file isn't valid JSON.")
  }
  if (doc?.kind !== 'connection' || !doc?.connection?.type) throw new Error('Not a connection export file.')
  return doc as ConnectionExport
}

/** Download an export document as `<name>.connection.json`. */
export function downloadConnectionExport(doc: ConnectionExport) {
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${(doc.connection.name || 'connection').replace(/[^\w-]+/g, '-').toLowerCase()}.connection.json`
  a.click()
  URL.revokeObjectURL(url)
}
