// Public API for the auth feature: signing in — at Hayat (enterprise) or as the
// instance's one owner (solo).
export { AuthProvider, useAuth, useIdentity } from './stores/AuthContext'
export { getMe, getAuthConfig } from './api'
export type { AuthUser, AuthConfig } from './api'
export { default as AccountSetting } from './components/AccountSetting'
export { default as AuthCard } from './components/AuthCard'
export { default as SoloSignIn } from './components/SoloSignIn'
export { default as SoloSetup } from './components/SoloSetup'
export { default as EnterpriseOnly } from './components/EnterpriseOnly'
