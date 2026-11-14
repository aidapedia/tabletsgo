// Public API for the workspaces (org/tenant) feature — the multi-tenant layer
// above connections. Not to be confused with the DB console `features/workspace`.
export { WorkspaceProvider, useWorkspaces } from './stores/WorkspaceContext'
export { default as WorkspaceSwitcher } from './components/WorkspaceSwitcher'
export { default as RequireWorkspace } from './components/RequireWorkspace'
export { default as MembersPanel } from './components/MembersPanel'
export { default as WorkspaceGeneral } from './components/WorkspaceGeneral'
export { default as WorkspaceConfig } from './components/WorkspaceConfig'
export { default as NotificationSettings } from './components/NotificationSettings'
export type {
  Workspace,
  WorkspaceRole,
  Permission,
  Member,
  InstanceSmtp,
  NotificationSettings as NotificationSettingsType,
} from './api'
export { can } from './api'
export { listWorkspaces, getWorkspace, updateWorkspace, deleteWorkspace } from './api'
export { listMembers } from './api'
