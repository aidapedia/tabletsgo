/**
 * The backup runner — export → store, recorded in `backup_runs`.
 *
 * Standalone from the generic workflow engine (it has its own schedule and run
 * history) but built from the same two steps, so a backup is exactly what the
 * "Export SQL → Store to Storage" node pair does, plus retries and failure
 * notification.
 */

import fs from 'fs'
import { randomUUID } from 'crypto'
import { db } from '../meta.js'
import { getConnection } from '../connections.js'
import { computeNextRun, describeError, safeJson, sleep } from '../util.js'
import { exportDatabaseToFile } from '../db/index.js'
import { LOCAL_STORAGE_ID, storeFile } from '../storage.js'
import { exportConnectionConfigToFile } from '../connection-transfer.js'
import { smtpConfig, sendMail } from '../mail.js'

// Runs export → store once, recording the outcome in backup_runs. Shared by
// manual "Run now" and the scheduler (see runBackupWithRetries below).
export async function runBackupOnce(scheduleRow, conn, triggerKind) {
  const startedAt = Date.now()
  let status = 'success'
  let error = null
  let uploads = []
  let exportOutput = null
  let configOutput = null
  try {
    exportOutput = await exportDatabaseToFile(conn)
    // No S3 destination configured ⇒ default to the local server disk.
    const configured = safeJson(scheduleRow.destination_ids) || []
    const destinationIds = configured.length ? configured : [LOCAL_STORAGE_ID]
    const storeOutput = await storeFile(conn, exportOutput, destinationIds, {
      encrypt: !!scheduleRow.encrypt,
      retentionDays: scheduleRow.retention_days || 0,
    })
    uploads = storeOutput.uploaded
    const failed = uploads.filter((u) => !u.ok)
    if (failed.length) {
      status = 'failed'
      error = `Upload failed for ${failed.length} of ${uploads.length} destination(s): ${failed[0].error}`
    }

    // Second artifact: the connection's own configuration, uploaded beside the
    // dump under the same date folder. It's recorded *on* each destination's
    // upload entry (`configKey`) rather than as its own entry, so every lookup
    // that finds an upload by destinationId (download/delete/restore) keeps
    // resolving the dump — the thing you restore from. Retention is left to the
    // dump's prune pass above: it already sweeps the whole folder by date.
    if (scheduleRow.include_config) {
      configOutput = await exportConnectionConfigToFile(conn)
      const configStore = await storeFile(conn, configOutput, destinationIds, { encrypt: !!scheduleRow.encrypt })
      const byDest = new Map(configStore.uploaded.map((u) => [u.destinationId, u]))
      uploads = uploads.map((u) => {
        const c = byDest.get(u.destinationId)
        if (!c) return u
        return c.ok
          ? { ...u, configKey: c.key, configSizeBytes: c.sizeBytes, ...(c.encrypted ? { configEncrypted: true } : null) }
          : { ...u, configError: c.error }
      })
      // A failed config upload doesn't fail the run: the database dump — what a
      // restore actually needs — already succeeded, and failing here would
      // re-dump the whole database on every retry. The error rides along on the
      // destination's row instead.
    }
  } catch (err) {
    status = 'failed'
    error = describeError(err)
  } finally {
    if (exportOutput?.filePath) fs.rm(exportOutput.filePath, { force: true }, () => {})
    if (configOutput?.filePath) fs.rm(configOutput.filePath, { force: true }, () => {})
  }
  await db().backup_runs.create({
    data: {
      id: randomUUID(),
      connection_id: conn.id,
      schedule_id: scheduleRow.id,
      trigger_kind: triggerKind,
      status,
      error,
      uploads: JSON.stringify(uploads),
      started_at: startedAt,
      finished_at: Date.now(),
      ts: startedAt,
    },
  })
  return { ok: status === 'success', error, uploads }
}

// Scheduled run, retrying up to scheduleRow.retry_limit times (with
// retry_delay_sec between attempts) if it fails. Notifies the workspace on a
// final failure (see notifyBackupFailure).
export async function runBackupWithRetries(scheduleRow, conn) {
  let result = await runBackupOnce(scheduleRow, conn, 'schedule')
  let attempt = 0
  while (!result.ok && attempt < (scheduleRow.retry_limit || 0)) {
    await sleep((scheduleRow.retry_delay_sec || 60) * 1000)
    attempt++
    result = await runBackupOnce(scheduleRow, conn, 'retry')
  }
  if (!result.ok) await notifyBackupFailure(conn, result)
}

// Fire every schedule whose next_run_at has been reached, claiming the next slot
// before the run starts so a slow run can't be double-fired by the next tick.
export async function runDueBackups() {
  const due = await db().backup_schedules.findMany({ where: { enabled: 1, next_run_at: { lte: Date.now() } } })
  for (const schedule of due) {
    await db().backup_schedules.updateMany({
      where: { id: schedule.id },
      data: { next_run_at: computeNextRun(schedule.frequency, schedule.hour_of_day) },
    })
    const conn = await getConnection(schedule.connection_id)
    if (!conn) continue
    runBackupWithRetries(schedule, conn).catch((e) => console.error(`Scheduled backup failed for connection ${schedule.connection_id}:`, e.message))
  }
}

// Email the workspace's chosen members when a scheduled backup ends up failed
// (after retries, if any). Best-effort — never throws.
async function notifyBackupFailure(conn, result) {
  try {
    const wsRow = conn.workspaceId ? await db().workspaces.findUnique({ where: { id: conn.workspaceId } }) : null
    if (!wsRow) return
    const cfg = safeJson(wsRow.settings).notifications?.backupFailure
    if (!cfg?.enabled || !cfg.memberIds?.length) return
    const smtp = await smtpConfig()
    if (!smtp) return
    const recipients = await db().users.findMany({ where: { id: { in: cfg.memberIds } }, select: { username: true } })
    const when = new Date().toISOString()
    for (const r of recipients) {
      try {
        await sendMail(smtp, {
          to: r.username,
          subject: `Backup failed for ${conn.name}`,
          text: `The scheduled backup for "${conn.name}" failed at ${when}.\n\nError: ${result.error || 'Unknown error'}`,
          html: `<p>The scheduled backup for <b>${conn.name}</b> failed at ${when}.</p><p style="color:#c00">${result.error || 'Unknown error'}</p>`,
        })
      } catch (e) {
        console.error('Backup failure notification email failed:', e.message)
      }
    }
  } catch (e) {
    console.error('notifyBackupFailure error:', e.message)
  }
}
