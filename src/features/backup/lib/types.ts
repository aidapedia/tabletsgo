export type StorageDestination = {
  id: string
  workspaceId: string
  name: string
  endpoint: string
  region: string
  bucket: string
  pathPrefix: string
  forcePathStyle: boolean
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
}

export type BackupSchedule = {
  connectionId: string
  enabled: boolean
  frequency: 'hourly' | 'daily'
  hourOfDay: number
  destinationIds: string[]
  retryLimit: number
  retryDelaySec: number
  retentionDays: number
  encrypt: boolean
  /** Also upload the connection's export JSON (settings + folders + saved queries
   *  + workflows + dashboards) beside each dump. Never carries the password. */
  includeConfig: boolean
}

export type BackupUpload = {
  destinationId: string
  ok: boolean
  key?: string
  sizeBytes?: number
  error?: string
  encrypted?: boolean
  prunedCount?: number
  deleted?: boolean
  /** Key of the connection-config JSON shipped with this dump (schedules with
   *  `includeConfig`). Absent when the schedule doesn't ship one. */
  configKey?: string
  configSizeBytes?: number
  configEncrypted?: boolean
  /** Why the config upload failed. The run itself still counts as a success —
   *  the dump, which is what a restore needs, made it. */
  configError?: string
}

export type BackupRun = {
  id: string
  trigger: 'manual' | 'schedule' | 'retry'
  status: 'success' | 'failed'
  error?: string
  startedAt: number
  finishedAt?: number
  uploads: BackupUpload[]
}

export type BackupRunsPage = { runs: BackupRun[]; total: number }

// A file sitting in a storage destination, as listed by the restore browser.
export type StorageObject = { key: string; sizeBytes: number; lastModified: number | null }

export type BackupCalendarDay = { day: string; runs: number; success: number; failed: number }
