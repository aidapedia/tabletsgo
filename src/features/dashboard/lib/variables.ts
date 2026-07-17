// Dynamic-variable plumbing: parse a static value list, resolve query-backed
// options, and substitute `{{name}}` placeholders into widget SQL.

import { runQuery } from '@/shared/api/database'
import type { DashboardVariable } from '../types'
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

/** Replace every `{{name}}` (whitespace-tolerant) with its selected value. */
export function substituteVariables(sql: string, values: Record<string, string>): string {
  return sql.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (match, name) => (name in values ? values[name] : match))
}

/** Variable names referenced by a piece of SQL (for the editor hint). */
export function referencedVariables(sql = ''): string[] {
  const names = new Set<string>()
  for (const m of sql.matchAll(/\{\{\s*([\w-]+)\s*\}\}/g)) names.add(m[1])
  return [...names]
}
