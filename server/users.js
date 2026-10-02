/**
 * The instance-wide user directory — owns the `users` table.
 *
 * `users.role` is the *system* role and has exactly two values:
 *   'admin'  instance admin: manages workspaces and users, and nothing else.
 *            An admin holds no workspace membership at all (see promote()), so
 *            they can never reach a connection or a database.
 *   'user'   everyone else. What they can do is decided per workspace by
 *            the grant on that workspace's node ('owner' | 'member' | a custom slug).
 *
 * See CLAUDE.md "AUTH MODEL".
 */

import { randomUUID } from 'crypto'
import { db, transaction } from './meta.js'
import { sha256 } from './crypto.js'
import { LOCK_FIELDS, clearFailures, lockStatus } from './login-guard.js'
import { isOwnerRole, membershipsOf, removeAllMemberships } from './workspaces.js'
import { clearMembershipsFor, clearOwnedNodesEverywhere, revokePrincipalEverywhere } from './resource-tree.js'
import { getRole } from './permissions.js'

export const SYSTEM_ROLES = ['admin', 'user']

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

// Never leaks password_hash or a live token. `blocked` and friends come from
// the brute-force guard (server/login-guard.js) — an account blocked by failed
// sign-ins keeps its 'active' status, so the invite flow's pending/active
// meaning is untouched.
const toPublic = async (u) => ({
  id: u.id,
  email: u.username,
  name: u.name || u.username,
  role: u.role === 'admin' ? 'admin' : 'user',
  status: u.status || 'active',
  ...lockStatus(u),
  workspaces: await workspacesOf(u.id),
})

const PUBLIC_FIELDS = { id: true, username: true, name: true, role: true, status: true, ...LOCK_FIELDS }

// Where this user stands in each workspace — what makes the admin user list
// actionable ("who owns what") without a second round trip.
const workspacesOf = async (userId) =>
  (await membershipsOf(userId))
    .map((r) => {
      const role = r.role === 'admin' ? 'owner' : r.role
      // `roleName` and `isOwner` so the admin list can render a configurable
      // role without knowing what any slug means.
      return { id: r.id, name: r.name, role, roleName: getRole(role)?.name || role, isOwner: isOwnerRole(role) }
    })

export const listUsers = async () =>
  Promise.all(
    (await db().users.findMany({ select: PUBLIC_FIELDS, orderBy: [{ role: 'desc' }, { username: 'asc' }] })).map(toPublic)
  )

export const getUser = async (id) => {
  const u = id ? await db().users.findUnique({ where: { id }, select: PUBLIC_FIELDS }) : null
  return u ? toPublic(u) : null
}

/**
 * Just enough of a person to attribute a row to them — an id → { id, name,
 * email } map for the ids handed in.
 *
 * An audit trail ("created by", "last updated by") needs a name beside an id
 * and nothing else, so this deliberately skips the per-user workspace
 * resolution `listUsers` does. An id with no user behind it (a deleted account)
 * is simply absent from the map, which is what lets the caller render it as
 * unattributed rather than leaking a stray id into the UI.
 */
export const userSummaries = async (ids = []) => {
  const unique = [...new Set(ids.filter(Boolean))]
  if (!unique.length) return new Map()
  const rows = await db().users.findMany({ where: { id: { in: unique } }, select: { id: true, username: true, name: true } })
  return new Map(rows.map((u) => [u.id, { id: u.id, name: u.name || u.username, email: u.username }]))
}

export const countAdmins = async () => db().users.count({ where: { role: 'admin' } })

/**
 * Create an account. With a password it is active immediately; without one it
 * is 'pending' and gets an invite token the caller turns into a link — the same
 * shape the workspace invite flow uses, so both land in one account model.
 */
export const createUser = async ({ email, name, password, role = 'user', inviteWorkspaceId = null }) => {
  const id = randomUUID()
  const token = password ? null : randomUUID()
  await db().users.create({
    data: {
      id,
      username: email,
      password_hash: password ? sha256(password) : '',
      name: name || email,
      role: role === 'admin' ? 'admin' : 'user',
      status: password ? 'active' : 'pending',
      invite_token: token,
      invite_workspace: token ? inviteWorkspaceId : null,
      token_expires: token ? Date.now() + INVITE_TTL_MS : null,
    },
  })
  return { user: await getUser(id), inviteToken: token }
}

/**
 * Does this password match the account's current one? Used by the self-service
 * password change, which must prove the caller owns the session *and* knows the
 * old password — a stolen token alone must not be enough to lock its owner out.
 * A 'pending' account has no password yet, so it can never match.
 */
export const verifyPassword = async (id, password) => {
  const row = id ? await db().users.findUnique({ where: { id }, select: { password_hash: true, status: true } }) : null
  if (!row || row.status === 'pending' || !row.password_hash) return false
  return row.password_hash === sha256(password)
}

export const updateUser = async (id, { name, password }) => {
  if (name !== undefined) await db().users.updateMany({ where: { id }, data: { name } })
  if (password) {
    await db().users.updateMany({ where: { id }, data: { password_hash: sha256(password), status: 'active' } })
    // A new password hands the account back to its owner — the failed-attempt
    // counter (and any block it caused) is about the old one.
    await clearFailures(id)
  }
  return getUser(id)
}

/**
 * Move a user between the two system roles.
 *
 * Promoting to 'admin' strips every workspace membership: an instance admin may
 * not own or belong to a workspace, which is what keeps instance administration
 * free of data access. Demoting only changes the role — the user comes back
 * with no workspaces until an owner (or an admin) puts them in one.
 */
export const setSystemRole = async (id, role) => {
  const next = role === 'admin' ? 'admin' : 'user'
  await transaction(async () => {
    await db().users.updateMany({ where: { id }, data: { role: next } })
    if (next === 'admin') await removeAllMemberships(id)
  })
  return getUser(id)
}

export const issueInviteToken = async (id, workspaceId = null) => {
  const token = randomUUID()
  await db().users.updateMany({
    where: { id },
    data: { invite_token: token, invite_workspace: workspaceId, token_expires: Date.now() + INVITE_TTL_MS },
  })
  return token
}

export const deleteUser = async (id) => {
  await transaction(async () => {
    await removeAllMemberships(id)
    await db().connection_access.deleteMany({ where: { principal_type: 'user', principal_id: id } })
    // Memberships only reach the workspaces they were memberships *of*. Anything
    // the account owned or was granted at the application root, or in a workspace
    // it had already left, survives that sweep — so clear it instance-wide before
    // the row goes, or the tree keeps pointing at a user who no longer exists.
    await clearOwnedNodesEverywhere(id)
    await revokePrincipalEverywhere('user', id)
    await clearMembershipsFor(id)
    await db().users.deleteMany({ where: { id } })
  })
}
