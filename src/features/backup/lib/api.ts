// Storage destinations (S3-compatible, workspace-scoped) + per-connection
// backup schedule/history. Mirrors the workflow client (features/workflow/lib/api.ts):
// reads degrade quietly via safeRequest, mutations throw via request.

import { request, safeRequest } from '@/shared/api/request'
import type { BackupCalendarDay, BackupRun, BackupSchedule, StorageDestination } from './types'

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

// ---- Backup schedule (per connection) ----

export async function getBackupSchedule(connectionId: string): Promise<BackupSchedule | null> {
  const res = await safeRequest<{ workflow: BackupSchedule | null }>(`/connections/${connectionId}/backup`, { workflow: null })
  return res.workflow
}

export async function createBackupSchedule(
  connectionId: string,
  payload: { frequency: 'hourly' | 'daily'; hourOfDay?: number; destinationIds: string[] }
): Promise<BackupSchedule> {
  return request(`/connections/${connectionId}/backup-workflow`, { method: 'POST', body: payload })
}

export async function listBackupRuns(connectionId: string, limit = 50): Promise<BackupRun[]> {
  return safeRequest(`/connections/${connectionId}/backup/runs?limit=${limit}`, [])
}

export async function getBackupCalendar(connectionId: string, days = 365): Promise<BackupCalendarDay[]> {
  const res = await safeRequest<{ days: BackupCalendarDay[] }>(`/connections/${connectionId}/backup/calendar?days=${days}`, { days: [] })
  return res.days
}

export async function restoreBackup(
  connectionId: string,
  payload: { runId: string; destinationId: string; confirmName: string }
): Promise<void> {
  await request(`/connections/${connectionId}/backup/restore`, { method: 'POST', body: payload })
}
