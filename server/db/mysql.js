/**
 * MySQL driver.
 *
 * Implements the generic driver contract described in server/db/index.js. `ctx`
 * carries { database, schema }: a pool is kept per (connection, database), and
 * `schema` is ignored — in MySQL a schema *is* a database, so `namespaces`
 * reports none and the console's picker is the database one alone.
 *
 * Three things differ from every other SQL engine here, and each one has a
 * home below rather than a branch above:
 *  - identifiers are backticked: `"x"` is a *string* in MySQL (quoteIdent);
 *  - backslashes are live in a string, so '' doubling alone can be escaped out
 *    of (sqlLiteral — server/workflow.js and data-transfer use it through
 *    `db.literalFor`). `NO_BACKSLASH_ESCAPES` would avoid that, but it changes
 *    what someone's own query and every mysqldump script mean;
 *  - DDL commits implicitly, so `runScript`'s transaction only protects the
 *    data statements of a script.
 */

import fs from 'fs'
import net from 'net'
import { promisify } from 'util'
import { execFile, spawn } from 'child_process'
import mysql from 'mysql2/promise'
import {
  extractQueryColumns,
  hasOwnTransaction,
  ifNotExists,
  insertBatches,
  makeIndexSuggestion,
  pageSql,
  queryLevelSuggestions,
  splitSqlStatements,
  sqlLiteral,
  stripSqlComments,
} from './sql.js'

const execFileAsync = promisify(execFile)

// A pool per (connection, database).
const pools = new Map()

const SYSTEM_DATABASES = new Set(['information_schema', 'mysql', 'performance_schema', 'sys'])

export const quoteIdent = (name) => `\`${String(name).replace(/`/g, '``')}\``

// The default literal, with backslashes doubled — see the header.
export function mysqlLiteral(v) {
  const literal = sqlLiteral(v)
  return literal.startsWith("'") ? literal.replace(/\\/g, '\\\\') : literal
}

// A BIT column arrives as raw bytes, which the grid can't show; read it as the
// number it is. Everything else keeps mysql2's own parsing.
function typeCast(field, next) {
  if (field.type !== 'BIT') return next()
  const bytes = field.buffer()
  return bytes && String(bytes.reduce((n, b) => n * 256n + BigInt(b), 0n))
}

// Build a mysql2 connection/pool config from a stored connection. Through an
// SSH tunnel `host` is the local end, so the socket is handed over as `stream`
// and `host` keeps the real name — it is what mysql2 verifies the certificate
// against (and sends as SNI). Dates stay strings so a value reads as stored,
// with no time zone applied, and an edit can match it; a number too big for a
// double comes back as a string, so an id above 2^53 survives the round trip.
export function mysqlConfig(config) {
  const noAuth = config.auth === 'none'
  const port = parseInt(config.port) || 3306
  const encrypted = config.sslmode && config.sslmode !== 'disable'
  const verify = config.sslmode === 'verify-full'
  return {
    host: config.tunneledHost || config.host,
    ...(config.tunneledHost ? { stream: () => net.connect(port, config.host) } : {}),
    port,
    user: noAuth ? undefined : config.username || undefined,
    password: noAuth ? undefined : config.password || undefined,
    database: config.database || undefined,
    ...(encrypted ? { ssl: { rejectUnauthorized: verify, verifyIdentity: verify } } : {}),
    multipleStatements: true,
    dateStrings: true,
    supportBigNumbers: true,
    typeCast,
  }
}

function poolFor(conn, ctx = {}) {
  const db = ctx.database || conn.database
  const key = `${conn.id}::${db || ''}`
  if (!pools.has(key)) pools.set(key, mysql.createPool(mysqlConfig({ ...conn, database: db })))
  return pools.get(key)
}

const closePool = (pool) => pool.end().catch(() => {})

export const mysqlDriver = {
  type: 'mysql',
  label: 'MySQL',
  defaultPort: 3306,
  dumpExtension: 'sql',
  // The engine's own vocabulary, like Postgres. `… auto_increment` is MySQL's
  // serial: the text lands in the column definition as it stands.
  dataTypes: [
    'int auto_increment', 'bigint auto_increment', 'tinyint', 'smallint', 'int', 'bigint', 'decimal(10,2)', 'float', 'double',
    'boolean', 'char', 'varchar', 'text', 'mediumtext', 'longtext', 'date', 'time', 'datetime', 'timestamp', 'json', 'blob',
  ],

  // ---- Lifecycle ----
  async testConnection(config) {
    const client = await mysql.createConnection(mysqlConfig(config))
    try {
      const [rows] = await client.query('SELECT DATABASE() AS db')
      return { ok: true, message: `Connected to MySQL${rows[0]?.db ? ` (${rows[0].db})` : ''}!` }
    } finally {
      await client.end()
    }
  },

  // What the generic classifier can't read: the server's error codes. mysql2
  // names them, so nothing here depends on a message's wording.
  explainError(error) {
    switch (error?.code) {
      case 'ER_ACCESS_DENIED_ERROR':
      case 'ER_ACCESS_DENIED_NO_PASSWORD_ERROR':
        return {
          reason: 'auth',
          cause: 'MySQL rejected the username or password.',
          hint: 'Re-enter the credentials in the connection settings; a rotated password is the usual cause.',
        }
      case 'ER_NOT_SUPPORTED_AUTH_MODE':
        return {
          reason: 'auth',
          cause: "This user's authentication plugin is one the client can't speak.",
          hint: 'Switch the user to caching_sha2_password or mysql_native_password on the server.',
        }
      case 'ER_BAD_DB_ERROR':
        return {
          reason: 'missing_database',
          cause: 'That database does not exist on this server.',
          hint: 'Check the "Database" field — the server is reachable, only the database name is wrong.',
        }
      case 'ER_DBACCESS_DENIED_ERROR':
        return {
          reason: 'permission',
          cause: 'This user may not open that database.',
          hint: "GRANT the user access to it, or pick a database it can reach.",
        }
      case 'ER_HOST_NOT_PRIVILEGED':
        return {
          reason: 'permission',
          cause: "The server has no account for this user connecting from this client's address.",
          hint: "MySQL accounts are user@host: create or GRANT one for this server's IP (or '%').",
        }
      case 'ER_HOST_IS_BLOCKED':
        return {
          reason: 'permission',
          cause: "The server blocked this client's address after too many failed handshakes.",
          hint: 'Clear it on the server with mysqladmin flush-hosts (or TRUNCATE performance_schema.host_cache), or raise max_connect_errors.',
        }
      case 'ER_CON_COUNT_ERROR':
      case 'ER_TOO_MANY_USER_CONNECTIONS':
      case 'ER_USER_LIMIT_REACHED':
        return {
          reason: 'busy',
          cause: 'The server has reached its connection limit.',
          hint: 'Free up connections (or raise max_connections) and try again.',
        }
      case 'ER_SERVER_SHUTDOWN':
      case 'ER_SERVER_OFFLINE_MODE':
        return {
          reason: 'busy',
          cause: 'The server is not accepting connections right now.',
          hint: 'It is shutting down or in offline mode — retry once it is back.',
        }
      case 'ER_SECURE_TRANSPORT_REQUIRED':
        return {
          reason: 'tls',
          cause: 'The server only accepts encrypted connections.',
          hint: 'Set SSL mode to "require" (or "verify-full" if you have the CA) in the connection settings.',
        }
      case 'HANDSHAKE_NO_SSL_SUPPORT':
        return {
          reason: 'tls',
          cause: 'The server does not support SSL, but this connection requires it.',
          hint: 'Set SSL mode to "disable" in the connection settings.',
        }
      default:
        return null
    }
  },

  release(conn) {
    for (const [key, pool] of pools) {
      if (key === conn.id || key.startsWith(`${conn.id}::`)) {
        closePool(pool)
        pools.delete(key)
      }
    }
  },

  closeAll() {
    for (const [, pool] of pools) closePool(pool)
    pools.clear()
  },

  // ---- Introspection ----
  async ping(conn, ctx) {
    await poolFor(conn, ctx).query('SELECT 1')
    return { ok: true }
  },

  // `VERSION()` can carry a suffix ("8.0.36-0ubuntu0.22.04.1").
  async serverVersion(conn, ctx) {
    const [rows] = await poolFor(conn, ctx).query('SELECT VERSION() AS version')
    return /^\d+(\.\d+)*/.exec(rows[0]?.version || '')?.[0] || null
  },

  // A connection may name no database, so `currentDatabase` can be null and the
  // console picks the first listed. System databases stay out of the list unless
  // the connection was pointed at one on purpose.
  async namespaces(conn, ctx) {
    const pool = poolFor(conn, ctx)
    const [dbs] = await pool.query('SHOW DATABASES')
    const [cur] = await pool.query('SELECT DATABASE() AS db')
    const currentDatabase = cur[0]?.db || null
    return {
      databases: dbs.map((r) => r.Database).filter((d) => d === currentDatabase || !SYSTEM_DATABASES.has(d)),
      schemas: [],
      currentDatabase,
    }
  },

  listTables: (conn, ctx) => listTables(poolFor(conn, ctx)),

  // Generic object list: tables, views and routines. Each sub-query is isolated
  // so one failing kind never blanks the whole list.
  async listObjects(conn, ctx) {
    const pool = poolFor(conn, ctx)
    const out = []
    const safe = async (fn) => {
      try {
        await fn()
      } catch (error) {
        console.error('listObjects (mysql):', error.message)
      }
    }
    await safe(async () => {
      const [rows] = await pool.query(
        `SELECT TABLE_NAME AS name, TABLE_TYPE AS kind FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_TYPE, TABLE_NAME`
      )
      for (const row of rows) out.push({ name: row.name, type: row.kind === 'VIEW' || row.kind === 'SYSTEM VIEW' ? 'view' : 'table' })
    })
    await safe(async () => {
      const args = await routineArgs(pool)
      const [rows] = await pool.query(
        `SELECT ROUTINE_NAME AS name FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE() ORDER BY ROUTINE_NAME`
      )
      for (const row of rows) out.push({ name: row.name, type: 'function', detail: args[row.name] || '' })
    })
    return out
  },

  // A routine's definition. A name can be both a function and a procedure, and
  // SHOW CREATE answers null to a user without the privilege to read it.
  async listFunctions(conn, ctx, name) {
    const pool = poolFor(conn, ctx)
    const args = await routineArgs(pool)
    const [routines] = await pool.query(
      `SELECT ROUTINE_TYPE AS kind FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE() AND ROUTINE_NAME = ?`,
      [name]
    )
    const out = []
    for (const { kind } of routines) {
      const [rows] = await pool.query(`SHOW CREATE ${kind === 'PROCEDURE' ? 'PROCEDURE' : 'FUNCTION'} ${quoteIdent(name)}`)
      const definition = rows[0]?.[kind === 'PROCEDURE' ? 'Create Procedure' : 'Create Function']
      out.push({ name, args: args[name] || '', definition: definition || '' })
    }
    return out
  },

  // Ordered by the primary key when there is one. A table without one has no
  // hidden row id to order by or to target an edit with (the console falls back
  // to matching every column); InnoDB still scans it in a steady order.
  async getTableData(conn, ctx, { table, limit = 200, offset = 0 }) {
    const pool = poolFor(conn, ctx)
    const page = `LIMIT ${parseInt(limit) || 200} OFFSET ${parseInt(offset) || 0}`
    try {
      const columns = (await readColumns(pool, [table])).map((c) => c.name)
      const pk = await primaryKeyColumns(pool, table)
      const order = pk.length ? `ORDER BY ${pk.map(quoteIdent).join(', ')}` : ''
      const [rows] = await pool.query(`SELECT * FROM ${quoteIdent(table)} ${order} ${page}`)
      return { columns, rows }
    } catch (error) {
      return { columns: [], rows: [], error: error.message }
    }
  },

  async getColumns(conn, ctx, table) {
    const pool = poolFor(conn, ctx)
    return (await readColumns(pool, [table])).map(({ table: _table, ...column }) => column)
  },

  async getIndexes(conn, ctx, table) {
    return (await indexesByTable(poolFor(conn, ctx), [table]))[table] || []
  },

  async getSchemaMap(conn, ctx) {
    const [rows] = await poolFor(conn, ctx).query(
      `SELECT TABLE_NAME AS tbl, COLUMN_NAME AS col FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION`
    )
    const schema = {}
    for (const row of rows) (schema[row.tbl] ||= []).push(row.col)
    return schema
  },

  // `only` (optional) narrows the read to those tables, so a caller syncing a
  // large schema can walk it in slices. Each slice is a complete answer for the
  // tables it names.
  async getDiagram(conn, ctx, { tables: only = null } = {}) {
    const pool = poolFor(conn, ctx)
    const names = (await listTables(pool)).filter((t) => !only || only.includes(t))
    if (!names.length) return { tables: [], foreignKeys: [] }
    const columns = await readColumns(pool, names)
    const indexes = await indexesByTable(pool, names)
    const foreignKeys = (await readForeignKeys(pool, names)).map((fk) => ({
      constraint: fk.constraint_name,
      table: fk.tbl,
      column: fk.col,
      refTable: fk.ref_table,
      refColumn: fk.ref_column,
      onDelete: fk.on_delete,
      onUpdate: fk.on_update,
    }))
    const tables = names.map((name) => ({
      name,
      columns: columns.filter((c) => c.table === name).map(({ table: _table, ...column }) => column),
      indexes: indexes[name] || [],
    }))
    return { tables, foreignKeys }
  },

  // ---- Data ----
  async insertRow(conn, ctx, { table, values }) {
    const cols = Object.keys(values)
    const sql = `INSERT INTO ${quoteIdent(table)} (${cols.map(quoteIdent).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
    const [result] = await poolFor(conn, ctx).query(sql, cols.map((c) => bindable(values[c])))
    return { ok: true, changes: result.affectedRows }
  },

  // Every batch in one transaction: an import lands whole or not at all.
  async insertRows(conn, ctx, { table, rows }) {
    const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))]
    if (!columns.length) return { ok: true, inserted: 0 }
    const batches = insertBatches(quoteIdent(table), columns, rows, { quote: quoteIdent, maxParams: 60000 })
    await withOwnConnection(poolFor(conn, ctx), (client) =>
      inTransaction(client, async () => {
        for (const b of batches) await client.query(b.sql, b.params.map(bindable))
      })
    )
    return { ok: true, inserted: rows.length }
  },

  // A multi-statement script (a .sql import). Its data statements share one
  // transaction, but any DDL in it commits what came before — MySQL has no
  // transactional DDL, so a script that fails halfway keeps its CREATEs.
  async runScript(conn, ctx, sql) {
    await withOwnConnection(poolFor(conn, ctx), (client) =>
      hasOwnTransaction(sql) ? client.query(sql) : inTransaction(client, () => client.query(sql))
    )
    return { ok: true }
  },

  // MySQL keeps the real statement, indexes and foreign keys included. A view
  // answers with `Create View`, and is not something a table import can recreate.
  async tableDdl(conn, ctx, table) {
    const [rows] = await poolFor(conn, ctx).query(`SHOW CREATE TABLE ${quoteIdent(table)}`)
    const create = rows[0]?.['Create Table']
    return create ? [`${ifNotExists(create)};`] : []
  },

  quoteIdent,
  sqlLiteral: mysqlLiteral,

  runQuery: (conn, ctx, sql) => runQuery(poolFor(conn, ctx), sql),
  pageSql,

  analyze: (conn, ctx, { sql }) => analyze(poolFor(conn, ctx), sql),

  // ---- Backup / restore ----
  // Named as a plain positional so the dump carries no CREATE DATABASE or USE:
  // it restores into whichever database the target connection names.
  async dump(conn, destPath) {
    const { args, env } = toolConn(conn)
    await execTool(
      'mysqldump',
      [...args, '--single-transaction', '--routines', '--triggers', '--hex-blob', '--no-tablespaces', '--loose-set-gtid-purged=OFF', `--result-file=${destPath}`, '--', databaseOf(conn)],
      { env }
    )
  },

  async restore(conn, dumpPath) {
    mysqlDriver.release(conn)
    const { args, env } = toolConn(conn)
    await execToolWithInput('mysql', [...args, '--', databaseOf(conn)], dumpPath, { env })
  },
}

// ---- Internals -------------------------------------------------------------

async function listTables(pool) {
  try {
    const [rows] = await pool.query(
      `SELECT TABLE_NAME AS name FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`
    )
    return rows.map((r) => r.name)
  } catch {
    return []
  }
}

// A routine's parameters as one readable string per name.
async function routineArgs(pool) {
  const [rows] = await pool.query(
    `SELECT SPECIFIC_NAME AS name, PARAMETER_MODE AS mode, PARAMETER_NAME AS param, DTD_IDENTIFIER AS type
     FROM information_schema.PARAMETERS
     WHERE SPECIFIC_SCHEMA = DATABASE() AND ORDINAL_POSITION > 0
     ORDER BY SPECIFIC_NAME, ORDINAL_POSITION`
  )
  const args = {}
  for (const r of rows) (args[r.name] ||= []).push([r.mode, r.param, r.type].filter(Boolean).join(' '))
  return Object.fromEntries(Object.entries(args).map(([name, list]) => [name, list.join(', ')]))
}

// Primary-key columns of a table, in key order. Empty for views and for tables
// without a PK.
async function primaryKeyColumns(pool, table) {
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME AS name FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = 'PRIMARY'
     ORDER BY SEQ_IN_INDEX`,
    [table]
  )
  return rows.map((r) => r.name)
}

async function readForeignKeys(pool, names) {
  const [rows] = await pool.query(
    `SELECT k.CONSTRAINT_NAME AS constraint_name, k.TABLE_NAME AS tbl, k.COLUMN_NAME AS col,
            k.REFERENCED_TABLE_NAME AS ref_table, k.REFERENCED_COLUMN_NAME AS ref_column,
            r.DELETE_RULE AS on_delete, r.UPDATE_RULE AS on_update
     FROM information_schema.KEY_COLUMN_USAGE k
     JOIN information_schema.REFERENTIAL_CONSTRAINTS r
       ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME
     WHERE k.TABLE_SCHEMA = DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL AND k.TABLE_NAME IN (?)
     ORDER BY k.TABLE_NAME, k.ORDINAL_POSITION`,
    [names]
  )
  return rows
}

const NUMERIC = /^(tinyint|smallint|mediumint|int|integer|bigint|decimal|numeric|float|double|real|year)$/i

// `COLUMN_DEFAULT` is the bare value, so a string default reads `active` rather
// than `'active'`. Callers paste a default straight into DDL (the schema
// designer, rollback), so it has to come back as SQL: quoted when it is a value,
// and parenthesised when it is an expression, unless it is CURRENT_TIMESTAMP.
function defaultSql(c) {
  if (c.dflt === null || c.dflt === undefined) return null
  if (/DEFAULT_GENERATED/i.test(c.extra || '')) {
    const expr = c.dflt.replace(/\\'/g, "'")
    return /^current_timestamp(\(\d*\))?$/i.test(expr) ? expr : `(${expr})`
  }
  if (NUMERIC.test(c.base) || /^b'[01]*'$/.test(c.dflt)) return c.dflt
  return mysqlLiteral(c.dflt)
}

// What MODIFY COLUMN would lose unless it is restated: it replaces the whole
// definition, so these ride along beside `type`, `notnull` and `default`.
function columnExtras(c) {
  const out = []
  if (/auto_increment/i.test(c.extra || '')) out.push('AUTO_INCREMENT')
  const onUpdate = /on update (current_timestamp(\(\d*\))?)/i.exec(c.extra || '')
  if (onUpdate) out.push(`ON UPDATE ${onUpdate[1]}`)
  if (c.comment) out.push(`COMMENT ${mysqlLiteral(c.comment)}`)
  return out.join(' ')
}

// `COLUMN_TYPE` is the type as written: "varchar(255)", "bigint unsigned",
// "enum('a','b')". Each row carries its `table`, for a read of several.
async function readColumns(pool, names) {
  const [rows] = await pool.query(
    `SELECT TABLE_NAME AS tbl, COLUMN_NAME AS name, COLUMN_TYPE AS type, DATA_TYPE AS base, IS_NULLABLE AS nullable,
            COLUMN_DEFAULT AS dflt, COLUMN_KEY AS col_key, EXTRA AS extra, COLUMN_COMMENT AS comment
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)
     ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    [names]
  )
  const fks = await readForeignKeys(pool, names)
  const fkOf = new Map(fks.map((fk) => [`${fk.tbl}\0${fk.col}`, { table: fk.ref_table, column: fk.ref_column }]))
  return rows.map((c) => ({
    table: c.tbl,
    name: c.name,
    type: c.type,
    notnull: c.nullable === 'NO',
    pk: c.col_key === 'PRI',
    default: defaultSql(c),
    autoIncrement: /auto_increment/i.test(c.extra || ''),
    extra: columnExtras(c),
    references: fkOf.get(`${c.tbl}\0${c.name}`) || null,
  }))
}

/**
 * The indexes of `names`, grouped by table. `SELECT *` because STATISTICS gained
 * EXPRESSION in 8.0.13, and naming it would fail on an older server.
 *
 * A UNIQUE constraint and a unique index are one thing here, so only PRIMARY is
 * a `constraint`. An index the schema editor can't write back — a prefix length,
 * an expression, FULLTEXT or SPATIAL — carries `locked`, the reason it stays
 * read-only, because rewriting it would silently turn it into a different index.
 */
async function indexesByTable(pool, names) {
  const [rows] = await pool.query(
    `SELECT * FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)
     ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
    [names]
  )
  const byName = new Map()
  for (const row of rows) {
    const key = `${row.TABLE_NAME}\0${row.INDEX_NAME}`
    if (!byName.has(key)) {
      byName.set(key, {
        table: row.TABLE_NAME,
        name: row.INDEX_NAME,
        algorithm: (row.INDEX_TYPE || '').toUpperCase(),
        unique: Number(row.NON_UNIQUE) === 0,
        parts: [],
        comment: row.INDEX_COMMENT || '',
        locked: /^(FULLTEXT|SPATIAL)$/i.test(row.INDEX_TYPE || '') ? row.INDEX_TYPE.toLowerCase() : '',
      })
    }
    const index = byName.get(key)
    if (row.EXPRESSION) {
      index.parts.push(`(${row.EXPRESSION})`)
      index.locked ||= 'expression'
    } else if (row.SUB_PART) {
      index.parts.push(`${row.COLUMN_NAME}(${row.SUB_PART})`)
      index.locked ||= 'prefix'
    } else index.parts.push(row.COLUMN_NAME)
  }
  const byTable = {}
  for (const { table, parts, locked, ...index } of byName.values()) {
    const primary = index.name === 'PRIMARY'
    ;(byTable[table] ||= []).push({
      ...index,
      columns: parts.join(', '),
      condition: '',
      include: '',
      primary,
      constraint: primary,
      ...(locked ? { locked } : {}),
    })
  }
  return byTable
}

// mysql2 expands an object into `key = value` pairs and an array into a list, so
// a JSON value has to reach it as text.
const bindable = (v) => (v !== null && typeof v === 'object' && !Buffer.isBuffer(v) && !(v instanceof Date) ? JSON.stringify(v) : v)

/**
 * Run `fn(client)` on a connection nobody else will use: it is destroyed rather
 * than handed back, because what ran on it may have left session state behind.
 * MySQL has no reset a pooled handle gets on release, so a USE would silently
 * aim the next request at the wrong database.
 */
async function withOwnConnection(pool, fn) {
  const client = await pool.getConnection()
  try {
    return await fn(client)
  } finally {
    client.destroy()
  }
}

async function inTransaction(client, fn) {
  await client.query('START TRANSACTION')
  try {
    const result = await fn()
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  }
}

// Statements whose effect outlives the statement, on that connection.
const SESSION_STATE = /^\s*(USE|SET|BEGIN|START\s+TRANSACTION|LOCK|CREATE\s+TEMPORARY)\b/i
const leavesSessionState = (sql) => splitSqlStatements(stripSqlComments(sql)).some((s) => SESSION_STATE.test(s))

/**
 * One statement's result as the contract's shape. With `multipleStatements` a
 * buffer of several answers with one result per statement (and a CALL with
 * several), where a single statement answers with its own — `fields` tells them
 * apart: one result's `fields` is a flat list of column definitions.
 */
function shapeResult(result, fields) {
  const several = Array.isArray(fields) && !(fields[0] && !Array.isArray(fields[0]))
  const results = several ? result.map((r, i) => [r, fields[i]]) : [[result, fields]]
  // The last result set is what a console would show; with none, say what ran.
  const set = results.findLast(([, f]) => f?.length)
  if (set) return { type: 'rows', columns: set[1].map((f) => f.name), rows: set[0] }
  const rowCount = results.reduce((n, [r]) => n + (r?.affectedRows || 0), 0)
  return { type: 'message', message: `Query OK · ${rowCount} row(s) affected.`, rowCount }
}

async function runQuery(pool, sql) {
  try {
    const [result, fields] = leavesSessionState(sql)
      ? await withOwnConnection(pool, (client) => client.query(sql))
      : await pool.query(sql)
    return shapeResult(result, fields)
  } catch (error) {
    return { error: error.message }
  }
}

// ---- mysqldump / mysql -----------------------------------------------------

const databaseOf = (conn) => {
  if (!conn.database) throw new Error('A MySQL backup needs one database: set "Database" in the connection settings.')
  return conn.database
}

// Connection args + env for the CLI tools, mirroring mysqlConfig. The password
// goes through MYSQL_PWD — never argv — so it doesn't leak into the process list.
//
// `--loose-` is there because the image ships the MariaDB build of these tools
// (Debian has no other) and MySQL's own spell TLS differently: each ignores the
// spelling it doesn't know. Through an SSH tunnel the tools dial 127.0.0.1 and
// have no way to name the real host, so verify-full can only ask for encryption.
function toolConn(conn) {
  const noAuth = conn.auth === 'none'
  const args = ['--protocol=TCP', `--host=${conn.host}`, `--port=${conn.port || 3306}`, '--default-character-set=utf8mb4']
  if (!noAuth && conn.username) args.push(`--user=${conn.username}`)
  if (conn.sslmode === 'verify-full' && !conn.tunneledHost) args.push('--loose-ssl-mode=VERIFY_IDENTITY', '--loose-ssl', '--loose-ssl-verify-server-cert')
  else if (conn.sslmode && conn.sslmode !== 'disable') args.push('--loose-ssl-mode=REQUIRED', '--loose-ssl')
  else args.push('--loose-ssl-mode=DISABLED', '--loose-skip-ssl')
  return { args, env: { ...process.env, MYSQL_PWD: noAuth ? '' : conn.password || '' } }
}

const toolMissing = (tool) =>
  new Error(`${tool} not found on the server — MySQL backup/restore needs the MySQL client tools (mysqldump/mysql) installed and on PATH.`)

// Translates the cryptic `spawn <tool> ENOENT` you get when the client tools
// aren't installed/on PATH into an actionable message.
async function execTool(tool, args, opts) {
  try {
    return await execFileAsync(tool, args, opts)
  } catch (err) {
    throw err.code === 'ENOENT' ? toolMissing(tool) : err
  }
}

// Like execTool, with a file on stdin — `mysql` reads a dump from there, and a
// dump can be far larger than anything worth holding in memory.
function execToolWithInput(tool, args, inputPath, opts) {
  return new Promise((resolve, reject) => {
    const child = spawn(tool, args, { ...opts, stdio: ['pipe', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('error', (err) => reject(err.code === 'ENOENT' ? toolMissing(tool) : err))
    child.on('close', (code) => {
      if (code === 0) return resolve()
      const reason = stderr.split('\n').filter((line) => !line.startsWith('Warning:')).join('\n').trim()
      reject(new Error(reason || `${tool} exited with code ${code}`))
    })
    child.stdin.on('error', () => {}) // the tool quit early; `close` reports why
    fs.createReadStream(inputPath).on('error', reject).pipe(child.stdin)
  })
}

// ---- Query analyzer --------------------------------------------------------
// EXPLAIN FORMAT=JSON, normalized into the dialect-agnostic shape described in
// server/db/index.js. Estimates only: MySQL's EXPLAIN ANALYZE answers in prose,
// and it runs the statement, so analysis here never touches data.

const ACCESS_STEPS = {
  ALL: 'Table Scan',
  index: 'Index Scan',
  range: 'Index Range Scan',
  ref: 'Index Lookup',
  ref_or_null: 'Index Lookup',
  eq_ref: 'Unique Index Lookup',
  const: 'Constant Lookup',
  system: 'Constant Lookup',
  fulltext: 'Full-text Search',
}

function tableStep(node, depth) {
  const details = []
  if (node.attached_condition) details.push(`Filter: ${node.attached_condition}`)
  if (node.using_index) details.push('Covered by the index')
  const scan = node.access_type === 'ALL'
  return {
    depth,
    step: ACCESS_STEPS[node.access_type] || node.access_type || 'Table',
    detail: details.join(' · ') || node.access_type || 'Table',
    table: node.table_name,
    index: node.key || null,
    rows: Number(node.rows_examined_per_scan ?? node.rows_produced_per_join) || null,
    warning: scan ? (node.attached_condition ? 'Full table scan with filter' : 'Full table scan') : null,
    filter: node.attached_condition || null, // internal, stripped below
  }
}

// The plan is nested by operation (ordering_operation, nested_loop, …) rather
// than by a fixed tree, so walk everything and keep what names a table or a sort.
function walkPlan(node, depth, plan) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) return node.forEach((child) => walkPlan(child, depth, plan))
  if (node.using_filesort) {
    plan.push({ depth, step: 'Sort', detail: 'Filesort', table: null, index: null, rows: null, warning: 'Sort not served by an index', filter: null })
    depth++
  }
  if (node.table_name) {
    plan.push(tableStep(node, depth))
    depth++
  }
  for (const child of Object.values(node)) walkPlan(child, depth, plan)
}

async function analyze(pool, sql) {
  const explain = await runQuery(pool, `EXPLAIN FORMAT=JSON ${sql}`)
  if (explain.error) throw new Error(explain.error)
  const raw = explain.rows?.[0]?.EXPLAIN
  const tree = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (!tree?.query_block) throw new Error('Unexpected EXPLAIN output.')

  const plan = []
  walkPlan(tree.query_block, 0, plan)

  const metaCache = new Map()
  const metaFor = async (table) => {
    if (!metaCache.has(table)) {
      metaCache.set(table, {
        columns: await readColumns(pool, [table]),
        indexes: (await indexesByTable(pool, [table]))[table] || [],
      })
    }
    return metaCache.get(table)
  }

  // Suggestions straight from the plan: filtered scans and unindexed sorts.
  const indexSuggestions = []
  const suggest = (sug) => {
    if (sug && !indexSuggestions.some((s) => s.ddl === sug.ddl)) indexSuggestions.push(sug)
  }
  for (const row of plan) {
    if (row.warning === 'Full table scan with filter') {
      const cands = [...row.filter.matchAll(/`([^`]+)`\s*(?:=|<>|!=|<=|>=|<|>|\s+(?:not\s+)?(?:in|like|between|is)\b)/gi)].map((m) => m[1])
      const { columns, indexes } = await metaFor(row.table)
      suggest(
        makeIndexSuggestion(
          row.table, [...new Set(cands)], columns, indexes,
          `Full scan on ${quoteIdent(row.table)} while filtering — an index on the filtered column(s) would let MySQL look the rows up.`,
          undefined, quoteIdent
        )
      )
    }
    if (row.step === 'Sort') {
      const scan = plan.find((p) => p.depth > row.depth && (p.warning || '').startsWith('Full table scan'))
      if (scan) {
        const { columns, indexes } = await metaFor(scan.table)
        suggest(
          makeIndexSuggestion(
            scan.table, extractQueryColumns(sql).orderBy, columns, indexes,
            `Sort on ${quoteIdent(scan.table)} — an index on the sort key(s) delivers rows pre-sorted.`,
            undefined, quoteIdent
          )
        )
      }
    }
  }
  for (const row of plan) delete row.filter

  const primaryTable = plan.find((p) => p.table)?.table
  const primaryCols = primaryTable ? (await metaFor(primaryTable)).columns.length : 0
  return {
    dialect: 'mysql',
    summary: { mode: 'estimated', executed: false, estimatedCost: Number(tree.query_block.cost_info?.query_cost) || null },
    plan,
    rawPlan: { columns: ['QUERY PLAN'], rows: [{ 'QUERY PLAN': JSON.stringify(tree, null, 2) }] },
    indexSuggestions,
    querySuggestions: queryLevelSuggestions(sql, plan, primaryCols),
  }
}
