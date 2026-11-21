// Public API for the instance-administration feature — the `/admin/*` area,
// reachable by whoever holds tabletsgo's admin role at Hayat's root. Accounts,
// workspaces, roles and sign-in methods are administered in Hayat; what is left
// here is tabletsgo's own: how it is enrolled with Hayat and the mail server
// (modules and updates live in their own features).
export { default as AdminSmtpPanel } from './components/AdminSmtpPanel'
export type { GlobalSmtp, GlobalSmtpInfo, HayatStatus } from './api'
export { getGlobalSmtp, updateGlobalSmtp, clearGlobalSmtp, testGlobalSmtp, getHayatStatus } from './api'
