// Helpers for schema-editor pending change items (shared by the editor + workspace).

let pid = 0
export const newItemId = () => ++pid

// Split SQL into trimmed statements on unquoted semicolons — a `;` inside a
// string literal or a quoted identifier (e.g. a DEFAULT 'a;b') is not a
// separator. Mirrors server/db/sql.js's splitSqlStatements so what the client
// stages is what the server will run.
export function splitStatements(sql) {
  const out = []
  let cur = ''
  let quote = null
  for (const ch of sql || '') {
    if (quote) {
      cur += ch
      if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
      cur += ch
      continue
    }
    if (ch === ';') {
      out.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  out.push(cur)
  return out.map((s) => s.trim()).filter(Boolean)
}

// Split a saved draft's SQL back into pending items ({ id, sql, table, mode }).
export function draftToItems(sql) {
  return splitStatements(sql).map((s) => {
    const create = s.match(/^\s*CREATE TABLE\s+"([^"]+)"/i)
    if (create) return { id: newItemId(), sql: `${s};`, table: create[1], mode: 'new' }
    const drop = s.match(/^\s*DROP TABLE\s+(?:IF EXISTS\s+)?"([^"]+)"/i)
    if (drop) return { id: newItemId(), sql: `${s};`, table: drop[1], mode: 'delete' }
    const alter = s.match(/^\s*ALTER TABLE\s+"([^"]+)"/i)
    return { id: newItemId(), sql: `${s};`, table: alter ? alter[1] : '', mode: 'edit' }
  })
}
