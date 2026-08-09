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

import { meta } from './meta.js'
import { decryptSecret, encryptSecret } from './crypto.js'

export function rowToConnection(row) {
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
  if (row.owner_id) {
    const u = meta.prepare('SELECT name, username FROM users WHERE id = ?').get(row.owner_id)
    if (u) {
      ownerName = u.name || u.username
      ownerEmail = u.username
    }
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

export const listConnections = () => meta.prepare('SELECT * FROM connections ORDER BY created_at').all().map(rowToConnection)

export const getConnection = (id) => rowToConnection(meta.prepare('SELECT * FROM connections WHERE id = ?').get(id))

export const saveConnection = (conn) => {
  const row = connectionToRow(conn)
  const now = Date.now()
  meta
    .prepare(
      // `data` is a placeholder — installs predating this migration created it
      // as `data TEXT NOT NULL`, so every write must still supply *something*.
      // `max_sessions` is left out on purpose: the column stays (migrations are
      // additive-only) but nothing reads it any more, so it falls back to
      // its DEFAULT 0.
      `INSERT OR REPLACE INTO connections
       (id, type, name, workspace_id, environment, folder, tags, credentials, schema_version, owner_id, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', COALESCE((SELECT created_at FROM connections WHERE id = ?), ?), ?)`
    )
    .run(row.id, row.type, row.name, row.workspace_id, row.environment, row.folder, row.tags, row.credentials, row.schema_version, row.owner_id, row.id, now, now)
}

export const deleteConnectionRow = (id) => meta.prepare('DELETE FROM connections WHERE id = ?').run(id)

// Bump a connection's schema version after a successful DDL commit. Direct
// column update — avoids round-tripping (and re-encrypting) the full row.
export const bumpSchemaVersion = (id) => {
  meta.prepare('UPDATE connections SET schema_version = schema_version + 1, updated_at = ? WHERE id = ?').run(Date.now(), id)
  return meta.prepare('SELECT schema_version FROM connections WHERE id = ?').get(id)?.schema_version
}

export const setSchemaVersion = (id, version) =>
  meta.prepare('UPDATE connections SET schema_version = ?, updated_at = ? WHERE id = ?').run(version, Date.now(), id)
