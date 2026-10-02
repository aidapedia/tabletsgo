/** Translate the metadata store's positional SQL without touching quoted text. */
export function postgresSql(sql) {
  let quote = null
  let lineComment = false
  let blockComment = false
  let param = 0
  let out = ''
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i], next = sql[i + 1]
    if (lineComment) {
      out += ch
      if (ch === '\n') lineComment = false
    } else if (blockComment) {
      out += ch
      if (ch === '*' && next === '/') { out += next; i++; blockComment = false }
    } else if (quote) {
      out += ch
      if (ch === quote) {
        if (next === quote) { out += next; i++ }
        else quote = null
      }
    } else if (ch === '-' && next === '-') { out += ch + next; i++; lineComment = true }
    else if (ch === '/' && next === '*') { out += ch + next; i++; blockComment = true }
    else if (ch === "'" || ch === '"') { out += ch; quote = ch }
    else if (ch === '?') out += `$${++param}`
    else out += ch
  }
  if (/^\s*INSERT\s+OR\s+IGNORE\s+INTO\b/i.test(out)) {
    out = out.replace(/INSERT\s+OR\s+IGNORE\s+INTO/i, 'INSERT INTO').trimEnd() + ' ON CONFLICT DO NOTHING'
  }
  return out
}
