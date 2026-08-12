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
import { meta } from './meta.js'
import { sha256 } from './crypto.js'
import { LOCK_COLUMNS, clearFailures, lockStatus } from './login-guard.js'
import { isOwnerRole, membershipsOf, removeAllMemberships } from './workspaces.js'
import { clearMembershipsFor, clearOwnedNodesEverywhere, revokePrincipalEverywhere } from './resource-tree.js'
import { getRole } from './permissions.js'

export const SYSTEM_ROLES = ['admin', 'user']

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

// Never leaks password_hash or a live token. `blocked` and friends come from
// the brute-force guard (server/login-guard.js) — an account blocked by failed
// sign-ins keeps its 'active' status, so the invite flow's pending/active
// meaning is untouched.
const toPublic = (u) => ({
  id: u.id,
  email: u.username,
  name: u.name || u.username,
  role: u.role === 'admin' ? 'admin' : 'user',
  status: u.status || 'active',
  ...lockStatus(u),
  workspaces: workspacesOf(u.id),
})

// Where this user stands in each workspace — what makes the admin user list
// actionable ("who owns what") without a second round trip.
const workspacesOf = (userId) =>
  membershipsOf(userId)
    .map((r) => {
      const role = r.role === 'admin' ? 'owner' : r.role
      // `roleName` and `isOwner` so the admin list can render a configurable
      // role without knowing what any slug means.
      return { id: r.id, name: r.name, role, roleName: getRole(role)?.name || role, isOwner: isOwnerRole(role) }
    })

export const listUsers = () =>
  meta.prepare(`SELECT id, username, name, role, status, ${LOCK_COLUMNS} FROM users ORDER BY role DESC, username`).all().map(toPublic)

export const getUser = (id) => {
  const u = meta.prepare(`SELECT id, username, name, role, status, ${LOCK_COLUMNS} FROM users WHERE id = ?`).get(id)
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
export const userSummaries = (ids = []) => {
  const unique = [...new Set(ids.filter(Boolean))]
  if (!unique.length) return new Map()
  const rows = meta
    .prepare(`SELECT id, username, name FROM users WHERE id IN (${unique.map(() => '?').join(', ')})`)
    .all(...unique)
  return new Map(rows.map((u) => [u.id, { id: u.id, name: u.name || u.username, email: u.username }]))
}

export const countAdmins = () => meta.prepare("SELECT COUNT(*) c FROM users WHERE role = 'admin'").get().c

/**
 * Create an account. With a password it is active immediately; without one it
 * is 'pending' and gets an invite token the caller turns into a link — the same
 * shape the workspace invite flow uses, so both land in one account model.
 */
export const createUser = ({ email, name, password, role = 'user', inviteWorkspaceId = null }) => {
  const id = randomUUID()
  const token = password ? null : randomUUID()
  meta
    .prepare(
      `INSERT INTO users (id, username, password_hash, name, role, status, invite_token, invite_workspace, token_expires)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      email,
      password ? sha256(password) : '',
      name || email,
      role === 'admin' ? 'admin' : 'user',
      password ? 'active' : 'pending',
      token,
      token ? inviteWorkspaceId : null,
      token ? Date.now() + INVITE_TTL_MS : null
    )
  return { user: getUser(id), inviteToken: token }
}

/**
 * Does this password match the account's current one? Used by the self-service
 * password change, which must prove the caller owns the session *and* knows the
 * old password — a stolen token alone must not be enough to lock its owner out.
 * A 'pending' account has no password yet, so it can never match.
 */
export const verifyPassword = (id, password) => {
  const row = meta.prepare('SELECT password_hash, status FROM users WHERE id = ?').get(id)
  if (!row || row.status === 'pending' || !row.password_hash) return false
  return row.password_hash === sha256(password)
}

export const updateUser = (id, { name, password }) => {
  if (name !== undefined) meta.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, id)
  if (password) {
    meta.prepare("UPDATE users SET password_hash = ?, status = 'active' WHERE id = ?").run(sha256(password), id)
    // A new password hands the account back to its owner — the failed-attempt
    // counter (and any block it caused) is about the old one.
    clearFailures(id)
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
export const setSystemRole = (id, role) => {
  const next = role === 'admin' ? 'admin' : 'user'
  meta.prepare('UPDATE users SET role = ? WHERE id = ?').run(next, id)
  if (next === 'admin') removeAllMemberships(id)
  return getUser(id)
}

export const issueInviteToken = (id, workspaceId = null) => {
  const token = randomUUID()
  meta
    .prepare('UPDATE users SET invite_token = ?, invite_workspace = ?, token_expires = ? WHERE id = ?')
    .run(token, workspaceId, Date.now() + INVITE_TTL_MS, id)
  return token
}

export const deleteUser = (id) => {
  meta.transaction(() => {
    removeAllMemberships(id)
    meta.prepare("DELETE FROM connection_access WHERE principal_type = 'user' AND principal_id = ?").run(id)
    // Memberships only reach the workspaces they were memberships *of*. Anything
    // the account owned or was granted at the application root, or in a workspace
    // it had already left, survives that sweep — so clear it instance-wide before
    // the row goes, or the tree keeps pointing at a user who no longer exists.
    clearOwnedNodesEverywhere(id)
    revokePrincipalEverywhere('user', id)
    clearMembershipsFor(id)
    meta.prepare('DELETE FROM users WHERE id = ?').run(id)
  })()
}
