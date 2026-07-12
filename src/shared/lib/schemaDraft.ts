// Helpers for schema-editor pending change items (shared by the editor + workspace).

let pid = 0
export const newItemId = () => ++pid

// Split a saved draft's SQL back into pending items ({ id, sql, table, mode }).
export function draftToItems(sql) {
  return (sql || '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const create = s.match(/^\s*CREATE TABLE\s+"([^"]+)"/i)
      if (create) return { id: newItemId(), sql: `${s};`, table: create[1], mode: 'new' }
      const drop = s.match(/^\s*DROP TABLE\s+(?:IF EXISTS\s+)?"([^"]+)"/i)
      if (drop) return { id: newItemId(), sql: `${s};`, table: drop[1], mode: 'delete' }
      const alter = s.match(/^\s*ALTER TABLE\s+"([^"]+)"/i)
      return { id: newItemId(), sql: `${s};`, table: alter ? alter[1] : '', mode: 'edit' }
    })
}
