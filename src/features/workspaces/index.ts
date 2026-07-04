// Public API for the workspaces (org/tenant) feature — the multi-tenant layer
// above connections. Not to be confused with the DB console `features/workspace`.
export { WorkspaceProvider, useWorkspaces } from './stores/WorkspaceContext'
export { default as WorkspaceSwitcher } from './components/WorkspaceSwitcher'
export { default as MembersPanel } from './components/MembersPanel'
export { default as SmtpSettings } from './components/SmtpSettings'
export { default as WorkspaceGeneral } from './components/WorkspaceGeneral'
export type { Workspace, Member } from './api'
export { listWorkspaces, getWorkspace, createWorkspace, updateWorkspace, deleteWorkspace } from './api'
export { listMembers, inviteMember, removeMember } from './api'
