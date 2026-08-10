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
import { safeJson } from './util.js'

const row = (r) =>
  r && {
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    dbType: r.db_type,
    sql: r.sql || '',
    // The diagram's arrangement — table/group/note positions. Stored as one
    // JSON document (see migration v19) and handed back parsed, because the
    // editor reads and writes it whole; a draft that predates a save has none,
    // and null is what tells the editor to arrange the diagram itself.
    layout: r.layout ? safeJson(r.layout) : null,
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

// The diagram arrangement a draft may carry, validated down to "a JSON object
// or nothing". Both kinds of draft store one (a from-scratch row here, a
// connection draft in saved_queries), so the shape check lives with the module
// that owns the concept rather than being written twice in the routes. The
// contents are the editor's — the server never reads inside it.
export const schemaLayout = (value) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : null

export function listDrafts(workspaceId) {
  return meta
    .prepare('SELECT * FROM schema_drafts WHERE workspace_id = ? ORDER BY ts DESC')
    .all(workspaceId)
    .map(row)
}

export function getDraft(id) {
  return row(meta.prepare('SELECT * FROM schema_drafts WHERE id = ?').get(id))
}

export function createDraft({ workspaceId, name, dbType, sql = '', layout = null, createdBy = null }) {
  const entry = { id: randomUUID(), workspaceId, name, dbType, sql, layout: schemaLayout(layout), createdBy, ts: Date.now() }
  meta
    .prepare(
      'INSERT INTO schema_drafts (id, workspace_id, name, db_type, sql, layout, created_by, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      entry.id,
      entry.workspaceId,
      entry.name,
      entry.dbType,
      entry.sql,
      entry.layout ? JSON.stringify(entry.layout) : null,
      entry.createdBy,
      entry.ts
    )
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
  // `layout` travels with the diagram, not with the DDL: saving the editor
  // sends both, a rename sends neither. An explicit null clears it.
  if (fields.layout !== undefined) {
    sets.push('layout = ?')
    const layout = schemaLayout(fields.layout)
    values.push(layout ? JSON.stringify(layout) : null)
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
