// Public API for the workspaces (org/tenant) feature — the multi-tenant layer
// above connections. Not to be confused with the DB console `features/workspace`.
export { WorkspaceProvider, useWorkspaces } from './stores/WorkspaceContext'
export { default as WorkspaceSwitcher } from './components/WorkspaceSwitcher'
export { default as MembersPanel } from './components/MembersPanel'
export { default as WorkspaceGeneral } from './components/WorkspaceGeneral'
export { default as NotificationSettings } from './components/NotificationSettings'
export { default as TeamsPanel } from './components/TeamsPanel'
export type { Workspace, WorkspaceRole, Member, Team, TeamMember, InstanceSmtp, NotificationSettings as NotificationSettingsType } from './api'
export { listWorkspaces, getWorkspace, createWorkspace, updateWorkspace, deleteWorkspace } from './api'
export { listMembers, inviteMember, removeMember, setMemberRole } from './api'
export { listTeams, createTeam, renameTeam, deleteTeam, listTeamMembers, addTeamMember, removeTeamMember } from './api'
