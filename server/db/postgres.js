/**
 * PostgreSQL driver.
 *
 * Implements the generic driver contract described in server/db/index.js. `ctx`
 * carries { database, schema }: a pool is kept per (connection, database) so the
 * console can browse other databases on the same server with the same
 * credentials, and `schema` defaults to 'public' everywhere.
 */

import { promisify } from 'util'
import { execFile } from 'child_process'
import pkg from 'pg'
import {
  ROW_ID_COLUMN,
  makeIndexSuggestion,
  queryLevelSuggestions,
  quoteIdent,
} from './sql.js'

const { Client, Pool } = pkg
const execFileAsync = promisify(execFile)

// A pool per (connection, database).
const pools = new Map()

// `pg_proc.prokind` only exists on PostgreSQL 11+; older servers (and some
// wire-compatible ones, e.g. Redshift) classify functions with the proisagg /
// proiswindow booleans instead. A server can't change version under a live
// pool, so cache the lookup per pool.
const poolVersions = new WeakMap()

// Build a node-postgres client/pool config from a stored connection.
// Handles optional database, "no authentication" mode, and SSL modes.
export function pgConfig(config) {
  const noAuth = config.auth === 'none'
  const ssl =
    !config.sslmode || config.sslmode === 'disable'
      ? false
      : { rejectUnauthorized: config.sslmode === 'verify-full' }
  return {
    host: config.host,
    port: parseInt(config.port) || 5432,
    user: noAuth ? undefined : config.username || undefined,
    password: noAuth ? undefined : config.password || undefined,
    database: config.database || undefined,
    ssl,
  }
}

function poolFor(conn, ctx = {}) {
  const db = ctx.database || conn.database
  const key = `${conn.id}::${db || ''}`
  if (!pools.has(key)) pools.set(key, new Pool(pgConfig({ ...conn, database: db })))
  return pools.get(key)
}

const schemaOf = (ctx = {}) => ctx.schema || 'public'

export const postgresDriver = {
  type: 'postgresql',
  label: 'PostgreSQL',
  // Postgres uses the database's own type vocabulary (matching what /columns
  // reports) so the same list is consistent for existing and new columns.
  dataTypes: [
    'serial', 'bigserial', 'smallint', 'integer', 'bigint', 'numeric', 'real', 'double precision',
    'boolean', 'text', 'character varying', 'character', 'date', 'time without time zone',
    'timestamp without time zone', 'timestamp with time zone', 'json', 'jsonb', 'uuid',
  ],

  // ---- Lifecycle ----
  async testConnection(config) {
    const client = new Client(pgConfig(config))
    await client.connect()
    try {
      const { rows } = await client.query('SELECT current_database() AS db')
      return { ok: true, message: `Connected to PostgreSQL${rows[0]?.db ? ` (${rows[0].db})` : ''}!` }
    } finally {
      await client.end()
    }
  },

  // What the generic classifier can't read: SQLSTATEs and the handful of
  // libpq messages that have a specific fix. Anything else falls through to
  // the transport classification in ./diagnose.js.
  explainError(error) {
    const code = error?.code || ''
    const message = error?.message || ''
    if (code === '28P01' || code === '28000' || /password authentication failed/i.test(message)) {
      return {
        reason: 'auth',
        cause: 'PostgreSQL rejected the username or password.',
        hint: 'Re-enter the credentials in the connection settings; a rotated password is the usual cause.',
      }
    }
    if (code === '3D000' || /database ".*" does not exist/i.test(message)) {
      return {
        reason: 'missing_database',
        cause: 'That database does not exist on this server.',
        hint: 'Check the "Database" field — the server is reachable, only the database name is wrong.',
      }
    }
    if (code === '53300' || /too many clients/i.test(message)) {
      return {
        reason: 'busy',
        cause: 'The server has reached its connection limit.',
        hint: 'Free up connections (or raise max_connections) and try again.',
      }
    }
    if (code === '57P03' || /the database system is (starting up|shutting down|in recovery)/i.test(message)) {
      return {
        reason: 'busy',
        cause: 'The server is not accepting connections yet.',
        hint: 'It is starting up or recovering — retry in a few seconds.',
      }
    }
    if (/no pg_hba\.conf entry/i.test(message)) {
      return {
        reason: 'permission',
        cause: "The server's pg_hba.conf does not allow this client, user or SSL mode.",
        hint: 'Add a pg_hba.conf rule for this server\'s IP and user, and make sure the SSL mode matches what that rule requires.',
      }
    }
    if (/does not support SSL/i.test(message)) {
      return {
        reason: 'tls',
        cause: 'The server does not support SSL, but this connection requires it.',
        hint: 'Set SSL mode to "disable" in the connection settings.',
      }
    }
    if (/SSL (connection )?(is )?required|no encryption/i.test(message)) {
      return {
        reason: 'tls',
        cause: 'The server only accepts SSL connections.',
        hint: 'Set SSL mode to "require" (or "verify-full" if you have the CA) in the connection settings.',
      }
    }
    return null
  },

  release(conn) {
    for (const [key, pool] of pools) {
      if (key === conn.id || key.startsWith(`${conn.id}::`)) {
        pool.end()
        pools.delete(key)
      }
    }
  },

  closeAll() {
    for (const [, pool] of pools) pool.end()
    pools.clear()
  },

  // ---- Introspection ----
  async ping(conn, ctx) {
    await poolFor(conn, ctx).query('SELECT 1')
    return { ok: true }
  },

  async namespaces(conn, ctx) {
    const pool = poolFor(conn, ctx)
    const dbs = await pool.query(`SELECT datname FROM pg_database WHERE datistemplate = false AND datallowconn ORDER BY datname`)
    const schemas = await pool.query(
      `SELECT schema_name FROM information_schema.schemata
       WHERE schema_name NOT LIKE 'pg\\_%' AND schema_name <> 'information_schema'
       ORDER BY schema_name`
    )
    const cur = await pool.query('SELECT current_database() AS db')
    return {
      databases: dbs.rows.map((r) => r.datname),
      schemas: schemas.rows.map((r) => r.schema_name),
      currentDatabase: cur.rows[0]?.db,
    }
  },

  listTables: (conn, ctx) => listTables(poolFor(conn, ctx), schemaOf(ctx)),

  // Generic object list: tables, (materialized) views and functions. Each
  // sub-query is isolated so one failing kind never blanks the whole list.
  async listObjects(conn, ctx) {
    const pool = poolFor(conn, ctx)
    const schema = schemaOf(ctx)
    const out = []
    const safe = async (fn) => {
      try {
        await fn()
      } catch (error) {
        console.error('listObjects (postgres):', error.message)
      }
    }
    await safe(async () => {
      const r = await pool.query(`SELECT tablename AS name FROM pg_tables WHERE schemaname = $1 ORDER BY tablename`, [schema])
      for (const row of r.rows) out.push({ name: row.name, type: 'table', schema })
    })
    await safe(async () => {
      const r = await pool.query(`SELECT viewname AS name FROM pg_views WHERE schemaname = $1 ORDER BY viewname`, [schema])
      for (const row of r.rows) out.push({ name: row.name, type: 'view', schema })
    })
    await safe(async () => {
      const r = await pool.query(`SELECT matviewname AS name FROM pg_matviews WHERE schemaname = $1 ORDER BY matviewname`, [schema])
      for (const row of r.rows) out.push({ name: row.name, type: 'view', schema, materialized: true })
    })
    await safe(async () => {
      const r = await pool.query(
        `SELECT p.proname AS name, pg_get_function_identity_arguments(p.oid) AS args
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = $1 AND ${await plainFunctionFilter(pool)}
         ORDER BY p.proname`,
        [schema]
      )
      for (const row of r.rows) out.push({ name: row.name, type: 'function', schema, detail: row.args || '' })
    })
    return out
  },

  // Function definition(s) for a name (a name may have several overloads).
  async listFunctions(conn, ctx, name) {
    const pool = poolFor(conn, ctx)
    const r = await pool.query(
      `SELECT p.proname AS name,
              pg_get_function_identity_arguments(p.oid) AS args,
              pg_get_functiondef(p.oid) AS definition
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = $1 AND p.proname = $2 AND ${await plainFunctionFilter(pool)}
       ORDER BY p.proname`,
      [schemaOf(ctx), name]
    )
    return r.rows.map((row) => ({ name: row.name, args: row.args || '', definition: row.definition || '' }))
  },

  async getTableData(conn, ctx, { table, limit = 200 }) {
    const pool = poolFor(conn, ctx)
    const schema = schemaOf(ctx)
    try {
      const columns = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = $1 AND table_schema = $2 ORDER BY ordinal_position`,
        [table, schema]
      )
      const columnNames = columns.rows.map((r) => r.column_name)
      const pk = await primaryKeyColumns(pool, table, schema)
      let rows
      if (pk.length) {
        // Order by the primary key. Postgres writes a new tuple version on
        // UPDATE, so an unordered scan returns the edited row at the end of the
        // heap — it jumps to the bottom of the grid, or drops out of view once
        // the table is larger than `limit`, which reads as "my edit wasn't saved".
        const order = pk.map((c) => `"${c}"`).join(', ')
        rows = await pool.query(`SELECT * FROM "${schema}"."${table}" ORDER BY ${order} LIMIT ${limit}`)
      } else {
        // No PK: carry the ctid so edits can target the exact row (see
        // ROW_ID_COLUMN). Only physical tables have one — a view falls back to
        // the plain unordered read.
        try {
          rows = await pool.query(
            `SELECT ctid::text AS "${ROW_ID_COLUMN}", * FROM "${schema}"."${table}" ORDER BY ctid LIMIT ${limit}`
          )
        } catch {
          rows = await pool.query(`SELECT * FROM "${schema}"."${table}" LIMIT ${limit}`)
        }
      }
      return { columns: columnNames, rows: rows.rows }
    } catch (error) {
      return { columns: [], rows: [], error: error.message }
    }
  },

  getColumns: (conn, ctx, table) => getColumns(poolFor(conn, ctx), table, schemaOf(ctx)),

  getIndexes: (conn, ctx, table) => getIndexes(poolFor(conn, ctx), table, schemaOf(ctx)),

  async getSchemaMap(conn, ctx) {
    const r = await poolFor(conn, ctx).query(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = $1 ORDER BY table_name, ordinal_position`,
      [schemaOf(ctx)]
    )
    const schema = {}
    for (const row of r.rows) (schema[row.table_name] ||= []).push(row.column_name)
    return schema
  },

  // `only` (optional) narrows the read to those tables, so a caller syncing a
  // large schema can walk it in slices and report progress. Everything else is
  // unchanged by it: each slice is a complete answer for the tables it names.
  async getDiagram(conn, ctx, { tables: only = null } = {}) {
    const pool = poolFor(conn, ctx)
    const schema = schemaOf(ctx)
    const names = (await listTables(pool, schema)).filter((t) => !only || only.includes(t))
    const indexes = await indexesBySchema(pool, schema, names)
    const tables = []
    for (const t of names) {
      tables.push({ name: t, columns: await getColumns(pool, t, schema), indexes: indexes[t] || [] })
    }
    const fkRes = await pool.query(
      `SELECT tc.constraint_name AS constraint, tc.table_name AS table, kcu.column_name AS column,
             ccu.table_name AS ref_table, ccu.column_name AS ref_column,
             rc.delete_rule AS on_delete, rc.update_rule AS on_update
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      JOIN information_schema.referential_constraints rc
        ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1
        AND ($2::text[] IS NULL OR tc.table_name = ANY($2))`,
      [schema, only]
    )
    const foreignKeys = fkRes.rows.map((r) => ({
      constraint: r.constraint,
      table: r.table,
      column: r.column,
      refTable: r.ref_table,
      refColumn: r.ref_column,
      onDelete: r.on_delete,
      onUpdate: r.on_update,
    }))
    return { tables, foreignKeys }
  },

  // ---- Data ----
  async insertRow(conn, ctx, { table, values }) {
    const cols = Object.keys(values)
    const colList = cols.map((c) => `"${c}"`).join(', ')
    const sql = `INSERT INTO "${schemaOf(ctx)}"."${table}" (${colList}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`
    const result = await poolFor(conn, ctx).query(sql, cols.map((c) => values[c]))
    return { ok: true, changes: result.rowCount }
  },

  runQuery: (conn, ctx, sql) => runQuery(poolFor(conn, ctx), sql, ctx?.schema),

  analyze: (conn, ctx, { sql, cls }) => analyze(poolFor(conn, ctx), sql, ctx?.schema, cls),

  // ---- Backup / restore ----
  async dump(conn, destPath) {
    const { args, env } = toolConn(conn)
    await execTool('pg_dump', ['-Fc', '--no-owner', '-f', destPath, ...args], { env })
  },

  async restore(conn, dumpPath) {
    postgresDriver.release(conn)
    const { args, env } = toolConn(conn)
    await execTool('pg_restore', ['--clean', '--if-exists', '--no-owner', ...args, dumpPath], { env })
  },
}

// ---- Internals -------------------------------------------------------------

async function serverVersionNum(pool) {
  if (!poolVersions.has(pool)) {
    let num = 0
    try {
      const r = await pool.query('SHOW server_version_num')
      num = parseInt(r.rows[0]?.server_version_num, 10) || 0
    } catch {
      // An unreadable version falls back to the pre-11 form, which is the safer
      // guess for anything not answering `SHOW`.
      num = 0
    }
    poolVersions.set(pool, num)
  }
  return poolVersions.get(pool)
}

// SQL predicate selecting plain functions (not aggregates/window functions/procedures).
async function plainFunctionFilter(pool) {
  const version = await serverVersionNum(pool)
  return version >= 110000 ? `p.prokind = 'f'` : `NOT p.proisagg AND NOT p.proiswindow`
}

async function listTables(pool, schema = 'public') {
  try {
    const res = await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname = $1 ORDER BY tablename`, [schema])
    return res.rows.map((r) => r.tablename)
  } catch {
    return []
  }
}

// Primary-key columns of a table, in key order — used to give the browse query
// a stable sort. Empty for views/matviews and for tables without a PK.
async function primaryKeyColumns(pool, table, schema = 'public') {
  try {
    const r = await pool.query(
      `SELECT a.attname AS name
       FROM pg_index ix
       JOIN pg_class t ON t.oid = ix.indrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       JOIN unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
       WHERE ix.indisprimary AND t.relname = $1 AND n.nspname = $2
       ORDER BY k.ord`,
      [table, schema]
    )
    return r.rows.map((row) => row.name)
  } catch {
    return []
  }
}

// Reconstruct the column's real Postgres type, including its length/precision
// (e.g. "character varying(255)", "numeric(10,2)") exactly as the database
// reports it — no aliasing to short names.
function fullType(c) {
  const t = c.data_type
  if ((t === 'character varying' || t === 'character') && c.character_maximum_length != null) {
    return `${t}(${c.character_maximum_length})`
  }
  if (t === 'numeric' && c.numeric_precision != null) {
    return c.numeric_scale ? `${t}(${c.numeric_precision},${c.numeric_scale})` : `${t}(${c.numeric_precision})`
  }
  return t
}

async function getColumns(pool, table, schema = 'public') {
  const r = await pool.query(
    `SELECT column_name, data_type, is_nullable, column_default, is_identity,
            character_maximum_length, numeric_precision, numeric_scale
     FROM information_schema.columns
     WHERE table_name = $1 AND table_schema = $2
     ORDER BY ordinal_position`,
    [table, schema]
  )
  // Identify the primary-key columns so row selection / delete / duplicate work.
  const pkRes = await pool.query(
    `SELECT kcu.column_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
     WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_name = $1 AND tc.table_schema = $2`,
    [table, schema]
  )
  const pkSet = new Set(pkRes.rows.map((row) => row.column_name))
  // Map each FK column to its referenced table/column.
  const fkRes = await pool.query(
    `SELECT kcu.column_name AS column, ccu.table_name AS ref_table, ccu.column_name AS ref_column
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
     JOIN information_schema.constraint_column_usage ccu
       ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
     WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = $1 AND tc.table_schema = $2`,
    [table, schema]
  )
  const fkMap = {}
  for (const row of fkRes.rows) fkMap[row.column] = { table: row.ref_table, column: row.ref_column }
  // serial exposes its sequence as a nextval() default; identity columns keep it
  // out of column_default entirely, so both have to be checked.
  return r.rows.map((c) => ({
    name: c.column_name,
    type: fullType(c),
    notnull: c.is_nullable === 'NO',
    pk: pkSet.has(c.column_name),
    default: c.column_default,
    autoIncrement: c.is_identity === 'YES' || /^nextval\(/i.test(c.column_default || ''),
    references: fkMap[c.column_name] || null,
  }))
}

/**
 * Every index in `schema`, grouped by table — one query for a whole schema, or
 * for the tables named in `only`.
 *
 * Grouped rather than per-table because the diagram wants them all: asking once
 * per table is a round trip per table, on top of the columns one.
 */
async function indexesBySchema(pool, schema = 'public', only = null) {
  const r = await pool.query(
    `SELECT t.relname AS table, i.relname AS name, am.amname AS algorithm, ix.indisunique AS unique,
            ix.indisprimary AS "primary", (con.conname IS NOT NULL) AS "constraint",
            (SELECT string_agg(a.attname, ', ' ORDER BY k.ord)
             FROM unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord)
             JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum) AS columns,
            pg_get_expr(ix.indpred, ix.indrelid) AS condition,
            obj_description(i.oid) AS comment
     FROM pg_index ix
     JOIN pg_class i ON i.oid = ix.indexrelid
     JOIN pg_class t ON t.oid = ix.indrelid
     JOIN pg_am am ON am.oid = i.relam
     JOIN pg_namespace n ON n.oid = t.relnamespace
     LEFT JOIN pg_constraint con ON con.conindid = i.oid AND con.contype IN ('p', 'u', 'x')
     WHERE n.nspname = $1 AND ($2::text[] IS NULL OR t.relname = ANY($2))
     ORDER BY t.relname, i.relname`,
    [schema, only]
  )
  const byTable = {}
  for (const row of r.rows) {
    ;(byTable[row.table] ||= []).push({
      name: row.name,
      algorithm: (row.algorithm || '').toUpperCase(),
      unique: row.unique,
      columns: row.columns || '',
      condition: row.condition || '',
      include: '',
      comment: row.comment || '',
      // An index Postgres created for a PRIMARY KEY / UNIQUE / EXCLUDE constraint
      // is owned by that constraint: DROP INDEX refuses it (ALTER TABLE DROP
      // CONSTRAINT is the only way), so the schema editor shows it read-only.
      primary: !!row.primary,
      constraint: !!row.constraint,
    })
  }
  return byTable
}

async function getIndexes(pool, table, schema = 'public') {
  return (await indexesBySchema(pool, schema, [table]))[table] || []
}

async function runQuery(pool, sql, schema) {
  try {
    let result
    if (schema && schema !== 'public') {
      // Run on a dedicated client with the schema first on the search path.
      const client = await pool.connect()
      try {
        await client.query(`SET search_path TO "${schema}", public`)
        result = await client.query(sql)
      } finally {
        client.release()
      }
    } else {
      result = await pool.query(sql)
    }
    // A populated `fields` list means the command returned a result set —
    // SELECT, EXPLAIN [ANALYZE], SHOW, VALUES, WITH … SELECT, INSERT … RETURNING.
    // Commands like INSERT/UPDATE/DELETE leave it empty, so we report rowCount.
    const columns = result.fields ? result.fields.map((f) => f.name) : []
    if (columns.length) {
      return { type: 'rows', columns, rows: result.rows }
    }
    // `rowCount` rides along with the message so callers can tell a statement
    // that changed nothing from one that did — a 0-row UPDATE is not an error,
    // but it isn't a success worth reporting as one either.
    return { type: 'message', message: `Query OK · ${result.rowCount ?? 0} row(s) affected.`, rowCount: result.rowCount ?? 0 }
  } catch (error) {
    return { error: error.message }
  }
}

// ---- pg_dump / pg_restore --------------------------------------------------

// Connection args + libpq env for the CLI tools, mirroring pgConfig so they
// honour the same host/port/db, no-auth mode and SSL mode as the pooled client.
// Password and sslmode go through libpq env vars (PGPASSWORD/PGSSLMODE) — never
// argv — so they don't leak into the process list.
function toolConn(conn) {
  const noAuth = conn.auth === 'none'
  const args = ['-h', conn.host, '-p', String(conn.port || 5432), '-d', conn.database]
  if (!noAuth && conn.username) args.push('-U', conn.username)
  const env = { ...process.env, PGPASSWORD: noAuth ? '' : conn.password || '' }
  if (conn.sslmode) env.PGSSLMODE = conn.sslmode
  return { args, env }
}

// Translates the cryptic `spawn <tool> ENOENT` you get when the client tools
// aren't installed/on PATH into an actionable message.
async function execTool(tool, args, opts) {
  try {
    return await execFileAsync(tool, args, opts)
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(
        `${tool} not found on the server — PostgreSQL backup/restore needs the PostgreSQL client tools (pg_dump/pg_restore) installed and on PATH.`
      )
    }
    throw err
  }
}

// ---- Query analyzer --------------------------------------------------------
// EXPLAIN (FORMAT JSON), normalized into the dialect-agnostic shape described in
// server/db/index.js. Read-only SELECTs add ANALYZE for real timings; anything
// else stays estimate-only so analysis never modifies data.
async function analyze(pool, sql, schema, cls) {
  const withTimings = cls.kind === 'select' && cls.readOnly
  const explain = await runQuery(pool, `EXPLAIN (FORMAT JSON${withTimings ? ', ANALYZE' : ''}) ${sql}`, schema)
  if (explain.error) throw new Error(explain.error)

  // FORMAT JSON returns one row with a single "QUERY PLAN" value — node-pg may
  // hand it over pre-parsed (json type) or as a string.
  const raw = explain.rows?.[0]?.['QUERY PLAN']
  const tree = typeof raw === 'string' ? JSON.parse(raw) : raw
  const root = Array.isArray(tree) ? tree[0] : tree
  if (!root?.Plan) throw new Error('Unexpected EXPLAIN output.')

  // Walk the plan tree depth-first into normalized rows.
  const plan = []
  const walk = (node, depth) => {
    const details = []
    if (node['Join Type']) details.push(`${node['Join Type']} join`)
    if (node['Index Cond']) details.push(`Index Cond: ${node['Index Cond']}`)
    if (node.Filter) details.push(`Filter: ${node.Filter}`)
    if (node['Sort Key']) details.push(`Sort Key: ${Array.isArray(node['Sort Key']) ? node['Sort Key'].join(', ') : node['Sort Key']}`)
    if (node['Sort Method']) details.push(`Sort Method: ${node['Sort Method']}`)
    let warning = null
    if (node['Node Type'] === 'Seq Scan' && node.Filter) warning = 'Full table scan with filter'
    else if (node['Node Type'] === 'Seq Scan') warning = 'Full table scan'
    else if (node['Node Type'] === 'Sort' && String(node['Sort Method'] || '').toLowerCase().startsWith('external')) warning = 'Sort spilled to disk'
    plan.push({
      depth,
      step: node['Node Type'],
      detail: details.join(' · ') || node['Node Type'],
      table: node['Relation Name'] || null,
      index: node['Index Name'] || null,
      rows: node['Actual Rows'] ?? node['Plan Rows'] ?? null,
      warning,
      sortKey: node['Sort Key'] || null, // internal, stripped below
      filter: node.Filter || null, // internal, stripped below
    })
    for (const child of node.Plans || []) walk(child, depth + 1)
  }
  walk(root.Plan, 0)

  const summary = withTimings
    ? {
        mode: 'actual',
        executed: true,
        elapsedMs: Math.round(((root['Planning Time'] || 0) + (root['Execution Time'] || 0)) * 100) / 100,
        estimatedCost: root.Plan['Total Cost'],
        rowsReturned: root.Plan['Actual Rows'] ?? null,
      }
    : { mode: 'estimated', executed: false, estimatedCost: root.Plan['Total Cost'] }

  // Suggestions straight from the plan: Seq Scan filters and Sort keys.
  const identRe = /(?:"([^"]+)"|\b([a-z_][\w]*))\s*(?:=|<>|!=|<=|>=|<|>|\s+(?:not\s+)?(?:in|like|between|is)\b)/gi
  const indexSuggestions = []
  const metaCache = new Map()
  const metaFor = async (table) => {
    if (!metaCache.has(table)) {
      metaCache.set(table, {
        columns: await getColumns(pool, table, schema || 'public'),
        indexes: await getIndexes(pool, table, schema || 'public'),
      })
    }
    return metaCache.get(table)
  }
  for (const row of plan) {
    if (row.warning === 'Full table scan with filter' && row.table) {
      const cands = []
      let m
      while ((m = identRe.exec(row.filter))) cands.push((m[1] || m[2]).split('.').pop())
      identRe.lastIndex = 0
      const { columns, indexes } = await metaFor(row.table)
      const sug = makeIndexSuggestion(
        row.table, [...new Set(cands)], columns, indexes,
        `Sequential scan on ${quoteIdent(row.table)} while filtering — an index on the filtered column(s) would let Postgres use an index scan.`,
        schema
      )
      if (sug && !indexSuggestions.some((s) => s.ddl === sug.ddl)) indexSuggestions.push(sug)
    }
    if (row.step === 'Sort' && row.sortKey) {
      // Only worth an index when the sort feeds off a full scan.
      const scanBelow = plan.find((p) => p.depth > row.depth && p.table && (p.warning || '').startsWith('Full table scan'))
      if (scanBelow) {
        const keys = (Array.isArray(row.sortKey) ? row.sortKey : [row.sortKey])
          .map((k) => String(k).replace(/\b(asc|desc|nulls\s+(first|last))\b/gi, '').trim().replace(/^"|"$/g, '').split('.').pop())
          .filter((k) => /^[\w]+$/.test(k))
        const { columns, indexes } = await metaFor(scanBelow.table)
        const sug = makeIndexSuggestion(
          scanBelow.table, keys, columns, indexes,
          `Sort on ${quoteIdent(scanBelow.table)} — an index on the sort key(s) delivers rows pre-sorted.`,
          schema
        )
        if (sug && !indexSuggestions.some((s) => s.ddl === sug.ddl)) indexSuggestions.push(sug)
      }
    }
  }
  for (const row of plan) {
    delete row.sortKey
    delete row.filter
  }

  const primaryTable = plan.find((p) => p.table)?.table
  const primaryCols = primaryTable ? (await metaFor(primaryTable)).columns.length : 0
  const querySuggestions = queryLevelSuggestions(sql, plan, primaryCols)

  return {
    dialect: 'postgresql',
    summary,
    plan,
    rawPlan: { columns: ['QUERY PLAN'], rows: [{ 'QUERY PLAN': JSON.stringify(tree, null, 2) }] },
    indexSuggestions,
    querySuggestions,
  }
}
