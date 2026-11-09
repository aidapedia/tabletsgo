/**
 * One entry of a SQL engine's command reference: a statement, clause or
 * function the SQL editor lists beside the buffer. `since` is the release that
 * introduced it — left out for what every release the app can reach has had.
 */
export type SqlCommand = {
  /** Upper-case and unique per engine — the reference filters and looks docs up by it. */
  name: string
  /** Argument template, e.g. `table [(column, …)] VALUES (…)`. */
  args: string
  group: string
  since?: string
  summary: string
  /** True when it changes data or schema, false when it never does; unset when it depends. */
  writes?: boolean
  /** Inserted into the editor instead of `NAME ` — for a clause, a template reads better. */
  insert?: string
  details?: string[]
  options?: { name: string; desc: string }[]
  returns?: string
  examples?: { command: string; note?: string; response?: string }[]
  notes?: string[]
  /** Page on the engine's own docs site, relative to `docsBase`. */
  doc?: string
}

export type SqlReference = {
  /** "SQLite", "PostgreSQL" — how versions and links are labelled. */
  engine: string
  docsBase: string
  /** Display names for `group`, in the order the reference lists them. */
  groups: Record<string, string>
  commands: SqlCommand[]
}
