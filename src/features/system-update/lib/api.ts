// Client for the in-app update flow. Reads degrade quietly via safeRequest;
// mutations throw via request (callers try/catch + toast).

import { request, safeRequest, getToken } from '@/shared/api/request'
import { API_URL } from '@/shared/config'
import type { AppIdentity, ApplyResult, BackupResult, PreflightCheck, UpdateInfo } from './types'

export async function getVersion(): Promise<AppIdentity> {
  return safeRequest<AppIdentity>('/system/version', { version: '0.0.0', sha: 'dev' })
}

export async function checkForUpdate(refresh = false): Promise<UpdateInfo | null> {
  return safeRequest<UpdateInfo | null>(`/system/update/check${refresh ? '?refresh=1' : ''}`, null)
}

export async function runBackup(): Promise<BackupResult> {
  return request<BackupResult>('/system/backup', { method: 'POST' })
}

// Direct link (auth is a Bearer header, so a plain <a> can't carry it — callers
// fetch the blob). Kept here so the path lives in one place.
export function backupDownloadPath(file: string): string {
  return `${API_URL}/system/backup/${encodeURIComponent(file)}/download`
}

export async function downloadBackup(file: string): Promise<void> {
  const res = await fetch(backupDownloadPath(file), {
    headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {},
  })
  if (!res.ok) throw new Error(`Download failed (${res.status})`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = file
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export async function runPreflight(): Promise<PreflightCheck[]> {
  const res = await safeRequest<{ checks: PreflightCheck[] }>('/system/preflight', { checks: [] })
  return res.checks
}

export async function applyUpdate(tag?: string): Promise<ApplyResult> {
  return request<ApplyResult>('/system/update/apply', { method: 'POST', body: tag ? { tag } : {} })
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Poll /system/version until it reports `targetVersion` (the new container came
// up) or the timeout elapses. Tolerates the backend blinking out mid-restart.
export async function pollUntilVersion(
  targetVersion: string,
  { timeoutMs = 180_000, intervalMs = 4000 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const v = await request<AppIdentity>('/system/version')
      if (v.version === targetVersion) return true
    } catch {
      // Backend unreachable during recreate — keep waiting.
    }
    await delay(intervalMs)
  }
  return false
}
