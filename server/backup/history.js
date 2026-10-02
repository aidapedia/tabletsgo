/** Reads and updates recorded backup runs. Routes handle authorization and storage IO. */
import { db } from '../meta.js'
import { safeJson } from '../util.js'

const uploadList = (raw) => {
  const parsed = safeJson(raw)
  return Array.isArray(parsed) ? parsed : []
}

const DAY_MS = 86400000

// Runs per UTC day, oldest first. Bucketed here rather than in SQL: integer
// division of a timestamp is spelled differently per engine, and a window of
// days holds at most a few thousand runs.
export async function backupCalendar(connectionId, days) {
  const rows = await db().backup_runs.findMany({
    where: { connection_id: connectionId, started_at: { gte: Date.now() - days * DAY_MS } },
    select: { started_at: true, status: true },
  })
  const byDay = new Map()
  for (const { started_at: startedAt, status } of rows) {
    const index = Math.floor(startedAt / DAY_MS)
    const counts = byDay.get(index) || { runs: 0, success: 0, failed: 0 }
    counts.runs += 1
    if (status === 'success') counts.success += 1
    if (status === 'failed') counts.failed += 1
    byDay.set(index, counts)
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, counts]) => ({ day: new Date(index * DAY_MS).toISOString().slice(0, 10), ...counts }))
}

export async function listBackupRuns(connectionId, { limit, offset, date }) {
  const where = { connection_id: connectionId }
  if (date) {
    const start = /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T00:00:00Z`) : NaN
    if (!Number.isFinite(start) || new Date(start).toISOString().slice(0, 10) !== date) {
      throw Object.assign(new Error('Invalid date'), { status: 400 })
    }
    where.started_at = { gte: start, lt: start + DAY_MS }
  }
  const [total, rows] = await Promise.all([
    db().backup_runs.count({ where }),
    db().backup_runs.findMany({
      where,
      select: { id: true, trigger_kind: true, status: true, error: true, started_at: true, finished_at: true, uploads: true },
      orderBy: { started_at: 'desc' },
      take: limit,
      skip: offset,
    }),
  ])
  return {
    total,
    runs: rows.map((row) => ({
      id: row.id,
      trigger: row.trigger_kind,
      status: row.status,
      error: row.error,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      uploads: uploadList(row.uploads),
    })),
  }
}

export async function findRunUpload(connectionId, runId, destinationId) {
  const run = await db().backup_runs.findFirst({ where: { id: runId, connection_id: connectionId } })
  if (!run) return { run: null, uploads: [], upload: null }
  const uploads = uploadList(run.uploads)
  return { run, uploads, upload: uploads.find((u) => u.destinationId === destinationId && u.ok && !u.deleted) || null }
}

export async function markRunUploadDeleted(run, uploads, destinationId) {
  const next = uploads.map((upload) => upload.destinationId === destinationId ? { ...upload, deleted: true } : upload)
  await db().backup_runs.updateMany({ where: { id: run.id }, data: { uploads: JSON.stringify(next) } })
}
