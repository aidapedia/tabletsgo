// How SQL is spelled for each engine that speaks it. Anything the UI writes for a
// database goes through here: a MySQL `"x"` is a string rather than a name, and a
// backslash inside a MySQL string escapes the next character.

export type SqlDialect = 'postgresql' | 'mysql' | 'sqlite'

export const sqlDialectOf = (type?: string): SqlDialect => (type === 'postgresql' || type === 'mysql' ? type : 'sqlite')

export const quoteIdent = (name: string, dialect: SqlDialect) =>
  dialect === 'mysql' ? `\`${String(name).replace(/`/g, '``')}\`` : `"${String(name).replace(/"/g, '""')}"`

export const quoteString = (value: string, dialect: SqlDialect) => {
  const text = dialect === 'mysql' ? String(value).replace(/\\/g, '\\\\') : String(value)
  return `'${text.replace(/'/g, "''")}'`
}

// Regex source reading a quoted identifier in either spelling, capturing the name
// — for the parsers that read staged DDL back, which may be a draft of any engine.
export const IDENT = '["`]([^"`]+)["`]'

export const unquoteIdent = (text: string) => text.trim().replace(/^["`]|["`]$/g, '')
