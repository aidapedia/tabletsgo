// Public API for the instance-administration feature — the `/admin/*` area,
// reachable only by accounts whose system role is 'admin'. It manages
// workspaces and accounts and deliberately reaches nothing inside a workspace;
// see CLAUDE.md "AUTH MODEL".
export { default as AdminWorkspacesPanel } from './components/AdminWorkspacesPanel'
export { default as AdminUsersPanel } from './components/AdminUsersPanel'
// The resource tree offers this on the application root — the one node a
// workspace can be filed under — so the dialog lives on its own rather than
// inside the admin panel that also uses it.
export { default as CreateWorkspaceDialog } from './components/CreateWorkspaceDialog'
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
export { listUsers, createUser, updateUser, deleteUser, unblockUser } from './api'
export { getGlobalSmtp, updateGlobalSmtp, clearGlobalSmtp, testGlobalSmtp } from './api'
