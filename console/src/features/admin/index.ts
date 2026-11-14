// Public API for the instance-administration feature — the `/admin/*` area,
// reachable by whoever holds tabletsgo's admin role at Hayat's root. Accounts,
// workspaces, roles and sign-in methods are administered in Hayat; what is left
// here is tabletsgo's own: the mail server (modules and updates live in their
// own features).
export { default as AdminSmtpPanel } from './components/AdminSmtpPanel'
export type { GlobalSmtp, GlobalSmtpInfo } from './api'
export { getGlobalSmtp, updateGlobalSmtp, clearGlobalSmtp, testGlobalSmtp } from './api'
