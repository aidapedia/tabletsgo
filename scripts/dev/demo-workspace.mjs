/**
 * The "Demo" workspace for development: people who reach its connections in
 * every way Hayat allows, and sample connections that open. Run by
 * `scripts/dev/hayat.sh setup` (so `npm run dev:hayat`) once, before the server
 * starts:
 *
 *   node --env-file-if-exists=.env scripts/dev/demo-workspace.mjs --tenant <id> --out <bundle.json>
 *
 * It writes tabletsgo's half (the sample SQLite files under data/samples/ and the
 * connection rows) and leaves Hayat's half (the tenant, its people, groups,
 * the mirrored connections and the grants) as an import bundle, which the shell
 * script hands to `hayat import`. Both halves use the same fixed connection ids,
 * so re-running is safe: files are rebuilt, rows upserted, and Hayat skips a
 * tenant it already has.
 *
 * Every password is Hayat's seed password (hayat-dev-password).
 *
 * Who can open what in Demo (★ = the case it shows):
 *
 *   person   in Demo as                         opens
 *   alice    owner (Workspace owner)            everything ★ the owner's role covers every connection
 *   bob      Engineering roster + Connection    Shop, Payments, Billing, Events; edits the last three
 *            manager on Engineering             ★ a role on a group, inherited by what is filed there
 *   carol    Engineering/Backend roster         Shop, Payments ★ placement: a subgroup's roster opens what is
 *                                               filed there, not what is filed in the parent group
 *   dave     member                             Shop, HR ★ a grant on one connection
 *   erin     Analytics roster                   Shop, Analytics (edits it: she owns it) ★ placement in another group
 *   admin    member                             Shop ★ the instance admin gets no data access from that role
 *   frank    not a member                       nothing ★ a stranger to the workspace (no workspace at all)
 *
 * Shop is shared with the whole workspace (Connection user granted to everyone
 * in it). Billing points at a Postgres nobody runs, to show a failed handshake;
 * Events is Kafka stack 1 (scripts/dev/kafka/stack.sh up 1).
 */

// First: migrate before server/meta.js opens the store (see server/migrator/boot.js).
import '../../server/migrator/boot.js'

import fs from 'fs'
import path from 'path'
import { createHash, randomUUID } from 'crypto'
import { createRequire } from 'module'
import { ROOT_DIR } from '../../server/config.js'
import { saveConnection } from '../../server/connections.js'
import { emptyBundle } from '../../server/migrator/hayat-export.js'
import { CONNECTION_TYPE, roleSlug } from '../../server/permissions-catalog.js'

const Database = createRequire(import.meta.url)('better-sqlite3')

const arg = (name) => {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : ''
}
const TENANT_ID = arg('--tenant')
const OUT = arg('--out')
if (!TENANT_ID || !OUT) {
  console.error('usage: demo-workspace.mjs --tenant <uuid> --out <bundle.json>')
  process.exit(2)
}

const SEED_PASSWORD = 'hayat-dev-password'
const SAMPLES_DIR = path.join(ROOT_DIR, 'data', 'samples')

// ---- People ----
// Hayat's seed made admin..dave; matched by email, so these ids only link them
// within the bundle. erin and frank are new: Hayat verifies `$sha256$` once and
// rehashes it, so they sign in with the same password as the rest.
const person = (email, name) => ({
  id: randomUUID(),
  email,
  name,
  passwordHash: `$sha256$${createHash('sha256').update(SEED_PASSWORD).digest('hex')}`,
  status: 'active',
  zoneinfo: '',
  admin: false,
})
const people = {
  admin: person('admin@hayat.test', 'Ada Admin'),
  alice: person('alice@hayat.test', 'Alice Owner'),
  bob: person('bob@hayat.test', 'Bob Manager'),
  carol: person('carol@hayat.test', 'Carol Member'),
  dave: person('dave@hayat.test', 'Dave Globex'),
  erin: person('erin@hayat.test', 'Erin Analyst'),
  frank: person('frank@hayat.test', 'Frank Outsider'),
}

// ---- Sample databases ----
// A tiny deterministic PRNG, so every run builds the same rows.
function rng(seed) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
}
const pick = (r, list) => list[Math.floor(r() * list.length)]
const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1))
const day = (r, fromIso, days) => new Date(Date.parse(fromIso) + int(r, 0, days) * 86400000).toISOString().slice(0, 10)

const FIRST = ['Ana', 'Budi', 'Chen', 'Dewi', 'Eko', 'Fatima', 'Gita', 'Hiro', 'Ines', 'Joko', 'Kim', 'Lena', 'Maya', 'Nadia', 'Omar', 'Putri', 'Rina', 'Sam', 'Tari', 'Yusuf']
const LAST = ['Wijaya', 'Santoso', 'Tan', 'Lestari', 'Hartono', 'Nguyen', 'Kusuma', 'Sato', 'Garcia', 'Pratama', 'Lee', 'Fischer']
const CITIES = ['Jakarta', 'Bandung', 'Surabaya', 'Singapore', 'Kuala Lumpur', 'Tokyo', 'Berlin', 'Austin']

// Build `file` from scratch with `fill(db)`.
function sampleDb(file, fill) {
  fs.mkdirSync(SAMPLES_DIR, { recursive: true })
  const full = path.join(SAMPLES_DIR, file)
  for (const f of [full, `${full}-wal`, `${full}-shm`]) fs.rmSync(f, { force: true })
  const db = new Database(full)
  db.transaction(() => fill(db))()
  db.close()
  return full
}

const insertAll = (db, table, rows) => {
  if (!rows.length) return
  const cols = Object.keys(rows[0])
  const stmt = db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((c) => '@' + c).join(', ')})`)
  for (const row of rows) stmt.run(row)
}

function shop(db) {
  const r = rng(1)
  db.exec(`
    CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, city TEXT, joined_on TEXT NOT NULL);
    CREATE TABLE products (id INTEGER PRIMARY KEY, sku TEXT NOT NULL UNIQUE, name TEXT NOT NULL, category TEXT NOT NULL, price_cents INTEGER NOT NULL, stock INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id), status TEXT NOT NULL, ordered_on TEXT NOT NULL);
    CREATE TABLE order_items (order_id INTEGER NOT NULL REFERENCES orders(id), product_id INTEGER NOT NULL REFERENCES products(id), quantity INTEGER NOT NULL, unit_price_cents INTEGER NOT NULL, PRIMARY KEY (order_id, product_id));
    CREATE INDEX orders_customer ON orders(customer_id);
    CREATE INDEX orders_status_date ON orders(status, ordered_on);
    CREATE VIEW revenue_by_month AS
      SELECT substr(o.ordered_on, 1, 7) AS month, COUNT(DISTINCT o.id) AS orders, SUM(i.quantity * i.unit_price_cents) / 100.0 AS revenue
      FROM orders o JOIN order_items i ON i.order_id = o.id WHERE o.status <> 'cancelled' GROUP BY month ORDER BY month;
  `)
  insertAll(db, 'customers', Array.from({ length: 200 }, (_, i) => {
    const first = pick(r, FIRST), last = pick(r, LAST)
    return { id: i + 1, name: `${first} ${last}`, email: `${first}.${last}.${i + 1}@example.com`.toLowerCase(), city: pick(r, CITIES), joined_on: day(r, '2024-01-01', 700) }
  }))
  const kinds = { Coffee: ['Arabica beans', 'Robusta beans', 'Cold brew pack', 'Espresso blend'], Gear: ['Pour-over kettle', 'Hand grinder', 'Dripper', 'Scale'], Merch: ['Mug', 'Tote bag', 'T-shirt', 'Cap'] }
  const products = Object.entries(kinds).flatMap(([category, names]) => names.map((name) => ({ category, name })))
  insertAll(db, 'products', products.map((p, i) => ({ id: i + 1, sku: `SKU-${1000 + i}`, name: p.name, category: p.category, price_cents: int(r, 5, 120) * 100 - 1, stock: int(r, 0, 300) })))
  const orders = Array.from({ length: 600 }, (_, i) => ({ id: i + 1, customer_id: int(r, 1, 200), status: pick(r, ['paid', 'paid', 'paid', 'shipped', 'shipped', 'pending', 'cancelled']), ordered_on: day(r, '2025-01-01', 300) }))
  insertAll(db, 'orders', orders)
  const prices = db.prepare('SELECT price_cents FROM products WHERE id = ?')
  for (const o of orders) {
    const ids = [...new Set(Array.from({ length: int(r, 1, 4) }, () => int(r, 1, products.length)))]
    insertAll(db, 'order_items', ids.map((pid) => ({ order_id: o.id, product_id: pid, quantity: int(r, 1, 3), unit_price_cents: prices.get(pid).price_cents })))
  }
}

function payments(db) {
  const r = rng(2)
  db.exec(`
    CREATE TABLE payments (id TEXT PRIMARY KEY, order_ref TEXT NOT NULL, method TEXT NOT NULL, amount_cents INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'IDR', status TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE refunds (id INTEGER PRIMARY KEY, payment_id TEXT NOT NULL REFERENCES payments(id), amount_cents INTEGER NOT NULL, reason TEXT, created_at TEXT NOT NULL);
    CREATE TABLE payment_events (id INTEGER PRIMARY KEY, payment_id TEXT NOT NULL REFERENCES payments(id), type TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX payments_status ON payments(status);
  `)
  const pays = Array.from({ length: 400 }, (_, i) => ({
    id: `pay_${(i + 1).toString(36).padStart(5, '0')}`,
    order_ref: `ORD-${int(r, 1, 600)}`,
    method: pick(r, ['card', 'card', 'bank_transfer', 'ewallet', 'qris']),
    amount_cents: int(r, 50, 5000) * 1000,
    currency: pick(r, ['IDR', 'IDR', 'IDR', 'SGD', 'USD']),
    status: pick(r, ['succeeded', 'succeeded', 'succeeded', 'failed', 'pending']),
    created_at: `${day(r, '2025-01-01', 300)} ${String(int(r, 0, 23)).padStart(2, '0')}:${String(int(r, 0, 59)).padStart(2, '0')}:00`,
  }))
  insertAll(db, 'payments', pays)
  insertAll(db, 'refunds', pays.filter(() => r() < 0.08).map((p, i) => ({ id: i + 1, payment_id: p.id, amount_cents: Math.round(p.amount_cents / int(r, 1, 2)), reason: pick(r, ['damaged', 'late delivery', 'duplicate', null]), created_at: p.created_at })))
  let n = 0
  insertAll(db, 'payment_events', pays.flatMap((p) => ['created', p.status === 'pending' ? null : p.status].filter(Boolean).map((type) => ({ id: ++n, payment_id: p.id, type, payload: JSON.stringify({ amount: p.amount_cents, currency: p.currency, method: p.method }), created_at: p.created_at }))))
}

function analytics(db) {
  const r = rng(3)
  db.exec(`
    CREATE TABLE daily_signups (day TEXT PRIMARY KEY, signups INTEGER NOT NULL, activated INTEGER NOT NULL);
    CREATE TABLE page_views (id INTEGER PRIMARY KEY, day TEXT NOT NULL, path TEXT NOT NULL, country TEXT NOT NULL, device TEXT NOT NULL, views INTEGER NOT NULL);
    CREATE INDEX page_views_day ON page_views(day);
  `)
  const days = Array.from({ length: 120 }, (_, i) => new Date(Date.parse('2025-06-01') + i * 86400000).toISOString().slice(0, 10))
  insertAll(db, 'daily_signups', days.map((d, i) => {
    const signups = int(r, 20, 60) + Math.floor(i / 4)
    return { day: d, signups, activated: Math.floor(signups * (0.4 + r() * 0.3)) }
  }))
  let n = 0
  insertAll(db, 'page_views', days.flatMap((d) => ['/', '/pricing', '/docs', '/blog', '/signup'].map((p) => ({ id: ++n, day: d, path: p, country: pick(r, ['ID', 'ID', 'SG', 'MY', 'JP', 'DE', 'US']), device: pick(r, ['desktop', 'mobile', 'mobile']), views: int(r, 10, 900) }))))
}

function hr(db) {
  const r = rng(4)
  db.exec(`
    CREATE TABLE departments (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
    CREATE TABLE employees (id INTEGER PRIMARY KEY, name TEXT NOT NULL, department_id INTEGER NOT NULL REFERENCES departments(id), title TEXT NOT NULL, hired_on TEXT NOT NULL);
    CREATE TABLE salaries (employee_id INTEGER PRIMARY KEY REFERENCES employees(id), monthly_idr INTEGER NOT NULL, reviewed_on TEXT NOT NULL);
  `)
  const depts = ['Engineering', 'Analytics', 'Sales', 'Operations', 'People']
  insertAll(db, 'departments', depts.map((name, i) => ({ id: i + 1, name })))
  const emps = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, name: `${pick(r, FIRST)} ${pick(r, LAST)}`, department_id: int(r, 1, depts.length), title: pick(r, ['Associate', 'Senior', 'Lead', 'Manager']), hired_on: day(r, '2019-01-01', 2200) }))
  insertAll(db, 'employees', emps)
  insertAll(db, 'salaries', emps.map((e) => ({ employee_id: e.id, monthly_idr: int(r, 8, 60) * 1_000_000, reviewed_on: day(r, '2025-01-01', 200) })))
}

// ---- Connections: the fixed ids tie each row to its mirror in Hayat ----
const id = (n) => `7ab1e75e-0de7-4000-8000-0000000000c${n}`
const connections = [
  { id: id(1), type: 'sqlite', name: 'Shop', environment: 'development', tags: ['sample', 'ecommerce'], filepath: sampleDb('shop.db', shop), owner: 'alice', parent: '' },
  { id: id(2), type: 'sqlite', name: 'Payments service', environment: 'staging', tags: ['sample', 'backend'], filepath: sampleDb('payments.db', payments), owner: 'bob', parent: 'backend' },
  { id: id(3), type: 'sqlite', name: 'Analytics warehouse', environment: 'production', tags: ['sample', 'analytics'], filepath: sampleDb('analytics.db', analytics), owner: 'erin', parent: 'analytics' },
  { id: id(4), type: 'sqlite', name: 'HR (restricted)', environment: 'production', tags: ['sample', 'restricted'], filepath: sampleDb('hr.db', hr), owner: 'alice', parent: '' },
  // Nothing listens here: the console shows the handshake failing and why.
  { id: id(5), type: 'postgresql', name: 'Billing (unreachable)', environment: 'production', tags: ['sample', 'broken'], host: '127.0.0.1', port: 6543, username: 'billing', password: 'not-a-real-password', database: 'billing', sslmode: 'disable', owner: 'bob', parent: 'eng' },
  // Opens once `scripts/dev/kafka/stack.sh up 1` runs; seed it with scripts/dev/kafka/seed.mjs 1.
  { id: id(6), type: 'kafka', name: 'Events (Kafka stack 1)', environment: 'local', tags: ['sample', 'kafka'], brokers: 'localhost:39096', owner: 'bob', parent: 'eng' },
]

for (const { owner, parent, ...conn } of connections) {
  await saveConnection({ ...conn, workspaceId: TENANT_ID, ownerId: people[owner].id })
}

// ---- Hayat's half ----
const p = (who) => `user:${people[who].id}`
const on = (n) => `resource:${CONNECTION_TYPE}:${id(n)}`
const bundle = emptyBundle()
bundle.users.push(...Object.values(people))
bundle.tenants.push({
  id: TENANT_ID,
  name: 'Demo',
  ownerId: people.alice.id,
  members: ['admin', 'alice', 'bob', 'carol', 'dave', 'erin'].map((w) => people[w].id),
  groups: [
    { key: 'eng', parent: '', name: 'Engineering', members: [people.bob.id] },
    { key: 'backend', parent: 'eng', name: 'Backend', members: [people.carol.id] },
    { key: 'analytics', parent: '', name: 'Analytics', members: [people.erin.id] },
  ],
  resources: connections.map((c) => ({ type: CONNECTION_TYPE, externalId: c.id, name: c.name, parent: c.parent, ownerId: people[c.owner].id })),
  grants: [
    { on: 'tenant', principal: p('alice'), role: 'hayat.tenant-admin', inherit: true },
    { on: 'tenant', principal: p('alice'), role: roleSlug('owner'), inherit: true },
    { on: 'group:eng', principal: p('bob'), role: roleSlug('connection-manager'), inherit: true },
    { on: on(1), principal: 'tenant', role: roleSlug('connection-user'), inherit: true },
    { on: on(4), principal: p('dave'), role: roleSlug('connection-user'), inherit: true },
  ],
})
fs.writeFileSync(OUT, JSON.stringify(bundle))
console.log(`Demo workspace: ${connections.length} connections written, sample databases in ${path.relative(process.cwd(), SAMPLES_DIR)}/.`)
// The meta store's client keeps the event loop alive.
process.exit(0)
