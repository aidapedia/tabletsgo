// Dynamic-variable plumbing: parse a static value list, resolve query-backed
// options, and substitute `{{name}}` placeholders into widget SQL.

import { runQuery } from '@/shared/api/database'
import type { DashboardVariable, VariableValues } from '../types'
import { firstRows, type QueryResult } from './queryData'

export type VariableOption = { value: string; label: string }

/** Parse a static list: `1, 2, "local"` → ['1', '2', 'local']. */
export function parseStaticValues(values = ''): VariableOption[] {
  return values
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const unquoted = s.replace(/^["']|["']$/g, '')
      return { value: unquoted, label: unquoted }
    })
}

/**
 * Resolve a variable's selectable options. Query-backed variables read the
 * first column as the value and the (optional) second column as the label —
 * e.g. `SELECT id, name FROM events`.
 */
export async function resolveVariableOptions(conn: any, variable: DashboardVariable): Promise<VariableOption[]> {
  if (variable.source === 'static') return parseStaticValues(variable.values)
  if (!variable.query?.trim()) return []
  const result = (await runQuery(conn, variable.query)) as QueryResult
  if (result?.error) throw new Error(result.error)
  const { columns, rows } = firstRows(result)
  if (!columns.length) return []
  return rows.map((row) => {
    const value = String(cell(row, columns, 0) ?? '')
    const label = columns.length > 1 ? String(cell(row, columns, 1) ?? value) : value
    return { value, label }
  })
}

function cell(row: any, columns: string[], idx: number) {
  return Array.isArray(row) ? row[idx] : row[columns[idx]]
}

/** Is a variable's selection present? Guards SQL from running with an unresolved
 *  `{{name}}`. An empty string or empty multi-select array both count as unset. */
export function isVariableSet(value: string | string[] | undefined): boolean {
  if (Array.isArray(value)) return value.length > 0
  return value !== undefined && value !== ''
}

// Render one selected value as a SQL literal: bare for numbers, single-quoted
// (with '' escaping) otherwise. Matches the dialect-agnostic literal rules used
// across the roadmap dialects (SQLite/PostgreSQL/…).
function sqlLiteral(v: string): string {
  return /^-?\d+(\.\d+)?$/.test(v.trim()) ? v.trim() : `'${v.replace(/'/g, "''")}'`
}

/**
 * Replace every `{{name}}` (whitespace-tolerant) with its selected value.
 * A single value is inserted raw (unchanged, backwards-compatible). A multi-select
 * array becomes a comma-separated SQL list of literals for use inside `IN (...)` —
 * e.g. `WHERE status IN ({{status}})` → `IN ('active','pending')`.
 */
export function substituteVariables(sql: string, values: VariableValues): string {
  return sql.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (match, name) => {
    if (!(name in values)) return match
    const v = values[name]
    return Array.isArray(v) ? v.map(sqlLiteral).join(',') : v
  })
}

/** Variable names referenced by a piece of SQL (for the editor hint). */
export function referencedVariables(sql = ''): string[] {
  const names = new Set<string>()
  for (const m of sql.matchAll(/\{\{\s*([\w-]+)\s*\}\}/g)) names.add(m[1])
  return [...names]
}
