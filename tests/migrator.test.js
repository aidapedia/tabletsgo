import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { MIGRATIONS } from '../server/migrator/legacy/sqlite.js'

// The migrator reads its target from env once per process, so each case runs
// the real CLI (`scripts/migrate.js`) against its own SQLite file.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabletsgo-migrator-'))
const migrate = (file, ...args) => spawnSync(process.execPath, ['scripts/migrate.js', ...args], {
  encoding: 'utf8',
  env: { ...process.env, ENCRYPTION_KEY: 'migrator-test-key', META_DB_TYPE: 'sqlite', META_DB: file },
})
const appliedNames = (db) => db.prepare('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL').all().map((r) => r.migration_name)

test('a fresh database is built from the Prisma baseline and seeded', () => {
  const file = path.join(dir, 'fresh.db')
  assert.equal(migrate(file, '--status').status, 2, 'pending before the first run')
  const run = migrate(file)
  assert.equal(run.status, 0, run.stderr)

  const db = new Database(file, { readonly: true })
  assert.deepEqual(appliedNames(db), ['0_baseline'])
  assert.deepEqual(db.prepare('SELECT slug FROM roles WHERE builtin = 1 ORDER BY slug').all().map((r) => r.slug), ['member', 'owner'])
  assert.equal(db.prepare("SELECT path FROM resource_nodes WHERE id = 'root'").get().path, '/root')
  // An image from before Prisma must see this database as already at v22.
  assert.equal(db.pragma('user_version', { simple: true }), MIGRATIONS.at(-1).version)
  db.close()

  const again = migrate(file)
  assert.equal(again.status, 0, again.stderr)
  assert.match(again.stdout, /up to date/)
  assert.equal(migrate(file, '--status').status, 0)
})

test('a pre-Prisma install runs the legacy steps, then adopts the baseline without re-running it', () => {
  const file = path.join(dir, 'legacy.db')
  const legacy = new Database(file)
  const ctx = { encryptSecret: (x) => x, encryptAppSetting: (x) => x }
  for (const step of MIGRATIONS.filter((m) => m.version <= 20)) {
    legacy.transaction(() => {
      step.up(legacy, ctx)
      legacy.pragma(`user_version = ${step.version}`)
    })()
  }
  legacy.prepare("INSERT INTO users (id, username, password_hash, role) VALUES ('u1', 'a@example.com', 'h', 'admin')").run()
  legacy.close()

  const run = migrate(file)
  assert.equal(run.status, 0, run.stderr)
  assert.match(run.stdout, /Legacy steps: v20 → v22/)
  assert.match(run.stdout, /Recorded 0_baseline as applied/)

  const db = new Database(file, { readonly: true })
  assert.deepEqual(appliedNames(db), ['0_baseline'])
  assert.ok(db.prepare('PRAGMA table_info(ssh_gateways)').all().some((c) => c.name === 'transport'), 'v22 ran')
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM users').get().c, 1, 'data survives')
  db.close()
  assert.ok(fs.readdirSync(path.join(dir, 'backups')).some((f) => f.startsWith('pre-migrate-v20-')), 'snapshot taken')
})

test('both engines declare the same models', () => {
  const models = (engine) => {
    const schema = fs.readFileSync(`prisma/${engine}/schema.prisma`, 'utf8')
    return schema.slice(schema.indexOf('\nmodel ')).replace(/\/\/\/ Pre-Prisma version marker[\s\S]*?\n}\n\n/, '')
  }
  assert.equal(models('sqlite'), models('postgresql'))
})
