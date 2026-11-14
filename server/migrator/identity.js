/**
 * Which mode this instance runs in — solo or enterprise — decided once per boot,
 * recorded in the store, and what moves between them.
 *
 *   1. TABLETSGO_MODE, when it is set.
 *   2. Otherwise the mode the store recorded (`app_settings` key `identity`).
 *   3. Otherwise enterprise if HAYAT_ISSUER is set, else solo.
 *
 * The recorded mode is what stops a lost env var from turning a team instance
 * into a fresh solo one with its first-run setup open to the network: an
 * instance recorded as enterprise never boots as solo. Solo → enterprise is the
 * supported direction; it writes the Hayat import bundle.
 *
 * A v1.0 database (accounts in tabletsgo's own tables) moving to solo is
 * handled before the drop migration removes those tables: `captureSoloOwner`
 * keeps one account as the owner and folds every workspace into one.
 *
 * Synchronous over migrator handles (server/meta-connection.js), like the rest
 * of server/migrator — it runs before server/meta.js is evaluated.
 */

import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { DATA_DIR, HAYAT_ISSUER, META_DB_TYPE, MODE_SETTING, SOLO_OWNER } from '../config.js'
import { exportSoloBundle } from './hayat-export.js'

export const IDENTITY_KEY = 'identity'
export const SOLO_KEY = 'solo'
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const isPostgres = META_DB_TYPE === 'postgresql'

const hasTable = (db, name) =>
  isPostgres
    ? !!db.prepare('SELECT to_regclass(?) AS name').get(name).name
    : !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)

export function readSetting(db, key) {
  if (!hasTable(db, 'app_settings')) return null
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key)
  try {
    return row?.value ? JSON.parse(row.value) : null
  } catch {
    return null
  }
}

export function writeSetting(db, key, value) {
  db.prepare(
    'INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
  ).run(key, JSON.stringify(value), Date.now())
}

const count = (db, table) => (hasTable(db, table) ? Number(db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c) : 0)

// What the environment says (server/config.js); tests pass their own.
const ENV = { setting: MODE_SETTING, hayatIssuer: HAYAT_ISSUER, soloOwner: SOLO_OWNER }

/** The mode the environment and the store point at, before anything is checked. */
export function intendedMode(db, env = ENV) {
  return env.setting || readSetting(db, IDENTITY_KEY)?.mode || (env.hayatIssuer ? 'enterprise' : 'solo')
}

// ---- v1.0 → solo -------------------------------------------------------------------

// Every table a workspace's records hang off; folded into the one solo workspace.
const WORKSPACE_TABLES = ['connections', 'storage_destinations', 'ssh_gateways', 'ssh_keys', 'schema_drafts']

/**
 * Before the drop migration: keep one of tabletsgo's own accounts as the solo
 * owner. One account → it. Several → the one SOLO_OWNER names, or refuse (the
 * drop hasn't run, so nothing is lost by stopping). Their old unsalted hash is
 * kept as `$sha256$…` and replaced at their first sign-in.
 *
 * Solo has one workspace: the oldest one stays, and every other workspace's
 * records move into it. Every connection becomes the owner's.
 */
export function captureSoloOwner(db, log = console.log, { soloOwner = SOLO_OWNER } = {}) {
  if (!hasTable(db, 'users') || readSetting(db, SOLO_KEY)?.owner) return null
  const people = db.prepare('SELECT * FROM users').all().filter((u) => EMAIL.test(String(u.username || '').trim()))
  if (!people.length) return null
  let owner = people.length === 1 ? people[0] : null
  if (soloOwner) owner = people.find((u) => String(u.username).trim().toLowerCase() === soloOwner) || null
  if (!owner) {
    throw new Error(
      soloOwner
        ? `SOLO_OWNER=${soloOwner} isn't one of this instance's ${people.length} accounts.`
        : `This instance has ${people.length} accounts, and solo mode keeps one person. Either run it in enterprise mode with Hayat ` +
            '(set TABLETSGO_MODE=enterprise and the HAYAT_* variables; everyone keeps access), or set SOLO_OWNER=<email> to keep ' +
            'that person and every workspace’s data (the others lose access).'
    )
  }

  const workspaces = hasTable(db, 'workspaces') ? db.prepare('SELECT id, name FROM workspaces ORDER BY created_at').all() : []
  const keep = workspaces[0] || { id: randomUUID(), name: 'Personal' }
  db.transaction(() => {
    for (const table of WORKSPACE_TABLES) {
      if (!hasTable(db, table)) continue
      db.prepare(`UPDATE ${table} SET workspace_id = ? WHERE workspace_id IS NULL OR workspace_id <> ?`).run(keep.id, keep.id)
    }
    if (hasTable(db, 'connections')) db.prepare('UPDATE connections SET owner_id = ?').run(owner.id)
    if (workspaces.length) db.prepare('DELETE FROM workspaces WHERE id <> ?').run(keep.id)
    writeSetting(db, SOLO_KEY, {
      owner: {
        id: owner.id,
        email: String(owner.username).trim().toLowerCase(),
        name: owner.name || '',
        timezone: owner.timezone || null,
        passwordHash: owner.password_hash ? `$sha256$${owner.password_hash}` : '',
      },
      workspace: { id: keep.id, name: keep.name || 'Personal' },
      tokenEpoch: 0,
    })
  })()
  log(`👤 Solo mode: ${owner.username} owns this instance${workspaces.length > 1 ? ` (${workspaces.length} workspaces folded into “${keep.name}”)` : ''}.`)
  if (people.length > 1) log(`   ${people.length - 1} other account(s) no longer have access; the Hayat bundle written beside the data still holds them.`)
  return owner.id
}

// ---- Every boot ----------------------------------------------------------------------

/** Write the bundle `hayat import` loads, from the solo owner and their workspace. */
export function writeSoloBundle(db, log = console.log, dir = DATA_DIR) {
  const bundle = exportSoloBundle(db, (name) => hasTable(db, name))
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `hayat-import-${Date.now()}.json`)
  fs.writeFileSync(file, JSON.stringify(bundle, null, 2), { mode: 0o600 })
  log(`🪪 Moving to enterprise: wrote ${file} (${bundle.users.length} person, ${bundle.tenants.length} workspace).`)
  log('   Load it with `hayat import --file <that file> --app-url <this instance>`, then sign up at Hayat with the owner’s email.')
  return file
}

/**
 * Decide the mode, record it, and make sure solo has its setting. `wasHayat` is
 * true for a database that was already past the drop migration before this
 * boot — an install from before modes existed, which ran under Hayat.
 */
export function resolveIdentity(db, { wasHayat = false, log = console.log, env = ENV, bundleDir = DATA_DIR } = {}) {
  const recorded = readSetting(db, IDENTITY_KEY)
  let stored = recorded?.mode || null
  if (!stored && wasHayat && !readSetting(db, SOLO_KEY) && (count(db, 'workspaces') || count(db, 'connections'))) stored = 'enterprise'
  const resolved = env.setting || stored || (env.hayatIssuer ? 'enterprise' : 'solo')

  if (stored === 'enterprise' && resolved === 'solo') {
    throw new Error(
      'This instance runs in enterprise mode: its people live in Hayat, and solo mode can’t take them back. ' +
        'Set TABLETSGO_MODE=enterprise and the HAYAT_* variables. To start over alone, export your connections and import them into a new solo instance.'
    )
  }

  if (resolved === 'solo' && !readSetting(db, SOLO_KEY)) {
    writeSetting(db, SOLO_KEY, { owner: null, workspace: { id: randomUUID(), name: 'Personal' }, tokenEpoch: 0 })
  }
  if (stored === 'solo' && resolved === 'enterprise' && readSetting(db, SOLO_KEY)?.owner) writeSoloBundle(db, log, bundleDir)

  if (stored !== resolved) {
    writeSetting(db, IDENTITY_KEY, { mode: resolved, since: Date.now(), from: stored })
    log(stored ? `🔁 Mode: ${stored} → ${resolved}` : `🧭 Mode: ${resolved}`)
  }
  return resolved
}
