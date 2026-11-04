// Public API for the auth feature.
export { AuthProvider, useAuth } from './stores/AuthContext'
export {
  getSetupStatus,
  submitSetup,
  getInvite,
  acceptInvite,
  forgotPassword,
  getReset,
  resetPassword,
  getMe,
  updateProfile,
  changePassword,
  getSignInOptions,
  register,
  exchangeSignIn,
} from './api'
export type { SignInOptions } from './api'
export { signInErrorMessage } from './lib/signInErrors'
export { default as ProfileSetting } from './components/ProfileSetting'
export { default as TimeZoneSetting } from './components/TimeZoneSetting'
export { default as PasswordSetting } from './components/PasswordSetting'
export { default as SignInMethods } from './components/SignInMethods'
export { default as ProviderButtons, OrDivider, PROVIDER_ICONS } from './components/ProviderButtons'
