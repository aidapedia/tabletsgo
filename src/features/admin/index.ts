// Public API for the instance-administration feature — the `/admin/*` area,
// reachable only by accounts whose system role is 'admin'. It manages
// workspaces and accounts and deliberately reaches nothing inside a workspace;
// see CLAUDE.md "AUTH MODEL".
export { default as AdminWorkspacesPanel } from './components/AdminWorkspacesPanel'
export { default as AdminUsersPanel } from './components/AdminUsersPanel'
export { default as AdminSmtpPanel } from './components/AdminSmtpPanel'
export type { AdminUser, AdminWorkspace, AdminWorkspaceMember, GlobalSmtp, GlobalSmtpInfo, SystemRole } from './api'
export {
  listAllWorkspaces,
  createWorkspaceAs,
  renameWorkspaceAs,
  deleteWorkspaceAs,
  listWorkspaceMembersAs,
  setWorkspaceRoleAs,
  removeWorkspaceMemberAs,
} from './api'
export { listUsers, createUser, updateUser, deleteUser } from './api'
export { getGlobalSmtp, updateGlobalSmtp, clearGlobalSmtp, testGlobalSmtp } from './api'
