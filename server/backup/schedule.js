/**
 * The backup schedule store — one row per connection in `backup_schedules`.
 *
 * Kept apart from the runner so the connection export/import bundle can read and
 * write a schedule without pulling in the whole backup pipeline.
 */

import { randomUUID } from 'crypto'
import { db } from '../meta.js'
import { computeNextRun, safeJson } from '../util.js'
import { LOCAL_STORAGE_ID, getStorage } from '../storage.js'

export const getBackupScheduleRow = async (connectionId) =>
  connectionId ? db().backup_schedules.findUnique({ where: { connection_id: connectionId } }) : null

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

export const getBackupSchedule = async (connectionId) => rowToBackupSchedule(await getBackupScheduleRow(connectionId))

// Field clamps shared by create and update, so a hand-crafted body (or an
// imported document) can't widen the retry/retention bounds.
const clampRetryLimit = (v) => Math.max(0, Math.min(5, parseInt(v) || 0))
const clampRetryDelay = (v) => Math.max(1, parseInt(v) || 60)
const clampRetention = (v) => Math.max(0, parseInt(v) || 0)

// Validates the parts of a schedule body that depend on the connection: the
// frequency and the storage destinations it may write to. Returns an error
// message, or null when the body is acceptable.
export async function validateScheduleBody(conn, destinationIds, frequency) {
  if (!['hourly', 'daily'].includes(frequency)) return 'Frequency must be hourly or daily'
  if (!Array.isArray(destinationIds)) return 'destinationIds must be an array'
  // An empty list is allowed: the backup falls back to the local server disk
  // (see the runner). The reserved 'local' id is always valid; every other id
  // must be a real S3 destination in this connection's workspace.
  for (const did of destinationIds) {
    if (did === LOCAL_STORAGE_ID) continue
    if ((await getStorage(did))?.workspaceId !== conn.workspaceId) return 'One or more storage destinations are invalid'
  }
  return null
}

// Create the connection's schedule. `paused` forces it inactive regardless of
// the body — an import must not start firing jobs at a database nobody has
// verified yet.
export async function createSchedule(connectionId, body, { paused = false } = {}) {
  const now = Date.now()
  const frequency = body.frequency
  const hourOfDay = body.hourOfDay ?? 0
  const enabled = paused ? false : body.enabled !== false
  await db().backup_schedules.create({
    data: {
      id: randomUUID(),
      connection_id: connectionId,
      frequency,
      hour_of_day: hourOfDay,
      destination_ids: JSON.stringify(body.destinationIds || []),
      retry_limit: clampRetryLimit(body.retryLimit),
      retry_delay_sec: clampRetryDelay(body.retryDelaySec),
      retention_days: clampRetention(body.retentionDays),
      encrypt: body.encrypt ? 1 : 0,
      include_config: body.includeConfig ? 1 : 0,
      enabled: enabled ? 1 : 0,
      next_run_at: enabled ? computeNextRun(frequency, hourOfDay) : null,
      created_at: now,
      updated_at: now,
    },
  })
  return getBackupSchedule(connectionId)
}

// Update any subset of the schedule's fields (also how Active/Paused toggles,
// via a lightweight `{ enabled }` body). `row` is the existing schedule row.
export async function updateSchedule(row, body) {
  const frequency = body.frequency ?? row.frequency
  const hourOfDay = body.hourOfDay ?? row.hour_of_day ?? 0
  const destinationIds = body.destinationIds ?? safeJson(row.destination_ids) ?? []
  const retryLimit = body.retryLimit != null ? clampRetryLimit(body.retryLimit) : row.retry_limit
  const retryDelaySec = body.retryDelaySec != null ? clampRetryDelay(body.retryDelaySec) : row.retry_delay_sec
  const retentionDays = body.retentionDays != null ? clampRetention(body.retentionDays) : row.retention_days
  const encrypt = body.encrypt != null ? !!body.encrypt : !!row.encrypt
  const includeConfig = body.includeConfig != null ? !!body.includeConfig : !!row.include_config
  const enabled = body.enabled != null ? !!body.enabled : !!row.enabled

  await db().backup_schedules.updateMany({
    where: { id: row.id },
    data: {
      frequency,
      hour_of_day: hourOfDay,
      destination_ids: JSON.stringify(destinationIds),
      retry_limit: retryLimit,
      retry_delay_sec: retryDelaySec,
      retention_days: retentionDays,
      encrypt: encrypt ? 1 : 0,
      include_config: includeConfig ? 1 : 0,
      enabled: enabled ? 1 : 0,
      next_run_at: enabled ? computeNextRun(frequency, hourOfDay) : null,
      updated_at: Date.now(),
    },
  })
  return getBackupSchedule(row.connection_id)
}
