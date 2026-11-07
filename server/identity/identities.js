/**
 * Who a Google or GitHub account belongs to — owns `user_identities`.
 *
 * A link is keyed on the provider's own user id (`subject`), never the email:
 * the email can change at the provider, and on the account it is only shown so
 * a person can tell which of their accounts is linked.
 */

import { randomUUID } from 'crypto'
import { db } from '../meta.js'

// A refused sign-in or link. `code` is what the callback hands the login page,
// which turns it into a sentence; the message is for routes answering in JSON.
export class IdentityError extends Error {
  constructor(message, code = 'failed', status = 400) {
    super(message)
    this.name = 'IdentityError'
    this.code = code
    this.status = status
  }
}

const toPublic = (r) => ({ id: r.id, provider: r.provider, email: r.email, createdAt: r.created_at, lastUsedAt: r.last_used_at })

export const listIdentities = async (userId) =>
  (await db().user_identities.findMany({ where: { user_id: userId }, orderBy: { created_at: 'asc' } })).map(toPublic)

export const findIdentity = (provider, subject) =>
  db().user_identities.findUnique({ where: { provider_subject: { provider, subject } } })

export const touchIdentity = (id) => db().user_identities.update({ where: { id }, data: { last_used_at: Date.now() } })

export async function linkIdentity(userId, provider, { subject, email }) {
  const taken = await findIdentity(provider, subject)
  if (taken) {
    if (taken.user_id === userId) return taken
    throw new IdentityError('That account is already linked to someone else here.', 'already_linked', 409)
  }
  const mine = await db().user_identities.findUnique({ where: { user_id_provider: { user_id: userId, provider } } })
  if (mine) throw new IdentityError('Unlink your current account first.', 'provider_taken', 409)
  const now = Date.now()
  try {
    return await db().user_identities.create({
      data: { id: randomUUID(), user_id: userId, provider, subject, email: email || null, created_at: now, last_used_at: now },
    })
  } catch (error) {
    // Lost a race on one of the two unique indexes.
    if (error.code === 'P2002') throw new IdentityError('That account is already linked to someone else here.', 'already_linked', 409)
    throw error
  }
}

export const deleteIdentity = (userId, id) => db().user_identities.deleteMany({ where: { id, user_id: userId } })

export const deleteIdentitiesOf = (userId) => db().user_identities.deleteMany({ where: { user_id: userId } })

export async function countLinksByProvider() {
  const rows = await db().user_identities.groupBy({ by: ['provider'], _count: { _all: true } })
  return Object.fromEntries(rows.map((r) => [r.provider, r._count._all]))
}
