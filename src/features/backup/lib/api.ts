// Storage destinations (S3-compatible, workspace-scoped) + per-connection
// backup schedule/history. Mirrors the workflow client (features/workflow/lib/api.ts):
// reads degrade quietly via safeRequest, mutations throw via request.

import { request, safeRequest, getToken } from '@/shared/api/request'
import { API_URL } from '@/shared/config'
import type { BackupCalendarDay, BackupRun, BackupRunsPage, BackupSchedule, StorageDestination, StorageObject } from './types'

export async function listStorages(workspaceId: string): Promise<StorageDestination[]> {
  if (!workspaceId) return []
  return safeRequest(`/storages?workspace=${workspaceId}`, [])
}

export async function createStorage(payload: {
  workspaceId: string
  name: string
  endpoint?: string
  region?: string
  bucket: string
  pathPrefix?: string
  forcePathStyle?: boolean
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
}): Promise<StorageDestination> {
  return request('/storages', { method: 'POST', body: payload })
}

export async function updateStorage(id: string, fields: Partial<StorageDestination>): Promise<StorageDestination> {
  return request(`/storages/${id}`, { method: 'PUT', body: fields })
}

export async function deleteStorage(id: string): Promise<void> {
  await request(`/storages/${id}`, { method: 'DELETE' })
}

export async function testStorage(id: string): Promise<{ ok: boolean; message: string }> {
  return request(`/storages/${id}/test`, { method: 'POST' })
}

// ---- Backup schedule (per connection) — a standalone system, not a workflow ----

export type BackupSchedulePayload = {
  frequency: 'hourly' | 'daily'
  hourOfDay?: number
  destinationIds: string[]
  retryLimit?: number
  retryDelaySec?: number
  retentionDays?: number
  encrypt?: boolean
  enabled?: boolean
}

export async function getBackupSchedule(connectionId: string): Promise<BackupSchedule | null> {
  const res = await safeRequest<{ schedule: BackupSchedule | null }>(`/connections/${connectionId}/backup/schedule`, { schedule: null })
  return res.schedule
}

export async function createBackupSchedule(connectionId: string, payload: BackupSchedulePayload): Promise<BackupSchedule> {
  const res = await request<{ schedule: BackupSchedule }>(`/connections/${connectionId}/backup/schedule`, { method: 'POST', body: payload })
  return res.schedule
}

export async function updateBackupSchedule(connectionId: string, payload: Partial<BackupSchedulePayload>): Promise<BackupSchedule> {
  const res = await request<{ schedule: BackupSchedule }>(`/connections/${connectionId}/backup/schedule`, { method: 'PUT', body: payload })
  return res.schedule
}

export async function runBackupNow(connectionId: string): Promise<{ ok: boolean; error?: string }> {
  return request(`/connections/${connectionId}/backup/run`, { method: 'POST' })
}

export async function listBackupRuns(connectionId: string, opts: { limit?: number; offset?: number; date?: string } = {}): Promise<BackupRunsPage> {
  const params = new URLSearchParams()
  params.set('limit', String(opts.limit ?? 20))
  params.set('offset', String(opts.offset ?? 0))
  if (opts.date) params.set('date', opts.date)
  return safeRequest(`/connections/${connectionId}/backup/runs?${params}`, { runs: [], total: 0 })
}

export async function getBackupCalendar(connectionId: string, days = 365): Promise<BackupCalendarDay[]> {
  const res = await safeRequest<{ days: BackupCalendarDay[] }>(`/connections/${connectionId}/backup/calendar?days=${days}`, { days: [] })
  return res.days
}

export async function deleteBackupUpload(connectionId: string, runId: string, destinationId: string): Promise<void> {
  await request(`/connections/${connectionId}/backup/runs/${runId}/uploads/${destinationId}`, { method: 'DELETE' })
}

// Downloads a backup artifact through the authenticated API and saves it via
// the browser — a plain <a href> can't carry the Authorization header, so
// this fetches the blob directly and triggers the save itself.
export async function downloadBackupUpload(connectionId: string, runId: string, destinationId: string): Promise<void> {
  const token = getToken()
  const res = await fetch(`${API_URL}/connections/${connectionId}/backup/runs/${runId}/uploads/${destinationId}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data?.error || `Download failed (${res.status})`)
  }
  const disposition = res.headers.get('Content-Disposition') || ''
  const filename = /filename="?([^";]+)"?/.exec(disposition)?.[1] || 'backup'
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export async function restoreBackup(
  connectionId: string,
  payload: { runId: string; destinationId: string; confirmName: string; targetConnectionId?: string }
): Promise<void> {
  await request(`/connections/${connectionId}/backup/restore`, { method: 'POST', body: payload })
}

// ---- Restore from arbitrary sources (storage browse / file upload) ----

// Uses request (not safeRequest): a listing failure (bad credentials,
// unreachable endpoint) must surface in the picker, not look like an empty bucket.
export async function listStorageObjects(connectionId: string, destinationId: string): Promise<StorageObject[]> {
  const res = await request<{ objects: StorageObject[] }>(
    `/connections/${connectionId}/restore/storage-objects?destinationId=${encodeURIComponent(destinationId)}`
  )
  return res.objects
}

export async function restoreFromStorageObject(
  connectionId: string,
  payload: { destinationId: string; key: string; confirmName: string }
): Promise<void> {
  await request(`/connections/${connectionId}/restore/from-storage`, { method: 'POST', body: payload })
}

// Streams a local backup file to the server as the raw request body —
// request() JSON-encodes bodies, so this uses fetch directly (like download).
export async function restoreFromUpload(connectionId: string, file: File, confirmName: string): Promise<void> {
  const token = getToken()
  const params = new URLSearchParams({ filename: file.name, confirmName })
  const res = await fetch(`${API_URL}/connections/${connectionId}/restore/upload?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: file,
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data?.error || `Restore failed (${res.status})`)
  }
}
