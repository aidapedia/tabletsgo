/**
 * The connection record store.
 *
 * Dialect-agnostic fields (`type`, `name`, `workspace_id`, `environment`,
 * `folder`, `tags`, `schema_version`) are plain columns; everything else
 * (host/port/username/password/filepath/database/uri/sslmode/tls/auth/…) is one
 * AES-256-GCM-encrypted JSON blob in `credentials`.
 *
 * `rowToConnection`/`connectionToRow` reassemble and split the flat connection
 * shape the frontend has always used, so no client code — and no database
 * driver — needs to know how storage is laid out.
 */

import { db, transaction } from './meta.js'
import { decryptSecret, encryptSecret } from './crypto.js'

// Owner display fields for a set of rows, in one query: userId -> { name, username }.
const ownersOf = async (rows) => {
  const ids = [...new Set(rows.map((r) => r?.owner_id).filter(Boolean))]
  if (!ids.length) return new Map()
  const users = await db().users.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, username: true } })
  return new Map(users.map((u) => [u.id, u]))
}

// `owners` is what ownersOf() returned for the batch this row came from.
function toConnection(row, owners) {
  if (!row) return null
  let credentials = {}
  if (row.credentials) {
    try {
      credentials = JSON.parse(decryptSecret(row.credentials))
    } catch {
      credentials = {}
    }
  }
  let tags = []
  try {
    tags = JSON.parse(row.tags || '[]')
  } catch {
    tags = []
  }
  // Resolve the owner's display fields (best-effort) so the detail view can show
  // who owns the connection without a second round-trip.
  let ownerName, ownerEmail
  const u = row.owner_id ? owners.get(row.owner_id) : null
  if (u) {
    ownerName = u.name || u.username
    ownerEmail = u.username
  }
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    workspaceId: row.workspace_id || undefined,
    environment: row.environment || undefined,
    folder: row.folder || '',
    tags,
    schemaVersion: row.schema_version || 1,
    ...credentials,
    ownerId: row.owner_id || undefined,
    ownerName,
    ownerEmail,
  }
}

export const rowToConnection = async (row) => (row ? toConnection(row, await ownersOf([row])) : null)

// Split a flat connection object back into row columns + encrypted credentials.
// Owner + resolved owner display fields are peeled off so they never end up in
// the encrypted credentials blob. `maxSessions` is peeled off for the same
// reason and then dropped: the per-connection cap is gone (the limit resolves
// workspace → instance now, see server/sessions/limits.js), but an older client
// or an exported bundle may still send the field, and it must not become an
// encrypted credential.
export function connectionToRow(conn) {
  const { id, type, name, workspaceId, environment, folder, tags, schemaVersion, maxSessions, ownerId, ownerName, ownerEmail, ...credentials } = conn
  return {
    id,
    type: type || null,
    name: name || null,
    workspace_id: workspaceId || null,
    environment: environment || null,
    folder: folder || '',
    tags: JSON.stringify(tags || []),
    credentials: encryptSecret(JSON.stringify(credentials)),
    schema_version: schemaVersion || 1,
    owner_id: ownerId || null,
  }
}

export const listConnections = async () => {
  const rows = await db().connections.findMany({ orderBy: { created_at: 'asc' } })
  const owners = await ownersOf(rows)
  return rows.map((row) => toConnection(row, owners))
}

export const getConnection = async (id) => (id ? rowToConnection(await db().connections.findUnique({ where: { id } })) : null)

export const saveConnection = async (conn) => {
  const { id, ...row } = connectionToRow(conn)
  const now = Date.now()
  // `data` is a placeholder — installs predating its removal created it as
  // `data TEXT NOT NULL`, so every write must still supply *something*.
  // `max_sessions` is left out on purpose: the column stays (migrations are
  // additive-only) but nothing reads it any more, so it falls back to its
  // DEFAULT 0.
  await db().connections.upsert({
    where: { id },
    create: { id, ...row, data: '{}', created_at: now, updated_at: now },
    update: { ...row, data: '{}', updated_at: now },
  })
}

// Every table holding rows that belong to one connection (by `connection_id`).
export const CONNECTION_TABLES = [
  'saved_queries',
  'connection_tables',
  'workflows',
  'workflow_runs',
  'dashboards',
  'folders',
  'query_history',
  'connection_access',
  'schema_migrations',
  'backup_schedules',
  'backup_runs',
]

// One metadata cascade for both connection deletion and workspace deletion.
// History and backup rows are instance-specific (so they are not exported), but
// they still belong to the connection and must be removed with it. The caller
// removes the mirrored resource node in the same outer transaction.
export const deleteConnectionMetadata = async (id) =>
  transaction(async () => {
    for (const table of CONNECTION_TABLES) await db()[table].deleteMany({ where: { connection_id: id } })
    await db().connections.deleteMany({ where: { id } })
  })

// Bump a connection's schema version after a successful DDL commit. Direct
// column update — avoids round-tripping (and re-encrypting) the full row.
export const bumpSchemaVersion = async (id) => {
  const rows = await db().connections.updateManyAndReturn({
    where: { id },
    data: { schema_version: { increment: 1 }, updated_at: Date.now() },
    select: { schema_version: true },
  })
  return rows[0]?.schema_version
}

export const setSchemaVersion = async (id, version) =>
  db().connections.updateMany({ where: { id }, data: { schema_version: version, updated_at: Date.now() } })
