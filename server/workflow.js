/**
 * Workflow executor — runs a saved node graph and records the outcome.
 *
 * SECURITY: workflows run arbitrary SQL, make server-side HTTP requests (can
 * reach internal URLs — SSRF) and evaluate user JavaScript. `node:vm` is NOT a
 * hard security boundary. This is acceptable here because only authenticated
 * workspace members can create/run workflows — the same trust level as the
 * existing "run any SQL" query editor. Do not expose this to untrusted users.
 */

import fs from 'fs'
import vm from 'node:vm'
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'crypto'
import { meta } from './meta.js'
import { getConnection } from './connections.js'
import { computeNextRun, jsonPreview, safeJson } from './util.js'
import { exportDatabaseToFile, runQueryOrThrow } from './db/index.js'
import { storeFile } from './storage.js'

// A curated crypto surface exposed to the JS node's sandbox. We deliberately do
// NOT expose `require`/`node:crypto` wholesale (that would also reach fs, process,
// child_process, …) — only these pure, allocation-bounded helpers, which cover the
// common need of signing an outbound HTTP request (e.g. an HMAC-SHA256 header).
// `data`/`key` are coerced to strings; digest encoding defaults to hex.
const sandboxCrypto = {
  hmac: (algo, key, data, enc = 'hex') => createHmac(String(algo), String(key)).update(String(data)).digest(enc),
  hash: (algo, data, enc = 'hex') => createHash(String(algo)).update(String(data)).digest(enc),
  randomUUID: () => randomUUID(),
  base64: (s) => Buffer.from(String(s)).toString('base64'),
  base64url: (s) => Buffer.from(String(s)).toString('base64url'),
  hex: (s) => Buffer.from(String(s)).toString('hex'),
  // Constant-time string compare, for verifying an incoming signature.
  timingSafeEqual: (a, b) => {
    const ba = Buffer.from(String(a))
    const bb = Buffer.from(String(b))
    return ba.length === bb.length && timingSafeEqual(ba, bb)
  },
}

// Run a user JS snippet in a sandbox. `code` is a function body that receives
// `input` and returns a value. 3s CPU timeout, no require/process/fs; `crypto`
// is a curated helper (see sandboxCrypto) for hashing/HMAC signing.
function runUserJs(code, input) {
  const logs = []
  const sandbox = {
    input,
    crypto: sandboxCrypto,
    console: { log: (...a) => logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')) },
    __out: undefined,
  }
  vm.createContext(sandbox)
  const script = new vm.Script(`__out = (function(input){ ${code}\n})(input)`)
  script.runInContext(sandbox, { timeout: 3000 })
  return { out: sandbox.__out, logs }
}

// Substitute {{input.path}} placeholders in a query node's SQL with values
// from the node's input (e.g. a dashboard table row), rendered as SQL literals.
// Dialect-agnostic on purpose: single-quoted strings with '' doubling, bare
// numeric literals, and NULL are valid in every roadmap dialect. Non-scalar
// values are an error, not silently stringified.
//
// An optional `:ident` modifier — `{{input.field:ident}}` — renders the value
// as a quoted SQL *identifier* (double-quoted with "" doubling) instead of a
// literal, for the few statements that take a bare name and can't be
// parameterized (e.g. VACUUM/ANALYZE/REINDEX <table>). Double-quoted identifiers
// are standard SQL, so this stays dialect-agnostic. The value must be a
// non-empty string; NULL/number/boolean are rejected so an identifier slot can
// never silently vanish or inject.
export function substituteWorkflowInput(sql, input) {
  return sql.replace(/\{\{\s*input((?:\.[A-Za-z_][A-Za-z0-9_]*)+)\s*(?::\s*(ident))?\s*\}\}/g, (_, path, mod) => {
    let v = input
    for (const key of path.slice(1).split('.')) v = v?.[key]
    if (mod === 'ident') {
      if (typeof v !== 'string' || v === '')
        throw new Error(`{{input${path}:ident}} must be a non-empty string identifier (got ${v === null || v === undefined ? 'null' : typeof v})`)
      return `"${v.replace(/"/g, '""')}"`
    }
    if (v === null || v === undefined) return 'NULL'
    if (typeof v === 'number' && Number.isFinite(v)) return String(v)
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
    if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`
    throw new Error(`{{input${path}}} is not a scalar value (got ${Array.isArray(v) ? 'array' : typeof v})`)
  })
}

// Run one query node against the connection. On a command-driven engine (Redis)
// the node's "SQL" is a command line — same {{input.x}} substitution, same
// result shape, so workflows and dashboards need no engine-specific handling.
// Throws on a failed statement: that's what marks the node (and the run) failed.
const runNodeQuery = (conn, sql) => runQueryOrThrow(conn, { schema: 'public' }, sql)

// Execute a workflow graph. Threads each node's output to its successor(s).
// Returns { ok, log, output, error? }.
export async function runWorkflow(conn, graph, initialInput = null) {
  const nodes = new Map((graph?.nodes || []).map((n) => [n.id, n]))
  const edges = graph?.edges || []
  const outgoing = (id, handle = 'out') => edges.filter((e) => e.source === id && (e.sourceHandle || 'out') === handle)
  const log = []
  const started = Date.now()
  // Export/Store nodes dump+upload a whole database, which can take well past
  // 20s for a large one — give graphs using them a much longer budget than the
  // ordinary query/http/js automation graphs this guard is meant to bound.
  const isLongRunning = (graph?.nodes || []).some((n) => n.type === 'export' || n.type === 'storage')
  const OVERALL_MS = isLongRunning ? 30 * 60 * 1000 : 20000
  const STEP_BUDGET = 5000
  const MAX_ITER = 1000
  let steps = 0

  const guard = () => {
    if (++steps > STEP_BUDGET) throw new Error('Step budget exceeded — possible infinite loop.')
    if (Date.now() - started > OVERALL_MS) throw new Error('Workflow timed out (20s).')
  }

  // Compute a leaf node's output (schedule/query/http/js). Logs its own entry.
  async function evalLeaf(node, input) {
    const t0 = Date.now()
    const entry = { nodeId: node.id, nodeType: node.type, status: 'ok', ms: 0, output: undefined }
    log.push(entry)
    try {
      const d = node.data || {}
      let output
      if (node.type === 'schedule' || node.type === 'manual' || node.type === 'webhook') {
        output = input // trigger node — pass the initial input straight through
      } else if (node.type === 'query') {
        if (!d.sql?.trim()) throw new Error('No query configured')
        const r = await runNodeQuery(conn, substituteWorkflowInput(d.sql, input))
        output = r.type === 'rows' ? { columns: r.columns, rows: r.rows } : { message: r.message }
      } else if (node.type === 'http') {
        if (!d.url?.trim()) throw new Error('No URL configured')
        const method = (d.method || 'GET').toUpperCase()
        const headers = typeof d.headers === 'string' ? safeJson(d.headers) : d.headers || {}
        const res = await fetch(d.url, {
          method,
          headers,
          body: method === 'GET' || method === 'HEAD' ? undefined : d.body || undefined,
        })
        const ct = res.headers.get('content-type') || ''
        const body = ct.includes('application/json') ? await res.json().catch(() => null) : await res.text()
        output = { status: res.status, ok: res.ok, headers: Object.fromEntries(res.headers), body }
      } else if (node.type === 'js') {
        const { out, logs } = runUserJs(d.code || 'return input', input)
        if (logs.length) entry.logs = logs
        output = out
      } else if (node.type === 'export') {
        output = await exportDatabaseToFile(conn)
      } else if (node.type === 'storage') {
        if (!input?.filePath) throw new Error('No file to store — connect this after a node that outputs a file (e.g. Export SQL)')
        output = await storeFile(conn, input, d.destinationIds || [], { encrypt: !!d.encrypt, retentionDays: d.retentionDays || 0 })
        fs.rm(input.filePath, { force: true }, () => {}) // best-effort cleanup, now that storage has read it
        // storeFile never throws (it records a per-destination ok:false instead,
        // so one bad destination doesn't hide another's successful key) —
        // surface any failure as a node error here so the run's status/retry/
        // failure-notification pipeline (and the calendar's "failed" marker) see
        // it. Preserve the full per-destination output first so a partial
        // success's upload key is still recoverable for Restore.
        entry.output = jsonPreview(output)
        const failed = output.uploaded.filter((u) => !u.ok)
        if (failed.length) throw new Error(`Upload failed for ${failed.length} of ${output.uploaded.length} destination(s): ${failed[0].error}`)
      } else {
        output = input
      }
      entry.output = jsonPreview(output)
      entry.ms = Date.now() - t0
      return output
    } catch (err) {
      entry.status = 'error'
      entry.error = err.message
      entry.ms = Date.now() - t0
      throw err
    }
  }

  // Walk the graph from `node`, returning the terminal output of its path.
  async function walk(node, input) {
    guard()
    // Switch: evaluate cases, follow only the matched branch.
    if (node.type === 'switch') {
      const t0 = Date.now()
      const entry = { nodeId: node.id, nodeType: 'switch', status: 'ok', ms: 0, output: undefined }
      log.push(entry)
      let handle = 'default'
      try {
        const cases = node.data?.cases || []
        for (let i = 0; i < cases.length; i++) {
          const { out } = runUserJs(`return (${cases[i].expr || 'false'})`, input)
          if (out) {
            handle = `case-${i}`
            break
          }
        }
        entry.output = jsonPreview({ matched: handle })
        entry.ms = Date.now() - t0
      } catch (err) {
        entry.status = 'error'
        entry.error = err.message
        throw err
      }
      let terminal = input
      for (const e of outgoing(node.id, handle)) {
        const child = nodes.get(e.target)
        if (child) terminal = await walk(child, input)
      }
      return terminal
    }
    // Loop: run the body branch per item, collect results, then continue.
    if (node.type === 'loop') {
      const t0 = Date.now()
      const entry = { nodeId: node.id, nodeType: 'loop', status: 'ok', ms: 0, output: undefined }
      log.push(entry)
      let items = input
      try {
        if (node.data?.itemsExpr?.trim()) items = runUserJs(`return (${node.data.itemsExpr})`, input).out
        if (!Array.isArray(items)) throw new Error('Loop input is not an array')
      } catch (err) {
        entry.status = 'error'
        entry.error = err.message
        throw err
      }
      const results = []
      const body = outgoing(node.id, 'body')
      for (let i = 0; i < items.length && i < MAX_ITER; i++) {
        for (const e of body) {
          const child = nodes.get(e.target)
          if (child) results.push(await walk(child, items[i]))
        }
      }
      entry.output = jsonPreview({ iterations: Math.min(items.length, MAX_ITER) })
      entry.ms = Date.now() - t0
      let terminal = results
      for (const e of outgoing(node.id, 'done')) {
        const child = nodes.get(e.target)
        if (child) terminal = await walk(child, results)
      }
      return terminal
    }
    // Leaf node → compute, then follow default output.
    const output = await evalLeaf(node, input)
    let terminal = output
    for (const e of outgoing(node.id, 'out')) {
      const child = nodes.get(e.target)
      if (child) terminal = await walk(child, output)
    }
    return terminal
  }

  try {
    const hasIncoming = new Set(edges.map((e) => e.target))
    const roots = (graph?.nodes || []).filter((n) => !hasIncoming.has(n.id))
    if (!roots.length) return { ok: false, log, error: 'No start node (every node has an incoming connection).' }
    let output
    for (const r of roots) output = await walk(r, initialInput)
    return { ok: true, log, output: jsonPreview(output, 8000) }
  } catch (err) {
    return { ok: false, log, error: err.message }
  }
}

// Run a workflow and persist the outcome to workflow_runs — shared by the
// manual "Run" route, the webhook trigger and the scheduler tick, so all of them
// count toward a workflow's run history.
export async function executeAndRecord(workflowId, connectionId, conn, graph, triggerKind, input = null) {
  const startedAt = Date.now()
  const result = await runWorkflow(conn, graph, input)
  meta
    .prepare(
      `INSERT INTO workflow_runs (id, workflow_id, connection_id, trigger_kind, status, log, error, started_at, finished_at, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      workflowId,
      connectionId,
      triggerKind,
      result.ok ? 'success' : 'failed',
      JSON.stringify(result.log || []),
      result.error || null,
      startedAt,
      Date.now(),
      startedAt
    )
  return result
}

// The schedule node's next firing time for a graph, or null when it isn't on a
// recurring schedule. Used whenever a workflow's graph or enabled flag changes.
export function nextRunForGraph(graph, enabled) {
  const schedNode = (graph?.nodes || []).find((n) => n.type === 'schedule')
  return enabled && schedNode?.data?.frequency && schedNode.data.frequency !== 'manual'
    ? computeNextRun(schedNode.data.frequency, schedNode.data.hourOfDay)
    : null
}

// Find workflows due to run (schedule_enabled + next_run_at reached), execute
// each, and roll their next_run_at forward. Claiming next_run_at before the
// run starts means a slow run can't get double-fired by the next tick.
export async function runDueWorkflows() {
  const due = meta.prepare('SELECT * FROM workflows WHERE schedule_enabled = 1 AND next_run_at <= ?').all(Date.now())
  for (const wf of due) {
    const graph = safeJson(wf.graph)
    const nextRun = nextRunForGraph(graph, true)
    if (!nextRun) {
      // Schedule node was edited away from hourly/daily — stop trying to fire it.
      meta.prepare('UPDATE workflows SET schedule_enabled = 0, next_run_at = NULL WHERE id = ?').run(wf.id)
      continue
    }
    meta.prepare('UPDATE workflows SET next_run_at = ? WHERE id = ?').run(nextRun, wf.id)
    const conn = getConnection(wf.connection_id)
    if (!conn) continue
    executeAndRecord(wf.id, wf.connection_id, conn, graph, 'schedule').catch((e) =>
      console.error(`Scheduled run failed for workflow ${wf.id}:`, e.message)
    )
  }
}
