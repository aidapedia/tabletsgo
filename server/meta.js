/**
 * Metadata store — SQLite or PostgreSQL persists app data: users, workspaces,
 * saved connections, queries, workflows, dashboards and run history. Separate
 * from the databases the user connects to (those live behind server/db/).
 *
 * Read and written through Prisma Client (the models are prisma/<engine>/
 * schema.prisma). Every module reaches it through `db()`, never a client it
 * holds on to, because `db()` is what makes transactions compose: inside
 * `transaction(fn)` it returns that transaction's client, so a helper three
 * modules down joins the transaction its caller opened instead of writing
 * beside it.
 *
 * The schema itself is not this module's job: server/migrator brings it up to
 * date (`npm run migrate`, or the compose `migrate` service) before the app
 * starts, and the app only checks it is current (assertMetaSchemaCurrent).
 */

import fs from 'fs'
import path from 'path'
import { AsyncLocalStorage } from 'async_hooks'
import { randomUUID } from 'crypto'
import { META_DATABASE_URL, META_DB_PATH, META_DB_TYPE } from './config.js'
import { sha256 } from './crypto.js'
import { openMeta, snapshotMeta } from './meta-connection.js'

const isPostgres = META_DB_TYPE === 'postgresql'

const loadClient = async () => {
  try {
    return isPostgres ? await import('./generated/prisma-postgresql/index.js') : await import('./generated/prisma-sqlite/index.js')
  } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND') throw new Error('The Prisma client is not generated. Run `npm run prisma:generate`.', { cause: error })
    throw error
  }
}
const { PrismaClient } = await loadClient()

const adapter = isPostgres
  ? new (await import('@prisma/adapter-pg')).PrismaPg({ connectionString: META_DATABASE_URL })
  : new (await import('@prisma/adapter-better-sqlite3')).PrismaBetterSqlite3({ url: META_DB_PATH })

/**
 * SQLite only. The adapter runs every query on one connection and serializes
 * transactions against each other — but not against plain queries, which would
 * land *inside* whatever transaction is open: reading its uncommitted rows, and
 * vanishing with it on a rollback. So a transaction waits for the queries in
 * flight and holds new ones until it ends; a waiting transaction goes first, so
 * a steady stream of reads can't starve it. PostgreSQL gives each transaction
 * its own pooled connection and needs none of this.
 */
function createGate() {
  let readers = 0
  let writing = false
  let queued = 0
  const waiters = []
  const wake = () => {
    for (const resolve of waiters.splice(0)) resolve()
  }
  const until = async (ready) => {
    while (!ready()) await new Promise((resolve) => waiters.push(resolve))
  }
  return {
    async read(fn) {
      await until(() => !writing && !queued)
      readers++
      try {
        return await fn()
      } finally {
        readers--
        wake()
      }
    },
    async write(fn) {
      queued++
      await until(() => !writing && !readers)
      queued--
      writing = true
      try {
        return await fn()
      } finally {
        writing = false
        wake()
      }
    },
  }
}

// Integer columns are BIGINT (millisecond timestamps outgrow 32 bits), which
// Prisma hands back as `bigint` — a type JSON.stringify refuses. Every value
// the app stores fits a double, so results are numbers again before any
// caller sees them.
const toPlain = (value) => {
  if (typeof value === 'bigint') return Number(value)
  if (Array.isArray(value)) return value.map(toPlain)
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    for (const key of Object.keys(value)) value[key] = toPlain(value[key])
  }
  return value
}

const current = new AsyncLocalStorage()
const gate = isPostgres ? null : createGate()

const base = new PrismaClient({ adapter, transactionOptions: { maxWait: 10_000, timeout: 30_000 } })
const client = base.$extends({
  query: {
    async $allOperations({ args, query }) {
      const run = () => query(args)
      return toPlain(gate && !current.getStore() ? await gate.read(run) : await run())
    },
  },
})

/** The client to query with: the open transaction's, or the shared one. */
export const db = () => current.getStore() ?? client

let open = 0

/**
 * How many transactions are in flight, process-wide. A cache must not keep an
 * answer computed while one is open: it may have read the state before that
 * transaction's commit (PostgreSQL) — or, inside it, a state that a rollback
 * is about to undo.
 */
export const transactionsOpen = () => open

/**
 * Run `fn` in one transaction. Nested calls join the outer one, so a module can
 * make its own writes atomic without knowing whether its caller already did.
 */
export function transaction(fn) {
  if (current.getStore()) return fn()
  const run = async () => {
    open++
    try {
      return await client.$transaction((tx) => current.run(tx, fn))
    } finally {
      open--
    }
  }
  return gate ? gate.write(run) : run()
}

export const closeMeta = () => base.$disconnect()

/**
 * Snapshot the store to `destPath` while the app keeps running. SQLite writes a
 * consistent copy with VACUUM INTO; PostgreSQL goes through pg_dump. Returns
 * the snapshot's size in bytes.
 */
export async function backupMeta(destPath) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true })
  if (!isPostgres) {
    await db().$executeRawUnsafe(`VACUUM INTO '${destPath.replaceAll("'", "''")}'`)
    return fs.statSync(destPath).size
  }
  const handle = openMeta()
  try {
    return snapshotMeta(handle, destPath)
  } finally {
    handle.close()
  }
}

/** 'ok', or what is wrong. SQLite checks the file; PostgreSQL answering is the check. */
export async function checkMetaIntegrity() {
  if (isPostgres) return (await db().$queryRaw`SELECT 1 AS ok`)[0]?.ok === 1 ? 'ok' : 'failed'
  const rows = await db().$queryRawUnsafe('PRAGMA integrity_check')
  return rows.map((r) => r.integrity_check).join('; ')
}

// Optional pre-seed from env — skips the first-run setup wizard. Seeds the
// instance administrator and nothing else, exactly like the wizard: an admin
// administers workspaces but never belongs to one (CLAUDE.md "AUTH MODEL"), so
// a workspace created here could only be ownerless. The admin signs in and
// creates the first workspace with a real owner (Admin → Workspaces).
export async function seedAdminFromEnv() {
  const hasUsers = !!(await db().users.findFirst({ select: { id: true } }))
  if (hasUsers || !process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) return

  await db().users.create({
    data: {
      id: randomUUID(),
      username: process.env.ADMIN_USERNAME,
      password_hash: sha256(process.env.ADMIN_PASSWORD),
      name: 'Admin',
      role: 'admin',
      status: 'active',
    },
  })
  console.log(`🌱 Seeded admin ${process.env.ADMIN_USERNAME} (create your first workspace from Admin → Workspaces)`)
}
