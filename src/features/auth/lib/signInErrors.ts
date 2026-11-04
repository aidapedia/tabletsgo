// The callback can only hand a page a code in the URL; this turns it into the
// sentence the person reads.
const MESSAGES: Record<string, string> = {
  not_linked: "That account isn't linked to an account here. Sign in with your email and password, then link it in Settings → Account.",
  email_unverified: "That account has no verified email address. Verify it with the provider, or sign in with your email and password.",
  already_linked: 'That account is already linked to someone else here.',
  provider_taken: 'You already have an account linked for that provider. Unlink it first.',
  provider_off: 'That sign-in option is turned off on this instance.',
  invite_invalid: 'This invite is invalid or has expired.',
  expired: 'That sign-in took too long. Please try again.',
  cancelled: 'Sign-in was cancelled.',
  failed: "We couldn't reach the provider. Please try again.",
}

export const signInErrorMessage = (code: string | null) => (code ? MESSAGES[code] || MESSAGES.failed : '')
