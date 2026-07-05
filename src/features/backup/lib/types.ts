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
  id: string
  name: string
  scheduleEnabled: boolean
  frequency: 'manual' | 'hourly' | 'daily'
  hourOfDay: number
  destinationIds: string[]
}

export type BackupUpload = { destinationId: string; ok: boolean; key?: string; sizeBytes?: number; error?: string }

export type BackupRun = {
  id: string
  trigger: 'manual' | 'schedule'
  status: 'success' | 'failed'
  error?: string
  startedAt: number
  finishedAt?: number
  uploads: BackupUpload[]
}

export type BackupCalendarDay = { day: string; runs: number; success: number; failed: number }
