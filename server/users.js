/**
 * The instance-wide user directory — owns the `users` table.
 *
 * `users.role` is the *system* role and has exactly two values:
 *   'admin'  instance admin: manages workspaces and users, and nothing else.
 *            An admin holds no workspace membership at all (see promote()), so
 *            they can never reach a connection or a database.
 *   'user'   everyone else. What they can do is decided per workspace by
 *            `workspace_members.role` ('owner' | 'member').
 *
 * See CLAUDE.md "AUTH MODEL".
 */

import { randomUUID } from 'crypto'
import { meta } from './meta.js'
import { sha256 } from './crypto.js'
import { LOCK_COLUMNS, clearFailures, lockStatus } from './login-guard.js'
import { removeAllMemberships } from './workspaces.js'

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
  meta
    .prepare(
      `SELECT w.id, w.name, m.role FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
        WHERE m.user_id = ? ORDER BY w.created_at`
    )
    .all(userId)
    .map((r) => ({ id: r.id, name: r.name, role: r.role === 'admin' ? 'owner' : r.role }))

export const listUsers = () =>
  meta.prepare(`SELECT id, username, name, role, status, ${LOCK_COLUMNS} FROM users ORDER BY role DESC, username`).all().map(toPublic)

export const getUser = (id) => {
  const u = meta.prepare(`SELECT id, username, name, role, status, ${LOCK_COLUMNS} FROM users WHERE id = ?`).get(id)
  return u ? toPublic(u) : null
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
    meta.prepare('DELETE FROM users WHERE id = ?').run(id)
  })()
}
