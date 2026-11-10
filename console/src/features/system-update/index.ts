// Public API for the system-update feature: in-app update checking + guided
// update wizard (backup → pre-flight → apply → verify).
export { UpdateProvider, useUpdate } from './stores/UpdateContext'
export { default as UpdateBanner } from './components/UpdateBanner'
export { default as UpdatePanel } from './components/UpdatePanel'
export { default as UpdateWizard } from './components/UpdateWizard'
export type { UpdateInfo, ReleaseNote, PreflightCheck, BackupResult } from './lib/types'
