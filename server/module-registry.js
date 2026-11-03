/**
 * The instance's modules — which databases and features this instance offers,
 * and their instance-wide settings. An instance admin decides, in the first-run
 * wizard and later in Admin → Modules; every workspace sees only what's on.
 *
 * Everything ships in the build: a module is a switch plus settings, not code
 * loaded at runtime. Two kinds:
 *   engine   a connection type — its id is the db driver's `type`
 *   feature  a capability across connections (Backup)
 *
 * This file is the catalog and an in-memory copy of the admin's choices, and
 * imports nothing — so the db layer can ask `isModuleEnabled` on
 * every dispatch without reaching the metadata store (same idea as
 * permissions-catalog.js). Loading and saving the choices is
 * server/module-settings.js, which hands the result here via `setModuleState`.
 *
 * A module with no stored choice is on, so an upgrade hides nothing.
 */

/**
 * A setting is an integer the admin may change: `default` until they do, `step`
 * what one click of the admin form's stepper moves it by. Admin → Modules is the
 * only place one is set — there is no env var under it.
 */

// Every engine with a console. The browser stops waiting after this — a
// statement already running on the database may still finish.
const QUERY_TIMEOUT = {
  key: 'queryTimeoutSec',
  label: 'Query timeout',
  help: 'How long the console waits for a query or command before giving up. The browser stops waiting; a statement already running on the database may still finish.',
  unit: 'seconds',
  min: 1,
  max: 3600,
  step: 5,
  default: 30,
}

// Every engine with tables: the most rows opening one fetches. The server caps
// the table fetch to it, whatever the client asks for.
const TABLE_ROW_LIMIT = {
  key: 'tableRowLimit',
  label: 'Table row limit',
  help: 'The most rows fetched when someone opens a table.',
  unit: 'rows',
  min: 1,
  max: 1000000,
  step: 1000,
  default: 50000,
}

export const MODULES = [
  { id: 'postgresql', kind: 'engine', label: 'PostgreSQL', description: 'Relational, over the network.', settings: [TABLE_ROW_LIMIT, QUERY_TIMEOUT] },
  { id: 'sqlite', kind: 'engine', label: 'SQLite', description: 'A database file on this server.', settings: [TABLE_ROW_LIMIT, QUERY_TIMEOUT] },
  { id: 'redis', kind: 'engine', label: 'Redis', description: 'Key-value, over the network.', settings: [QUERY_TIMEOUT] },
  {
    id: 'kafka',
    kind: 'engine',
    label: 'Kafka',
    description: 'Event streaming: topics, consumer groups, Schema Registry, Kafka Connect and ksqlDB.',
    settings: [
      {
        key: 'readMaxMessages',
        label: 'Messages per read',
        help: 'The most messages one read returns — the topic browser, CONSUME, workflow and dashboard queries.',
        unit: 'messages',
        min: 1,
        max: 100000,
        step: 100,
        default: 500,
      },
      {
        key: 'readMaxBytes',
        label: 'Bytes fetched per read',
        help: 'How much a read pulls from the brokers before it stops — what a WHERE filter can scan through.',
        unit: 'bytes',
        min: 1024,
        max: 1024 * 1024 * 1024,
        step: 1024 * 1024,
        default: 16 * 1024 * 1024,
      },
      {
        key: 'readTimeoutMs',
        label: 'Read time limit',
        help: 'How long one read may run, including a ksqlDB query.',
        unit: 'ms',
        min: 500,
        max: 120000,
        step: 1000,
        default: 8000,
      },
      QUERY_TIMEOUT,
    ],
  },
  {
    id: 'backup',
    kind: 'feature',
    label: 'Backup',
    description: 'Scheduled dumps of PostgreSQL and SQLite connections to S3-compatible or local storage, with restore.',
  },
]

const byId = new Map(MODULES.map((m) => [m.id, m]))
export const moduleById = (id) => byId.get(id) || null

// { enabled: { [id]: boolean }, settings: { [id]: { [key]: number } } }
let state = { enabled: {}, settings: {} }

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v)

/** Replace the cached choices — server/module-settings.js calls this after every load and save. */
export function setModuleState(raw) {
  state = {
    enabled: isObject(raw?.enabled) ? { ...raw.enabled } : {},
    settings: isObject(raw?.settings) ? structuredClone(raw.settings) : {},
  }
}

export const getModuleState = () => structuredClone(state)

// An id the catalog doesn't define isn't this registry's to refuse.
export const isModuleEnabled = (id) => state.enabled[id] !== false

const resolve = (spec, stored) => (stored === undefined ? spec.default : stored)

/** A setting's value in effect right now: the admin's, else the default. */
export function moduleSetting(id, key) {
  const spec = byId.get(id)?.settings?.find((s) => s.key === key)
  if (!spec) throw new Error(`Unknown module setting: ${id}.${key}`)
  return resolve(spec, state.settings[id]?.[key])
}

/** Like moduleSetting, but undefined when the module has no such setting (an engine without tables has no row limit). */
export const optionalModuleSetting = (id, key) =>
  byId.get(id)?.settings?.some((s) => s.key === key) ? moduleSetting(id, key) : undefined

/** Every setting's value in effect, as `{ key: value }` — what any signed-in client reads. */
export const settingValues = (id) => Object.fromEntries((byId.get(id)?.settings || []).map((s) => [s.key, moduleSetting(id, s.key)]))

/** Every setting of a module, as the admin form shows it. */
export const settingsView = (id) =>
  (byId.get(id)?.settings || []).map((spec) => ({
    key: spec.key,
    label: spec.label,
    help: spec.help,
    unit: spec.unit,
    type: 'int',
    min: spec.min,
    max: spec.max,
    step: spec.step || 1,
    value: resolve(spec, state.settings[id]?.[spec.key]),
    default: spec.default,
  }))

export const moduleOffMessage = (id) =>
  `${byId.get(id)?.label || id} is turned off on this instance. An instance administrator can turn it on in Admin → Modules.`

export class ModuleError extends Error {
  constructor(message, status = 400, extra = {}) {
    super(message)
    this.name = 'ModuleError'
    this.status = status
    Object.assign(this, extra)
  }
}

/** Throw (403) when a known module is off — the guard for routes a disabled module owns. */
export function assertModuleEnabled(id) {
  if (byId.has(id) && !isModuleEnabled(id)) throw new ModuleError(moduleOffMessage(id), 403)
}

/**
 * The state a patch would produce, validated — without saving it or checking
 * who still uses an engine (that needs the metadata store; see
 * server/module-settings.js). Patch: `{ [id]: { enabled?, settings? } }`, where a
 * setting of `null` goes back to its default.
 */
export function planModuleChange(patch) {
  if (!isObject(patch)) throw new ModuleError('Expected an object of { [moduleId]: { enabled, settings } }.')
  const next = getModuleState()
  for (const [id, change] of Object.entries(patch)) {
    const m = byId.get(id)
    if (!m) throw new ModuleError(`Unknown module: ${id}`)
    if (!isObject(change)) throw new ModuleError(`${m.label}: expected { enabled, settings }.`)
    if (change.enabled !== undefined) {
      if (typeof change.enabled !== 'boolean') throw new ModuleError(`${m.label}: "enabled" must be true or false.`)
      next.enabled[id] = change.enabled
    }
    if (change.settings !== undefined) next.settings[id] = planSettings(m, next.settings[id] || {}, change.settings)
  }
  if (!MODULES.some((m) => m.kind === 'engine' && next.enabled[m.id] !== false)) {
    throw new ModuleError('Keep at least one database turned on — workspaces need something to connect to.')
  }
  return next
}

function planSettings(m, current, changes) {
  if (!isObject(changes)) throw new ModuleError(`${m.label}: "settings" must be an object.`)
  const out = { ...current }
  for (const [key, raw] of Object.entries(changes)) {
    const spec = m.settings?.find((s) => s.key === key)
    if (!spec) throw new ModuleError(`${m.label} has no setting "${key}".`)
    if (raw === null) {
      delete out[key]
      continue
    }
    const n = typeof raw === 'string' && raw.trim() === '' ? NaN : Number(raw)
    if (!Number.isInteger(n) || n < spec.min || n > spec.max) {
      throw new ModuleError(`${spec.label} must be a whole number from ${spec.min} to ${spec.max}.`)
    }
    out[key] = n
  }
  return out
}
