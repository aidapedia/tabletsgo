/**
 * How many sessions a connection may hold at once.
 *
 * Two levels, most specific first: the workspace default
 * (`settings.sessions.maxPerConnection`), then the instance-wide
 * MAX_SESSIONS_PER_CONNECTION env fallback. 0 (or unset) at both levels means
 * unlimited — that's the shipped default, so nothing changes for an install
 * that never configures a limit.
 *
 * There is deliberately no per-connection override: a cap protects the database
 * server, and who may set one is a workspace-owner decision, not something to
 * re-answer on every connection. (`connections.max_sessions` still exists as a
 * column — migrations are additive-only — but nothing reads it.)
 */

import { MAX_SESSIONS_PER_CONNECTION } from '../config.js'
import { meta } from '../meta.js'
import { safeJson } from '../util.js'

const positive = (v) => {
  const n = parseInt(v, 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

// The workspace-wide default, or 0 when the workspace doesn't set one.
export function workspaceMaxSessions(workspaceId) {
  if (!workspaceId) return 0
  const row = meta.prepare('SELECT settings FROM workspaces WHERE id = ?').get(workspaceId)
  return positive(safeJson(row?.settings).sessions?.maxPerConnection)
}

/**
 * The effective limit for a connection: `{ max, source }` where `max` 0 means
 * unlimited. `source` is what the UI shows next to the number so a user can
 * tell which level the limit came from.
 */
export function resolveMaxSessions(conn) {
  const ws = workspaceMaxSessions(conn?.workspaceId)
  if (ws) return { max: ws, source: 'workspace' }
  const instance = positive(MAX_SESSIONS_PER_CONNECTION)
  if (instance) return { max: instance, source: 'instance' }
  return { max: 0, source: 'unlimited' }
}
