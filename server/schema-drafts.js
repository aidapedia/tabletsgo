/**
 * Standalone schema drafts — a diagram that belongs to a *workspace* rather
 * than to a connection.
 *
 * The schema designer normally works against a live database: it reads the
 * existing tables to draw them and stages DDL to run against them. A draft
 * started "from scratch" has no database behind it, so the one thing the
 * connection would have answered — which dialect to write DDL in — is stored
 * on the row instead (`dbType`).
 *
 * Drafts designed against a connection are *not* here: those stay saved queries
 * with `kind = 'schema'`, because they belong to that connection and travel
 * with it (export bundle, delete cascade). This module owns only the
 * connection-less kind, and `schema_drafts` is its table.
 */

import { randomUUID } from 'crypto'
import { meta } from './meta.js'

const row = (r) =>
  r && {
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    dbType: r.db_type,
    sql: r.sql || '',
    createdBy: r.created_by || null,
    ts: r.ts,
  }

// Statements are joined by `;`, the same shape a saved schema query has — so
// the editor seeds a tab from either kind with the one splitter
// (src/shared/lib/schemaDraft.js).
export const statementCount = (sql) =>
  String(sql || '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean).length

export function listDrafts(workspaceId) {
  return meta
    .prepare('SELECT * FROM schema_drafts WHERE workspace_id = ? ORDER BY ts DESC')
    .all(workspaceId)
    .map(row)
}

export function getDraft(id) {
  return row(meta.prepare('SELECT * FROM schema_drafts WHERE id = ?').get(id))
}

export function createDraft({ workspaceId, name, dbType, sql = '', createdBy = null }) {
  const entry = { id: randomUUID(), workspaceId, name, dbType, sql, createdBy, ts: Date.now() }
  meta
    .prepare(
      'INSERT INTO schema_drafts (id, workspace_id, name, db_type, sql, created_by, ts) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(entry.id, entry.workspaceId, entry.name, entry.dbType, entry.sql, entry.createdBy, entry.ts)
  return entry
}

// Partial update — only the fields present are written, so saving the diagram
// doesn't have to resend the name (and renaming doesn't have to resend the DDL).
export function updateDraft(id, fields = {}) {
  const sets = []
  const values = []
  if (typeof fields.name === 'string') {
    sets.push('name = ?')
    values.push(fields.name)
  }
  if (typeof fields.sql === 'string') {
    sets.push('sql = ?')
    values.push(fields.sql)
  }
  if (!sets.length) return getDraft(id)
  sets.push('ts = ?')
  values.push(Date.now())
  meta.prepare(`UPDATE schema_drafts SET ${sets.join(', ')} WHERE id = ?`).run(...values, id)
  return getDraft(id)
}

export function deleteDraft(id) {
  meta.prepare('DELETE FROM schema_drafts WHERE id = ?').run(id)
}

// Every workspace draft dies with the workspace — nothing else points at these
// rows, so there is no orphan to reparent.
export function deleteDraftsForWorkspace(workspaceId) {
  meta.prepare('DELETE FROM schema_drafts WHERE workspace_id = ?').run(workspaceId)
}
