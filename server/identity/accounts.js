/**
 * What a confirmed Google or GitHub profile means for an account here. The
 * decisions, in order, live in `signIn`.
 */

import { db, transaction } from '../meta.js'
import { isModuleEnabled } from '../module-registry.js'
import { activateUser, createUser, hasPassword } from '../users.js'
import { IdentityError, deleteIdentity, findIdentity, linkIdentity, listIdentities, touchIdentity } from './identities.js'

const NOT_LINKED = () => new IdentityError("That account isn't linked to an account here.", 'not_linked', 403)

const linkAndActivate = (userId, kind, profile) =>
  transaction(async () => {
    await linkIdentity(userId, kind, profile)
    await activateUser(userId, { name: profile.name })
  })

/**
 * Resolve a sign-in to a user id, or throw an IdentityError.
 *
 *   1. Already linked: that account. Nothing else about the profile matters.
 *   2. Otherwise the email is all there is to go on, and only an address the
 *      provider verified counts.
 *   3. It matches an account: link it and sign in. Someone with a pending invite
 *      has just proved the mailbox the invite went to, so this accepts it too.
 *      An instance admin is the exception and must link from Settings: nothing
 *      ever confirmed the address typed into the first-run wizard, and that
 *      mistake shouldn't be able to hand out the instance.
 *   4. No account: create one if the instance takes registrations.
 */
export async function signIn(kind, profile) {
  const linked = await findIdentity(kind, profile.subject)
  if (linked) {
    await touchIdentity(linked.id)
    return linked.user_id
  }

  if (!profile.email || !profile.emailVerified) {
    throw new IdentityError('That account has no verified email address.', 'email_unverified', 403)
  }

  const user = await db().users.findUnique({ where: { username: profile.email }, select: { id: true, role: true } })
  if (user) {
    if (user.role === 'admin') throw NOT_LINKED()
    await linkAndActivate(user.id, kind, profile)
    return user.id
  }

  if (!isModuleEnabled('registration')) throw NOT_LINKED()
  return transaction(async () => {
    const { user: created } = await createUser({ email: profile.email, name: profile.name })
    await linkAndActivate(created.id, kind, profile)
    return created.id
  })
}

/** Accept an invite by signing in. Holding the link is the proof, so any account of theirs will do. */
export async function acceptInvite(token, kind, profile) {
  const row = await db().users.findFirst({ where: { invite_token: token }, select: { id: true, token_expires: true } })
  if (!row || (row.token_expires && row.token_expires < Date.now())) {
    throw new IdentityError('This invite is invalid or has expired.', 'invite_invalid', 404)
  }
  await linkAndActivate(row.id, kind, profile)
  return row.id
}

/** Unlink one of the caller's accounts, refusing to remove their last way in. */
export async function unlink(userId, identityId) {
  const mine = await listIdentities(userId)
  if (!mine.some((i) => i.id === identityId)) throw new IdentityError('Linked account not found.', 'failed', 404)
  if (mine.length === 1 && !(await hasPassword(userId))) {
    throw new IdentityError('This is your only way to sign in. Set a password first with "Forgot password" on the sign-in page.')
  }
  await deleteIdentity(userId, identityId)
}
