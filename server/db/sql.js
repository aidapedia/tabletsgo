/**
 * Dialect-agnostic SQL text utilities, shared by the SQL drivers.
 *
 * Nothing here talks to a database: it's lexing, statement classification and
 * the parts of the query analyzer that are the same whichever engine produced
 * the plan. Each driver contributes its own EXPLAIN handling on top.
 */

// Hidden field carrying each row's physical row id (SQLite rowid / Postgres
// ctid) on tables that have no primary key. It rides along in the row objects
// but never in the `columns` list, so it stays out of the grid, exports and
// INSERTs — the console uses it to target the exact row it displayed. Matching
// every column instead is fragile (a JSON/float/timestamp value that doesn't
// round-trip never matches) and plain wrong on a table with duplicate rows,
// where it rewrites all of them at once.
export const ROW_ID_COLUMN = '__tg_rowid'

export const quoteIdent = (name) => `"${String(name).replace(/"/g, '""')}"`

// Strip -- and /* */ comments, respecting string literals.
export function stripSqlComments(sql) {
  let out = ''
  let i = 0
  let quote = null // ', ", or `
  while (i < sql.length) {
    const ch = sql[i]
    if (quote) {
      out += ch
      if (ch === quote) quote = null
      i++
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
      out += ch
      i++
      continue
    }
    if (ch === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++
      continue
    }
    if (ch === '/' && sql[i + 1] === '*') {
      i += 2
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++
      i += 2
      out += ' '
      continue
    }
    out += ch
    i++
  }
  return out
}

// Split on ';' outside string literals. Used only to reject multi-statement
// input — the analyzer works on exactly one statement.
export function splitSqlStatements(sql) {
  const parts = []
  let cur = ''
  let quote = null
  for (const ch of sql) {
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
      parts.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  parts.push(cur)
  return parts.map((p) => p.trim()).filter(Boolean)
}

// Classify the statement to pick the safe analysis mode. Returns
// { kind: 'select' | 'dml', readOnly } or throws for unsupported statements.
// A SELECT counts as read-only only when no write keyword appears anywhere
// (covers data-modifying CTEs); a false positive merely downgrades to
// estimates, never executes anything.
export function classifyStatement(sql) {
  const first = (sql.match(/^\s*([a-z]+)/i)?.[1] || '').toLowerCase()
  if (first === 'select' || first === 'with' || first === 'values') {
    const readOnly = !/\b(insert|update|delete|merge|replace)\b/i.test(sql)
    return { kind: 'select', readOnly }
  }
  if (first === 'insert' || first === 'update' || first === 'delete' || first === 'replace' || first === 'merge') {
    return { kind: 'dml', readOnly: false }
  }
  throw new Error('Only SELECT and data-modification statements can be analyzed.')
}

// Candidate columns referenced in WHERE/ON comparisons and ORDER BY. Regex
// extraction only — each candidate is validated against the table's real
// column list before use, so sloppiness here is harmless.
export function extractQueryColumns(sql) {
  // For UPDATE/DELETE only the WHERE clause matters — SET assignments would
  // otherwise read as comparisons and pollute the index suggestion.
  let scope = sql
  if (/^\s*(update|delete)\b/i.test(sql)) {
    const w = sql.search(/\bwhere\b/i)
    scope = w >= 0 ? sql.slice(w) : ''
  }
  const where = []
  const compRe = /(?:"([^"]+)"|\b([a-z_][\w]*))\s*(?:=|<>|!=|<=|>=|<|>|\s+(?:not\s+)?(?:in|like|between|is)\b)/gi
  let m
  while ((m = compRe.exec(scope))) {
    const name = (m[1] || m[2] || '').split('.').pop()
    if (name && !/^(select|from|where|and|or|not|on|join|inner|left|right|outer|as|case|when|then|else|end|null|true|false|in|like|between|is|exists)$/i.test(name)) {
      where.push(name)
    }
  }
  const orderBy = []
  const om = sql.match(/\border\s+by\b([\s\S]*?)(\blimit\b|\boffset\b|$)/i)
  if (om) {
    for (const part of om[1].split(',')) {
      const col = part
        .replace(/\b(asc|desc|nulls\s+(first|last))\b/gi, '')
        .trim()
        .replace(/^"|"$/g, '')
        .split('.')
        .pop()
      if (col && /^[\w]+$/.test(col)) orderBy.push(col)
    }
  }
  return { where: [...new Set(where)], orderBy: [...new Set(orderBy)] }
}

export function buildIndexDdl(table, columns, schema) {
  const base = `idx_${table}_${columns.join('_')}`.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 60)
  const target = schema && schema !== 'public' ? `${quoteIdent(schema)}.${quoteIdent(table)}` : quoteIdent(table)
  return `CREATE INDEX ${quoteIdent(base)} ON ${target} (${columns.map(quoteIdent).join(', ')});`
}

// True when an existing index already leads with the suggestion's first
// column — the case where a new index would be redundant.
export function hasCoveringIndex(existing, columns) {
  const lead = (columns[0] || '').toLowerCase()
  return existing.some((idx) => (idx.columns || '').split(',')[0]?.trim().toLowerCase() === lead)
}

// Filter suggestion candidates down to real columns and dedupe.
export function makeIndexSuggestion(table, candidates, realColumns, existingIndexes, reason, schema) {
  const real = new Set(realColumns.map((c) => c.name.toLowerCase()))
  const cols = candidates.filter((c) => real.has(c.toLowerCase()))
  if (!cols.length || hasCoveringIndex(existingIndexes, cols)) return null
  return { table, columns: cols, reason, ddl: buildIndexDdl(table, cols, schema) }
}

// Query-level suggestions shared by both dialects.
export function queryLevelSuggestions(sql, plan, primaryTableColumnCount) {
  const out = []
  if (/select\s+\*/i.test(sql) && primaryTableColumnCount > 10) {
    out.push({ code: 'select-star', message: `SELECT * fetches ${primaryTableColumnCount} columns; select only the columns you need.` })
  }
  if (/\blike\s+'%/i.test(sql)) {
    out.push({ code: 'leading-wildcard-like', message: "LIKE with a leading wildcard ('%…') cannot use an index — consider full-text search or a suffix strategy." })
  }
  const hasFullScan = plan.some((p) => p.warning && /full table scan/i.test(p.warning))
  if (hasFullScan && !/\blimit\b/i.test(sql) && !/\b(count|sum|avg|min|max|group\s+by)\b/i.test(sql)) {
    out.push({ code: 'full-scan-no-limit', message: 'Full table scan without LIMIT may return the whole table — add a LIMIT or a WHERE clause an index can serve.' })
  }
  return out
}
