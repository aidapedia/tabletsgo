/**
 * The backup schedule store — one row per connection in `backup_schedules`.
 *
 * Kept apart from the runner so the connection export/import bundle can read and
 * write a schedule without pulling in the whole backup pipeline.
 */

import { randomUUID } from 'crypto'
import { meta } from '../meta.js'
import { computeNextRun, safeJson } from '../util.js'
import { LOCAL_STORAGE_ID, getStorage } from '../storage.js'

export const getBackupScheduleRow = (connectionId) =>
  meta.prepare('SELECT * FROM backup_schedules WHERE connection_id = ?').get(connectionId)

export const rowToBackupSchedule = (row) =>
  row && {
    connectionId: row.connection_id,
    frequency: row.frequency,
    hourOfDay: row.hour_of_day ?? 0,
    destinationIds: safeJson(row.destination_ids) || [],
    retryLimit: row.retry_limit || 0,
    retryDelaySec: row.retry_delay_sec || 60,
    retentionDays: row.retention_days || 0,
    encrypt: !!row.encrypt,
    includeConfig: !!row.include_config,
    enabled: !!row.enabled,
  }

export const getBackupSchedule = (connectionId) => rowToBackupSchedule(getBackupScheduleRow(connectionId))

// Field clamps shared by create and update, so a hand-crafted body (or an
// imported document) can't widen the retry/retention bounds.
const clampRetryLimit = (v) => Math.max(0, Math.min(5, parseInt(v) || 0))
const clampRetryDelay = (v) => Math.max(1, parseInt(v) || 60)
const clampRetention = (v) => Math.max(0, parseInt(v) || 0)

// Validates the parts of a schedule body that depend on the connection: the
// frequency and the storage destinations it may write to. Returns an error
// message, or null when the body is acceptable.
export function validateScheduleBody(conn, destinationIds, frequency) {
  if (!['hourly', 'daily'].includes(frequency)) return 'Frequency must be hourly or daily'
  if (!Array.isArray(destinationIds)) return 'destinationIds must be an array'
  // An empty list is allowed: the backup falls back to the local server disk
  // (see the runner). The reserved 'local' id is always valid; every other id
  // must be a real S3 destination in this connection's workspace.
  for (const did of destinationIds) {
    if (did === LOCAL_STORAGE_ID) continue
    if (getStorage(did)?.workspaceId !== conn.workspaceId) return 'One or more storage destinations are invalid'
  }
  return null
}

// Create the connection's schedule. `paused` forces it inactive regardless of
// the body — an import must not start firing jobs at a database nobody has
// verified yet.
export function createSchedule(connectionId, body, { paused = false } = {}) {
  const now = Date.now()
  const frequency = body.frequency
  const hourOfDay = body.hourOfDay ?? 0
  const enabled = paused ? false : body.enabled !== false
  meta
    .prepare(
      `INSERT INTO backup_schedules
       (id, connection_id, frequency, hour_of_day, destination_ids, retry_limit, retry_delay_sec, retention_days, encrypt, include_config, enabled, next_run_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      connectionId,
      frequency,
      hourOfDay,
      JSON.stringify(body.destinationIds || []),
      clampRetryLimit(body.retryLimit),
      clampRetryDelay(body.retryDelaySec),
      clampRetention(body.retentionDays),
      body.encrypt ? 1 : 0,
      body.includeConfig ? 1 : 0,
      enabled ? 1 : 0,
      enabled ? computeNextRun(frequency, hourOfDay) : null,
      now,
      now
    )
  return getBackupSchedule(connectionId)
}

// Update any subset of the schedule's fields (also how Active/Paused toggles,
// via a lightweight `{ enabled }` body). `row` is the existing schedule row.
export function updateSchedule(row, body) {
  const frequency = body.frequency ?? row.frequency
  const hourOfDay = body.hourOfDay ?? row.hour_of_day ?? 0
  const destinationIds = body.destinationIds ?? safeJson(row.destination_ids) ?? []
  const retryLimit = body.retryLimit != null ? clampRetryLimit(body.retryLimit) : row.retry_limit
  const retryDelaySec = body.retryDelaySec != null ? clampRetryDelay(body.retryDelaySec) : row.retry_delay_sec
  const retentionDays = body.retentionDays != null ? clampRetention(body.retentionDays) : row.retention_days
  const encrypt = body.encrypt != null ? !!body.encrypt : !!row.encrypt
  const includeConfig = body.includeConfig != null ? !!body.includeConfig : !!row.include_config
  const enabled = body.enabled != null ? !!body.enabled : !!row.enabled

  meta
    .prepare(
      `UPDATE backup_schedules SET frequency = ?, hour_of_day = ?, destination_ids = ?, retry_limit = ?, retry_delay_sec = ?,
       retention_days = ?, encrypt = ?, include_config = ?, enabled = ?, next_run_at = ?, updated_at = ? WHERE id = ?`
    )
    .run(
      frequency,
      hourOfDay,
      JSON.stringify(destinationIds),
      retryLimit,
      retryDelaySec,
      retentionDays,
      encrypt ? 1 : 0,
      includeConfig ? 1 : 0,
      enabled ? 1 : 0,
      enabled ? computeNextRun(frequency, hourOfDay) : null,
      Date.now(),
      row.id
    )
  return getBackupSchedule(row.connection_id)
}
