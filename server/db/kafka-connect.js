/**
 * Kafka Connect, over its REST API (the connection's `connectUrl`): connectors
 * with their state and tasks, their configs, the plugins a worker has, and the
 * lifecycle — pause, resume, stop, restart (all tasks or only the failed ones),
 * reset offsets, delete.
 */

import { restRequest } from './kafka-rest.js'

const enc = encodeURIComponent
const call = (conn, path, options = {}) => restRequest(conn, 'connect', { path, ...options })

const summary = (name, s = {}, info = {}) => {
  const tasks = (s.tasks || []).map((t) => ({ id: t.id, state: t.state, workerId: t.worker_id, trace: t.trace || null }))
  return {
    name,
    type: s.type || info.type || null,
    state: s.connector?.state || 'UNKNOWN',
    workerId: s.connector?.worker_id || null,
    trace: s.connector?.trace || null,
    className: info.config?.['connector.class'] || null,
    tasks,
    failedTasks: tasks.filter((t) => t.state === 'FAILED').length,
  }
}

/** Every connector with its state, class and tasks — one request, expanded. */
export async function listConnectors(conn) {
  const all = await call(conn, '/connectors?expand=status&expand=info')
  return Object.entries(all || {})
    .map(([name, v]) => summary(name, v.status, v.info))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** One connector: state, tasks (with failure traces), config and the topics it touched. */
export async function describeConnector(conn, name) {
  const [status, config, topics] = await Promise.all([
    call(conn, `/connectors/${enc(name)}/status`),
    call(conn, `/connectors/${enc(name)}/config`),
    // Topic tracking can be disabled on the worker; the rest still stands.
    call(conn, `/connectors/${enc(name)}/topics`).catch(() => null),
  ])
  return { ...summary(name, status, { config }), config, topics: topics?.[name]?.topics || [] }
}

/** The connector classes installed on the workers. */
export async function listConnectorPlugins(conn) {
  const plugins = await call(conn, '/connector-plugins?connectorsOnly=true')
  return (plugins || []).map((p) => ({ className: p.class, type: p.type, version: p.version })).sort((a, b) => a.className.localeCompare(b.className))
}

const configOf = (config) => {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw Object.assign(new Error('A connector config is an object of string settings.'), { status: 400 })
  if (!config['connector.class']) throw Object.assign(new Error('The config needs connector.class.'), { status: 400 })
  return Object.fromEntries(Object.entries(config).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]))
}

/**
 * Validate a config against its plugin without saving it: the errors per field,
 * as the worker reports them.
 */
export async function validateConnector(conn, name, config) {
  const body = { ...configOf(config), name }
  const r = await call(conn, `/connector-plugins/${enc(body['connector.class'])}/config/validate`, { method: 'PUT', body })
  return {
    errorCount: r.error_count || 0,
    errors: (r.configs || []).filter((c) => c.value?.errors?.length).map((c) => ({ name: c.value.name, errors: c.value.errors })),
  }
}

/** Create the connector, or replace its config (PUT is create-or-update). */
export async function saveConnector(conn, name, config) {
  if (!String(name || '').trim()) throw Object.assign(new Error('A connector needs a name.'), { status: 400 })
  const r = await call(conn, `/connectors/${enc(name)}/config`, { method: 'PUT', body: configOf(config) })
  return { ok: true, name: r?.name || name }
}

const ACTIONS = new Set(['pause', 'resume', 'stop', 'restart', 'restartTask', 'resetOffsets'])

/**
 * One lifecycle action. `restart` restarts the connector and its tasks
 * (`onlyFailed` narrows it to the failed ones); `restartTask` restarts `task`;
 * `resetOffsets` needs the connector STOPPED first — Connect's rule.
 */
export async function connectorAction(conn, name, { action, task, onlyFailed = false } = {}) {
  if (!ACTIONS.has(action)) throw Object.assign(new Error(`action must be one of ${[...ACTIONS].join(', ')}.`), { status: 400 })
  const at = `/connectors/${enc(name)}`
  try {
    if (action === 'pause' || action === 'resume' || action === 'stop') await call(conn, `${at}/${action}`, { method: 'PUT' })
    else if (action === 'restart') await call(conn, `${at}/restart?includeTasks=true&onlyFailed=${Boolean(onlyFailed)}`, { method: 'POST' })
    else if (action === 'restartTask') {
      if (task == null || task === '') throw Object.assign(new Error('Name the task to restart.'), { status: 400 })
      await call(conn, `${at}/tasks/${enc(String(task))}/restart`, { method: 'POST' })
    } else await call(conn, `${at}/offsets`, { method: 'DELETE' })
  } catch (error) {
    // An unknown endpoint answers a bare "HTTP 404 Not Found"; an unknown connector names itself.
    if (error.httpStatus === 404 && /^HTTP 404/i.test(error.message) && (action === 'stop' || action === 'resetOffsets')) {
      throw Object.assign(new Error(`This Connect cluster has no "${action === 'stop' ? 'stop' : 'reset offsets'}" — it needs Kafka Connect 3.5+ (stop) / 3.6+ (offsets).`), { status: 400 })
    }
    throw error
  }
  return { ok: true }
}

export async function deleteConnector(conn, name) {
  await call(conn, `/connectors/${enc(name)}`, { method: 'DELETE' })
  return { ok: true }
}
