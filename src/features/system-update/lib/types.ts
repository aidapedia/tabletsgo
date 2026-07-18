// Shapes returned by the /api/system/* endpoints (see BACKEND_DOCUMENTATION.MD).

export type AppIdentity = { name?: string; version: string; sha: string }

export type ReleaseNote = {
  version: string
  name: string
  notes: string // markdown
  url: string
  publishedAt: string
}

export type UpdateInfo = {
  current: { version: string; sha: string }
  latest: { version: string; sha: string | null } | null
  updateAvailable: boolean
  rebuild?: boolean // same version tag, newer commit (moving-tag rebuild)
  breaking?: boolean
  migrations?: boolean
  minUpgradeFrom?: string | null
  upgradeBlocked?: boolean
  image: string
  applyMethod: 'docker' | 'manual'
  checkedAt: number
  releases: ReleaseNote[]
  unreachable?: boolean
  error?: string
}

export type PreflightStatus = 'pass' | 'warn' | 'fail'
export type PreflightCheck = { id: string; label: string; status: PreflightStatus; detail: string }

export type BackupResult = { ok: boolean; file: string; sizeBytes: number; createdAt: number }

export type ApplyResult = {
  ok: boolean
  method: 'docker' | 'manual'
  message?: string
  command?: string
  image?: string
}
