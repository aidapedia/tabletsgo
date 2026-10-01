/** Reads and updates recorded backup runs. Routes handle authorization and storage IO. */
import { meta } from '../meta.js'
import { safeJson } from '../util.js'

const uploadList = (raw) => {
  const parsed = safeJson(raw)
  return Array.isArray(parsed) ? parsed : []
}

export function backupCalendar(connectionId, days) {
  const from = Date.now() - days * 86400000
  return meta.prepare(
    `SELECT started_at / 86400000 AS day_index, COUNT(*) AS runs,
            SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
     FROM backup_runs WHERE connection_id = ? AND started_at >= ? GROUP BY day_index ORDER BY day_index`
  ).all(connectionId, from).map(({ day_index, ...counts }) => ({
    day: new Date(Number(day_index) * 86400000).toISOString().slice(0, 10),
    ...counts,
  }))
}

export function listBackupRuns(connectionId, { limit, offset, date }) {
  let where = 'connection_id = ?'
  const params = [connectionId]
  if (date) {
    const start = /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T00:00:00Z`) : NaN
    if (!Number.isFinite(start) || new Date(start).toISOString().slice(0, 10) !== date) {
      throw Object.assign(new Error('Invalid date'), { status: 400 })
    }
    where += ' AND started_at >= ? AND started_at < ?'
    params.push(start, start + 86400000)
  }
  const total = meta.prepare(`SELECT COUNT(*) AS c FROM backup_runs WHERE ${where}`).get(...params).c
  const rows = meta.prepare(
    `SELECT id, trigger_kind, status, error, started_at, finished_at, uploads
     FROM backup_runs WHERE ${where} ORDER BY started_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset)
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

export function findRunUpload(connectionId, runId, destinationId) {
  const run = meta.prepare('SELECT * FROM backup_runs WHERE id = ? AND connection_id = ?').get(runId, connectionId)
  if (!run) return { run: null, uploads: [], upload: null }
  const uploads = uploadList(run.uploads)
  return { run, uploads, upload: uploads.find((u) => u.destinationId === destinationId && u.ok && !u.deleted) || null }
}

export function markRunUploadDeleted(run, uploads, destinationId) {
  const next = uploads.map((upload) => upload.destinationId === destinationId ? { ...upload, deleted: true } : upload)
  meta.prepare('UPDATE backup_runs SET uploads = ? WHERE id = ?').run(JSON.stringify(next), run.id)
}
