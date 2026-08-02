#!/usr/bin/env node
/**
 * HTTP surface for the database manager.
 *
 * This file is routes and wiring only. Everything a route needs lives in a
 * module under server/:
 *
 *   db/           the engine-agnostic database layer (sqlite | postgres | redis)
 *   meta.js       the app's own SQLite store; migrations.js evolves its schema
 *   auth.js       sessions, guards, workspace/team access rules
 *   connections.js  connection records (credentials encrypted at rest)
 *   folders.js    the polymorphic folder tree
 *   storage.js    S3-compatible + local backup destinations
 *   workflow.js   the node-graph executor and its scheduler
 *   backup/       backup schedule, runner and restore
 *   connection-transfer.js  the portable connection export/import bundle
 *   system-update.js        release checking + Docker self-update
 *
 * A route should read as: authorize → validate → call one of those → respond.
 * No route branches on `conn.type`; the db layer answers for every engine.
 */

import express from 'express'
import cors from 'cors'
import fs from 'fs'
import path from 'path'
import { randomUUID, timingSafeEqual } from 'crypto'
import { pipeline } from 'stream/promises'
import { Transform } from 'stream'
import cron from 'node-cron'

import {
  APP_NAME,
  APP_VERSION,
  AUTO_CHECK_UPDATES,
  BACKUPS_DIR,
  BACKUP_TMP_DIR,
  DIST_DIR,
  GIT_SHA,
  MAX_SESSIONS_PER_CONNECTION,
  META_DB_PATH,
  PORT,
  SCHEDULER_ENABLED,
} from './server/config.js'
import { meta, initMetaDb } from './server/meta.js'
import { sha256 } from './server/crypto.js'
import { describeError, safeJson, sanitizeForKey } from './server/util.js'
import {
  authUser,
  baseUrl,
  bearerToken,
  can,
  connectionAccess,
  createSession,
  deleteSession,
  getUserByEmail,
  isSystemAdmin,
  memberRole,
  permissionsIn,
  publicUser,
  requireAuth,
  requireMember,
  requirePermission,
  requireSystemAdmin,
  sessionMiddleware,
  setConnectionAccess,
  userCanAccessConnection,
  userRow,
  workspaceForUser,
} from './server/auth.js'
import {
  addMember as addWorkspaceMember,
  countOwners,
  isOwnerRole,
  createWorkspace as createWorkspaceRow,
  deleteWorkspaceCascade,
  getWorkspaceRow,
  listAllWorkspaces,
  listUserSoleOwnerships,
  listWorkspaceMembers,
  removeMember as removeWorkspaceMember,
  renameWorkspace,
  setMemberRole as setWorkspaceMemberRole,
} from './server/workspaces.js'
import {
  PERMISSIONS,
  countRoleUsage,
  createRole,
  deleteRole,
  getRole,
  listRoles,
  roleExists,
  updateRole,
} from './server/permissions.js'
import {
  LOCK_COLUMNS,
  clearFailures,
  loginRefusal,
  recordFailure,
  unlockUser as unblockUser,
} from './server/login-guard.js'
import {
  SYSTEM_ROLES,
  countAdmins,
  createUser,
  deleteUser,
  getUser,
  issueInviteToken,
  listUsers,
  setSystemRole,
  updateUser,
  verifyPassword,
} from './server/users.js'
import {
  connectionSessionStats,
  destroyAuthSessionsForUser,
  endAllConnectionSessions,
  endConnectionSession,
  listConnectionSessions,
  resolveMaxSessions,
  sweepConnectionSessions,
  closeSessionStore,
  cache as sessionCache,
} from './server/sessions/index.js'
import {
  describeSmtpError,
  envSmtp,
  publicSmtpConfig,
  sendInviteEmail,
  sendResetEmail,
  sendTestEmail,
  smtpConfig,
} from './server/mail.js'
import { clearGlobalSmtp, publicGlobalSmtp, saveGlobalSmtp } from './server/app-settings.js'
import {
  bumpSchemaVersion,
  deleteConnectionRow,
  getConnection,
  listConnections,
  saveConnection,
  setSchemaVersion,
} from './server/connections.js'
import {
  FOLDER_TYPES,
  folderDepth,
  folderHasAncestor,
  folderHeight,
  folderRow,
  folderTypeOf,
} from './server/folders.js'
import * as db from './server/db/index.js'
import { classifyStatement, splitSqlStatements, stripSqlComments } from './server/db/sql.js'
import {
  createStorage,
  deleteObjects as deleteStorageObjects,
  deleteStorage,
  getStorage,
  isStorageInUse,
  listObjects as listStorageObjects,
  listStorageRows,
  testStorage,
  updateStorage,
} from './server/storage.js'
import { executeAndRecord, nextRunForGraph, runDueWorkflows } from './server/workflow.js'
import {
  canRestore,
  createSchedule,
  fetchArtifact,
  getBackupSchedule,
  getBackupScheduleRow,
  restoreFromFile,
  restoreFromStorage,
  runBackupOnce,
  runDueBackups,
  storageForRestore,
  updateSchedule,
  validateScheduleBody,
} from './server/backup/index.js'
import { buildConnectionExport, importConnectionDoc } from './server/connection-transfer.js'
import {
  cachedUpdateInfo,
  dockerSelfUpdate,
  dockerSelfUpdateAvailable,
  getUpdateInfo,
  manualUpdateCommand,
  updateApplyMethod,
} from './server/system-update.js'

const app = express()
app.use(cors())
app.use(express.json({ limit: '10mb' }))
// Resolve the bearer token once per request (the session store is async, the
// ~100 `requireAuth` call sites are not — see server/auth.js).
app.use(sessionMiddleware)

// Boot readiness — flipped true once the meta DB's migrations are done.
let bootReady = false
initMetaDb()
bootReady = true

// The database/schema a request is aimed at. Every db layer call takes one, and
// each engine reads only the parts that mean something to it. `actor` is who to
// credit on the connection session the call opens/refreshes (drivers ignore it).
const queryCtx = (req) => {
  const user = authUser(req)
  return {
    database: req.query.database,
    schema: req.query.schema,
    actor: user ? { id: user.id, name: user.name || user.username } : null,
  }
}

// Same, for routes that carry the target in the body rather than the query.
const bodyCtx = (req) => {
  const user = authUser(req)
  return {
    database: req.body?.database,
    schema: req.body?.schema,
    actor: user ? { id: user.id, name: user.name || user.username } : null,
  }
}

// What a login session records about where it was created, for the session list.
const sessionContext = (req) => ({
  ip: req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || null,
  userAgent: req.headers['user-agent'] || null,
})

// Route error → response. `status` is set by the db layer for "this engine
// can't do that" and by the import/restore paths for bad input.
const fail = (res, error, fallbackStatus = 500) => res.status(error.status || fallbackStatus).json({ error: error.message })

// ============================================================================
// Authentication
// ============================================================================

// The lock the guard just created, in row shape, so the refusal message for the
// attempt that tripped it is built the same way as every later one.
const lockRow = (lock) => ({ locked_at: lock.lockedAt, locked_until: lock.lockedUntil, failed_logins: lock.attempts })

// Authenticate a user (by email, stored in `username`). Returns a session token.
//
// Repeated failures block the account (server/login-guard.js). The block is
// checked before the password is verified, so a locked account can neither be
// probed nor signed into with a guessed password; an unknown address is never
// counted and gets the same generic answer as a wrong password.
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {}
  const row = meta
    .prepare(`SELECT id, username, name, role, status, password_hash, ${LOCK_COLUMNS} FROM users WHERE username = ?`)
    .get(username)
  if (row) {
    const refusal = loginRefusal(row)
    if (refusal) return res.status(refusal.status).json(refusal.body)
  }
  if (!row || row.status === 'pending' || row.password_hash !== sha256(password)) {
    if (row && row.status !== 'pending') {
      const lock = recordFailure(row)
      if (lock) return res.status(423).json(loginRefusal({ ...row, ...lockRow(lock) }).body)
    }
    return res.status(401).json({ error: 'Invalid email or password' })
  }
  clearFailures(row.id)
  res.json({ user: publicUser(row), token: await createSession(row.id, sessionContext(req)) })
})

// Log out — invalidate the current session token.
app.post('/api/auth/logout', async (req, res) => {
  const token = bearerToken(req)
  if (token) await deleteSession(token)
  res.json({ ok: true })
})

// ---- The signed-in user's own account -------------------------------------
// These three are the self-service counterpart of /api/admin/users/*: they act
// on the caller and only on the caller, so they need no role beyond being
// authenticated. The email is the login identity and is deliberately not
// editable here — changing it is an admin action.

// The caller's own profile, re-read from the DB (the client caches it).
app.get('/api/auth/me', (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  res.json({ user: publicUser(user) })
})

// Rename yourself. Name is the only self-editable profile field.
app.patch('/api/auth/profile', (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  const name = (req.body?.name ?? '').trim()
  if (!name) return res.status(400).json({ error: 'A name is required.' })
  updateUser(user.id, { name })
  res.json({ user: publicUser(userRow(user.id)) })
})

// Change your own password. The current password is required — a session token
// alone must not let someone lock its owner out of their account.
//
// A successful change signs out every session (this one included, since we
// can't tell the other devices apart from a stolen copy of this token) and
// hands back a fresh one, so the caller stays logged in where they are.
app.post('/api/auth/password', async (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  const { currentPassword, newPassword } = req.body || {}
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Both your current and new password are required.' })
  }
  if (!verifyPassword(user.id, currentPassword)) {
    return res.status(400).json({ error: 'Your current password is incorrect.' })
  }
  if (currentPassword === newPassword) {
    return res.status(400).json({ error: 'The new password must be different from the current one.' })
  }
  updateUser(user.id, { password: newPassword })
  await destroyAuthSessionsForUser(user.id)
  res.json({ user: publicUser(userRow(user.id)), token: await createSession(user.id, sessionContext(req)) })
})

// Request a password reset. Always 200 — never reveal whether the email exists.
// When SMTP is available the reset link is emailed; the link is never returned.
app.post('/api/auth/forgot', async (req, res) => {
  const email = (req.body?.email || '').trim().toLowerCase()
  const user = email ? meta.prepare('SELECT id, username, status FROM users WHERE username = ?').get(email) : null
  if (user && user.status !== 'pending') {
    const token = randomUUID()
    const expires = Date.now() + 60 * 60 * 1000 // 1 hour
    meta.prepare('UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?').run(token, expires, user.id)
    const cfg = smtpConfig()
    if (cfg) {
      try {
        await sendResetEmail(cfg, { to: email, link: `${baseUrl(req)}/reset/${token}` })
      } catch (e) {
        console.error('Password reset email failed:', e.message)
      }
    } else {
      console.warn('Password reset requested but no SMTP is configured; cannot email the link.')
    }
  }
  res.json({ ok: true })
})

// Validate a reset token (for the reset page).
app.get('/api/auth/reset/:token', (req, res) => {
  const u = meta.prepare('SELECT username, reset_expires FROM users WHERE reset_token = ?').get(req.params.token)
  if (!u || (u.reset_expires && u.reset_expires < Date.now())) {
    return res.status(404).json({ error: 'This reset link is invalid or has expired.' })
  }
  res.json({ email: u.username })
})

// Set a new password, invalidate existing sessions, and log the user in.
app.post('/api/auth/reset/:token', async (req, res) => {
  const u = meta.prepare('SELECT id, reset_expires FROM users WHERE reset_token = ?').get(req.params.token)
  if (!u || (u.reset_expires && u.reset_expires < Date.now())) {
    return res.status(404).json({ error: 'This reset link is invalid or has expired.' })
  }
  const { password } = req.body || {}
  if (!password) return res.status(400).json({ error: 'A password is required.' })
  meta
    .prepare("UPDATE users SET password_hash = ?, status = 'active', reset_token = NULL, reset_expires = NULL WHERE id = ?")
    .run(sha256(password), u.id)
  // Setting a new password through an emailed link proves control of the
  // mailbox, so it lifts a brute-force block as well — otherwise the one
  // self-service recovery path would dead-end at the login page.
  clearFailures(u.id)
  await destroyAuthSessionsForUser(u.id) // sign out everywhere else
  const user = meta.prepare('SELECT id, username, name, role FROM users WHERE id = ?').get(u.id)
  res.json({ user: publicUser(user), token: await createSession(u.id, sessionContext(req)) })
})

// First-run status — true when no users exist yet (setup wizard needed).
app.get('/api/setup', (req, res) => {
  res.json({ needsSetup: !meta.prepare('SELECT 1 FROM users LIMIT 1').get() })
})

// First-run setup — creates the admin account + first workspace. Only allowed
// while no users exist, so it can't be used to hijack an initialized instance.
app.post('/api/setup', async (req, res) => {
  if (meta.prepare('SELECT 1 FROM users LIMIT 1').get()) {
    return res.status(403).json({ error: 'Setup has already been completed.' })
  }
  const { email, password, name, workspace } = req.body || {}
  if (!email || !password || !workspace?.trim()) {
    return res.status(400).json({ error: 'Email, password and workspace name are required.' })
  }
  const uid = randomUUID()
  meta
    .prepare('INSERT INTO users (id, username, password_hash, name, role, status) VALUES (?, ?, ?, ?, ?, ?)')
    .run(uid, email.trim(), sha256(password), name?.trim() || 'Admin', 'admin', 'active')
  // The first account is the instance admin, so it is deliberately *not* made a
  // member of the workspace it names — an admin never holds workspace access
  // (CLAUDE.md "AUTH MODEL"). The workspace is created ownerless; the admin's
  // first job is to invite someone and make them its owner.
  createWorkspaceRow(workspace.trim())
  const user = meta.prepare('SELECT id, username, name, role FROM users WHERE id = ?').get(uid)
  res.json({ user: publicUser(user), token: await createSession(uid, sessionContext(req)) })
})

// Validate an invite token → who it's for and which workspace.
app.get('/api/invite/:token', (req, res) => {
  const u = meta
    .prepare('SELECT username, invite_workspace, token_expires FROM users WHERE invite_token = ?')
    .get(req.params.token)
  if (!u || (u.token_expires && u.token_expires < Date.now())) {
    return res.status(404).json({ error: 'This invite is invalid or has expired.' })
  }
  const ws = meta.prepare('SELECT name FROM workspaces WHERE id = ?').get(u.invite_workspace)
  res.json({ email: u.username, workspaceName: ws?.name || 'a workspace' })
})

// Accept an invite — set name + password, activate the account, log in.
app.post('/api/invite/:token/accept', async (req, res) => {
  const u = meta
    .prepare('SELECT id, username, name, token_expires FROM users WHERE invite_token = ?')
    .get(req.params.token)
  if (!u || (u.token_expires && u.token_expires < Date.now())) {
    return res.status(404).json({ error: 'This invite is invalid or has expired.' })
  }
  const { name, password } = req.body || {}
  if (!password) return res.status(400).json({ error: 'A password is required.' })
  meta
    .prepare("UPDATE users SET password_hash = ?, name = ?, status = 'active', invite_token = NULL, invite_workspace = NULL, token_expires = NULL WHERE id = ?")
    .run(sha256(password), name?.trim() || u.name || u.username, u.id)
  const user = meta.prepare('SELECT id, username, name, role FROM users WHERE id = ?').get(u.id)
  res.json({ user: publicUser(user), token: await createSession(u.id, sessionContext(req)) })
})

// ============================================================================
// Instance administration (system admins only)
//
// The admin area is deliberately narrow: workspaces and accounts, nothing
// inside them. An admin holds no workspace membership, so every route below
// this section's guard already denies them — that's the separation, not an
// oversight. See CLAUDE.md "AUTH MODEL".
// ============================================================================

app.use('/api/admin', (req, res, next) => {
  if (!requireSystemAdmin(req, res)) return
  next()
})

// ---- Workspaces ----

app.get('/api/admin/workspaces', (_req, res) => res.json(listAllWorkspaces()))

// Create a workspace and hand it to someone. `ownerEmail` may name an existing
// account or a new one — an unknown address gets a pending account plus an
// invite link, so an admin can stand up a workspace for a person who has never
// signed in.
app.post('/api/admin/workspaces', async (req, res) => {
  const name = (req.body?.name || '').trim()
  const ownerEmail = (req.body?.ownerEmail || '').trim().toLowerCase()
  if (!name) return res.status(400).json({ error: 'Workspace name is required.' })
  if (!ownerEmail) return res.status(400).json({ error: 'An owner email is required — a workspace needs someone to run it.' })

  let owner = getUserByEmail(ownerEmail)
  if (isSystemAdmin(owner)) {
    return res.status(400).json({ error: 'That account administers the instance and cannot own a workspace.' })
  }
  const ws = createWorkspaceRow(name)
  let inviteLink = null
  if (!owner) {
    const { user: created, inviteToken } = createUser({ email: ownerEmail, name: ownerEmail, inviteWorkspaceId: ws.id })
    owner = { id: created.id, username: ownerEmail, status: 'pending' }
    inviteLink = `${baseUrl(req)}/invite/${inviteToken}`
  } else if (owner.status === 'pending') {
    inviteLink = `${baseUrl(req)}/invite/${issueInviteToken(owner.id, ws.id)}`
  }
  addWorkspaceMember(ws.id, owner.id, 'owner')

  let emailed = false
  if (inviteLink) {
    const cfg = smtpConfig()
    if (cfg) {
      try {
        await sendInviteEmail(cfg, { to: ownerEmail, workspaceName: ws.name, link: inviteLink })
        emailed = true
      } catch (e) {
        console.error('Owner invite email failed:', e.message)
      }
    }
  }
  res.json({ workspace: { ...ws, memberCount: 1, teamCount: 0, connectionCount: 0 }, inviteLink, emailed })
})

app.put('/api/admin/workspaces/:id', (req, res) => {
  if (!getWorkspaceRow(req.params.id)) return res.status(404).json({ error: 'Workspace not found' })
  const name = (req.body?.name || '').trim()
  if (!name) return res.status(400).json({ error: 'Workspace name is required.' })
  renameWorkspace(req.params.id, name)
  res.json({ ok: true, name })
})

app.delete('/api/admin/workspaces/:id', async (req, res) => {
  if (!getWorkspaceRow(req.params.id)) return res.status(404).json({ error: 'Workspace not found' })
  const removed = await dropWorkspace(req.params.id)
  res.json({ ok: true, connectionsDeleted: removed.length })
})

// The membership list, so an admin can see and change who owns a workspace
// without joining it.
app.get('/api/admin/workspaces/:id/members', (req, res) => {
  if (!getWorkspaceRow(req.params.id)) return res.status(404).json({ error: 'Workspace not found' })
  res.json(listWorkspaceMembers(req.params.id))
})

// Grant or revoke ownership. This is the admin's lever over a workspace they
// can't enter: it can rescue one whose owners have all left.
app.put('/api/admin/workspaces/:id/members/:userId', (req, res) => {
  if (!getWorkspaceRow(req.params.id)) return res.status(404).json({ error: 'Workspace not found' })
  const role = req.body?.role
  if (!roleExists(role)) return res.status(400).json({ error: 'Unknown role.' })
  const target = userRow(req.params.userId)
  if (!target) return res.status(404).json({ error: 'User not found' })
  if (isSystemAdmin(target)) return res.status(400).json({ error: 'An instance admin cannot belong to a workspace.' })

  const current = memberRole(req.params.id, req.params.userId)
  if (!current) addWorkspaceMember(req.params.id, req.params.userId, role)
  else {
    if (isOwnerRole(current) && !isOwnerRole(role) && countOwners(req.params.id) <= 1) {
      return res.status(400).json({ error: 'The workspace needs at least one owner.' })
    }
    setWorkspaceMemberRole(req.params.id, req.params.userId, role)
  }
  res.json({ ok: true, role })
})

app.delete('/api/admin/workspaces/:id/members/:userId', (req, res) => {
  const current = memberRole(req.params.id, req.params.userId)
  if (!current) return res.status(404).json({ error: 'Member not found' })
  if (isOwnerRole(current) && countOwners(req.params.id) <= 1) {
    return res.status(400).json({ error: 'The workspace needs at least one owner.' })
  }
  removeWorkspaceMember(req.params.id, req.params.userId)
  res.json({ ok: true })
})

// ---- Roles ----
//
// Workspace roles are instance-wide and defined here: an admin sets the access
// model once, and a workspace owner assigns people to it. The system tier
// (users.role) is deliberately not part of this — see server/permissions.js.

// The permission catalog: everything a role can be given, grouped for the editor.
// It comes from code, not the DB, so the UI can only offer what a route enforces.
app.get('/api/admin/permissions', (_req, res) => res.json(PERMISSIONS))

app.post('/api/admin/roles', (req, res) => {
  const name = (req.body?.name || '').trim()
  if (!name) return res.status(400).json({ error: 'A role name is required.' })
  res.json(createRole({ name, description: req.body?.description || '', permissions: req.body?.permissions || [] }))
})

// Rename a role or change what it grants. The slug is fixed at creation because
// memberships store it, so a rename never touches a single membership row.
app.put('/api/admin/roles/:slug', (req, res) => {
  if (!roleExists(req.params.slug)) return res.status(404).json({ error: 'Role not found' })
  const { name, description, permissions } = req.body || {}
  if (name !== undefined && !String(name).trim()) return res.status(400).json({ error: 'A role name is required.' })
  res.json(updateRole(req.params.slug, { name, description, permissions }))
})

// Delete a custom role. Refused while anyone holds it — those memberships would
// silently fail closed to no access — and builtins are never deletable.
app.delete('/api/admin/roles/:slug', (req, res) => {
  const role = getRole(req.params.slug)
  if (!role) return res.status(404).json({ error: 'Role not found' })
  if (role.builtin) return res.status(400).json({ error: 'A built-in role cannot be deleted.' })
  const inUse = countRoleUsage(req.params.slug)
  if (inUse) return res.status(409).json({ error: `${inUse} member${inUse === 1 ? '' : 's'} still hold this role.`, inUse })
  deleteRole(req.params.slug)
  res.json({ ok: true })
})

// ---- Users ----

app.get('/api/admin/users', (_req, res) => res.json(listUsers()))

// Create an account. With a password it's usable immediately; without one it's
// pending and the returned invite link is how they set theirs.
app.post('/api/admin/users', (req, res) => {
  const email = (req.body?.email || '').trim().toLowerCase()
  const { name, password, role } = req.body || {}
  if (!email) return res.status(400).json({ error: 'Email is required.' })
  if (getUserByEmail(email)) return res.status(400).json({ error: 'That email already has an account.' })
  const { user: created, inviteToken } = createUser({ email, name: name?.trim(), password, role })
  res.json({ user: created, inviteLink: inviteToken ? `${baseUrl(req)}/invite/${inviteToken}` : null })
})

// Rename, reset a password, or move between the two system roles. Promoting to
// admin drops every workspace membership the account had (server/users.js).
app.put('/api/admin/users/:id', async (req, res) => {
  const target = userRow(req.params.id)
  if (!target) return res.status(404).json({ error: 'User not found' })
  const { name, password, role } = req.body || {}
  if (role !== undefined && !SYSTEM_ROLES.includes(role)) return res.status(400).json({ error: "Role must be 'admin' or 'user'." })
  if (role === 'user' && target.role === 'admin' && countAdmins() <= 1) {
    return res.status(400).json({ error: 'The instance needs at least one admin.' })
  }
  // Promoting drops every workspace membership (an admin holds none), so it
  // would orphan any workspace this account is the last owner of. Same refusal
  // as deleting them — reassign ownership first.
  if (role === 'admin' && target.role !== 'admin') {
    const orphaned = listUserSoleOwnerships(req.params.id)
    if (orphaned.length) {
      return res.status(409).json({
        error: `This account is the only owner of ${orphaned
          .map((w) => w.name)
          .join(', ')}. An instance admin holds no workspace access, so assign another owner first.`,
        workspaces: orphaned,
      })
    }
  }
  updateUser(req.params.id, { name: name?.trim(), password })
  if (role !== undefined && role !== target.role) setSystemRole(req.params.id, role)
  // A changed password or a changed role invalidates what the open sessions
  // were authorized for — make them sign in again.
  if (password || (role !== undefined && role !== target.role)) await destroyAuthSessionsForUser(req.params.id)
  res.json(getUser(req.params.id))
})

// Lift a brute-force block: clears the failed-attempt counter and lets the
// account sign in again. The only way back in for a blocked account other than
// a password reset — an admin is never blocked indefinitely, so this can't be
// the door that locks itself.
app.post('/api/admin/users/:id/unblock', (req, res) => {
  const target = userRow(req.params.id)
  if (!target) return res.status(404).json({ error: 'User not found' })
  unblockUser(req.params.id)
  res.json(getUser(req.params.id))
})

app.delete('/api/admin/users/:id', async (req, res) => {
  const target = userRow(req.params.id)
  if (!target) return res.status(404).json({ error: 'User not found' })
  if (req.params.id === authUser(req).id) return res.status(400).json({ error: "You can't delete your own account." })
  if (target.role === 'admin' && countAdmins() <= 1) return res.status(400).json({ error: 'The instance needs at least one admin.' })
  // Refuse to orphan a workspace — reassign its ownership first, so the deletion
  // can never quietly leave a workspace nobody can manage.
  const orphaned = listUserSoleOwnerships(req.params.id)
  if (orphaned.length) {
    return res.status(409).json({
      error: `This account is the only owner of ${orphaned.map((w) => w.name).join(', ')}. Assign another owner first.`,
      workspaces: orphaned,
    })
  }
  await destroyAuthSessionsForUser(req.params.id)
  deleteUser(req.params.id)
  res.json({ ok: true })
})

// ---- Email (SMTP) ----
//
// The instance's one mail server — every email the app sends uses it. This is
// the admin-editable form of what used to be SMTP_* env only; the env vars
// still apply underneath, so an install that configures SMTP through
// docker-compose keeps working without an admin ever opening this page.
// Deliberately admin-only: workspaces no longer configure their own.

app.get('/api/admin/smtp', (_req, res) => {
  // `env` is the layer under the saved config — shown so an admin can see what
  // docker-compose already configured (and pre-fill the form from it). Password
  // stripped, like every other config the API hands out.
  const env = envSmtp()
  res.json({
    smtp: publicGlobalSmtp(),
    env: env ? { host: env.host, port: env.port || '587', secure: env.secure, user: env.user, from: env.from || env.user || '' } : null,
  })
})

app.put('/api/admin/smtp', (req, res) => {
  const { host, port, secure, user, from, pass } = req.body || {}
  const saved = saveGlobalSmtp({ host, port, secure, user, from, pass })
  res.json({ smtp: saved })
})

// Drop the saved config — the instance falls back to the SMTP_* env vars, or
// to no mail at all.
app.delete('/api/admin/smtp', (_req, res) => {
  clearGlobalSmtp()
  res.json({ ok: true, smtp: publicGlobalSmtp() })
})

// Test the unsaved form values (body.smtp) or, with none, whatever is in
// effect instance-wide right now.
app.post('/api/admin/smtp/test', async (req, res) => {
  const { to, smtp: overrides } = req.body || {}
  const stored = smtpConfig()
  let cfg
  if (overrides?.host) {
    const user = overrides.user || ''
    cfg = {
      host: overrides.host,
      port: Number(overrides.port || 587),
      secure: !!overrides.secure,
      user,
      // A blank password on the form means "keep using the saved one".
      pass: overrides.pass || stored?.pass || '',
      from: overrides.from || user || 'no-reply@tabletsgo.local',
    }
  } else {
    cfg = stored
  }
  if (!cfg?.host) return res.status(400).json({ error: 'No SMTP host configured.' })
  try {
    await sendTestEmail(cfg, { to: to || authUser(req).username, scope: 'global SMTP settings' })
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: describeSmtpError(err) })
  }
})

// ============================================================================
// Workspaces
// ============================================================================

// The instance's role catalog, readable by any signed-in user: a workspace owner
// needs the names to assign one, and the client needs the permission lists to
// explain what each grants. Editing them is admin-only (/api/admin/roles).
app.get('/api/roles', (req, res) => {
  if (!requireAuth(req, res)) return
  res.json(listRoles())
})

// Workspaces the caller belongs to.
app.get('/api/workspaces', (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  const rows = meta
    .prepare(
      `SELECT w.id, w.name, w.created_at, w.settings, m.role
       FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
       WHERE m.user_id = ? ORDER BY w.created_at`
    )
    .all(user.id)
  // Beta experiment flags + notification prefs ship in the list response (not
  // just the detail route) so nav-level gating and this settings panel don't
  // go stale after a save that only refreshes via listWorkspaces().
  // `permissions` rides along for the same reason: every nav item and button
  // gated on a capability would otherwise flicker until the detail route lands.
  res.json(
    rows.map((r) => {
      const settings = safeJson(r.settings)
      return {
        id: r.id,
        name: r.name,
        role: r.role,
        permissions: [...permissionsIn(r.id, user.id)],
        createdAt: r.created_at,
        experiments: settings.experiments || {},
        notifications: settings.notifications || {},
      }
    })
  )
})

// Create a workspace — the caller becomes its owner. Instance admins don't go
// through here (they'd become a member of it); they use POST /api/admin/workspaces,
// which names someone else as the owner.
app.post('/api/workspaces', (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  if (isSystemAdmin(user)) {
    return res.status(403).json({ error: 'An instance admin cannot own a workspace. Create it from the admin area and assign an owner.' })
  }
  const { name } = req.body || {}
  if (!name?.trim()) return res.status(400).json({ error: 'Workspace name is required.' })
  const ws = createWorkspaceRow(name.trim(), { ownerId: user.id })
  res.json({ ...ws, role: 'owner' })
})

app.get('/api/workspaces/:id', (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  const ws = workspaceForUser(req.params.id, user.id)
  if (!ws) return res.status(404).json({ error: 'Workspace not found' })
  const row = meta.prepare('SELECT settings FROM workspaces WHERE id = ?').get(req.params.id)
  const settings = safeJson(row?.settings)
  // Beta experiment flags — visible to every member (they gate what the whole
  // workspace sees, e.g. the S3/Backup nav item), toggleable by admins only
  // (enforced in the PUT route below).
  ws.experiments = settings.experiments || {}
  // Notification preferences (e.g. who to email on backup failure) — visible
  // to every member, toggleable by admins only (enforced in the PUT route).
  ws.notifications = settings.notifications || {}
  // Session policy: the workspace-wide default cap on concurrent sessions per
  // connection (0 = unlimited). `instanceDefault` is the env fallback that
  // applies when the workspace leaves it at 0, so the form can show what's
  // actually in effect.
  ws.sessions = { maxPerConnection: settings.sessions?.maxPerConnection || 0, instanceDefault: MAX_SESSIONS_PER_CONNECTION }
  // Owners get the (non-secret) mail server the instance sends with — read-only
  // here: SMTP is instance-level, configured by an admin at /api/admin/smtp.
  // Null when the instance has none, which is what the Notification tab uses to
  // warn that invites can only be shared as links.
  if (ws.role === 'owner') ws.smtp = publicSmtpConfig()
  res.json(ws)
})

/**
 * Rename + beta experiment flags + notification/session policy.
 *
 * One route, two permissions: notification preferences are a separate capability
 * from the workspace's own settings (a role can be given `notifications.manage`
 * and nothing else), so the body is checked field by field rather than the whole
 * route being gated on `workspace.manage`.
 */
app.put('/api/workspaces/:id', (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  // No `smtp` here on purpose: the mail server is instance-level (admin-only).
  // An older client still sending one is ignored rather than rejected.
  const { name, experiments, notifications, sessions } = req.body || {}
  const needsManage = name?.trim() || experiments || sessions
  if (needsManage && !requirePermission(req, res, req.params.id, 'workspace.manage')) return
  if (notifications && !requirePermission(req, res, req.params.id, 'notifications.manage')) return
  if (!needsManage && !notifications && !memberRole(req.params.id, user.id)) return res.status(403).json({ error: 'Forbidden' })

  const row = meta.prepare('SELECT settings FROM workspaces WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Workspace not found' })
  if (name?.trim()) meta.prepare('UPDATE workspaces SET name = ? WHERE id = ?').run(name.trim(), req.params.id)
  if (experiments || notifications || sessions) {
    const settings = safeJson(row.settings)
    if (experiments) settings.experiments = { ...(settings.experiments || {}), ...experiments }
    if (sessions) {
      // 0 = unlimited; negatives and junk clamp to it.
      settings.sessions = { maxPerConnection: Math.max(0, parseInt(sessions.maxPerConnection, 10) || 0) }
    }
    if (notifications) {
      settings.notifications = { ...(settings.notifications || {}) }
      if (notifications.backupFailure) {
        settings.notifications.backupFailure = {
          enabled: !!notifications.backupFailure.enabled,
          memberIds: Array.isArray(notifications.backupFailure.memberIds) ? notifications.backupFailure.memberIds : [],
        }
      }
    }
    meta.prepare('UPDATE workspaces SET settings = ? WHERE id = ?').run(JSON.stringify(settings), req.params.id)
  }
  res.json({ ok: true })
})

// Delete a workspace and everything scoped to it. Never the caller's last one.
app.delete('/api/workspaces/:id', async (req, res) => {
  const user = requirePermission(req, res, req.params.id, 'workspace.delete')
  if (!user) return
  const mine = meta.prepare('SELECT COUNT(*) c FROM workspace_members WHERE user_id = ?').get(user.id).c
  if (mine <= 1) return res.status(400).json({ error: 'You must belong to at least one workspace.' })
  await dropWorkspace(req.params.id)
  res.json({ ok: true })
})

/**
 * Tear down a workspace: close the live database handles its connections hold,
 * then cascade the metadata. Shared by the owner route above and the admin one,
 * so a workspace never disappears while its pools stay open.
 */
async function dropWorkspace(workspaceId) {
  for (const conn of listConnections().filter((c) => c.workspaceId === workspaceId)) {
    db.releaseConnection(conn)
    await endAllConnectionSessions(conn.id)
  }
  return deleteWorkspaceCascade(workspaceId)
}

// ---- Members ----

// List a workspace's members (any member can view).
app.get('/api/workspaces/:id/members', (req, res) => {
  const user = requireMember(req, res, req.params.id)
  if (!user) return
  res.json(listWorkspaceMembers(req.params.id))
})

// Move a member to a different role. Any role in the instance catalog is valid;
// a workspace can have any number of owners but never zero, and an instance
// admin can't be given a seat at all.
app.put('/api/workspaces/:id/members/:userId', (req, res) => {
  const user = requirePermission(req, res, req.params.id, 'members.manage')
  if (!user) return
  const role = req.body?.role
  if (!roleExists(role)) return res.status(400).json({ error: 'Unknown role.' })
  const current = memberRole(req.params.id, req.params.userId)
  if (!current) return res.status(404).json({ error: 'Member not found' })
  const target = userRow(req.params.userId)
  if (isSystemAdmin(target)) {
    return res.status(400).json({ error: 'An instance admin cannot belong to a workspace.' })
  }
  // "Owner" is whoever holds workspace.manage — so this catches moving the last
  // one to any role that doesn't, not just to the built-in 'member'.
  if (isOwnerRole(current) && !isOwnerRole(role) && countOwners(req.params.id) <= 1) {
    return res.status(400).json({ error: 'The workspace needs at least one owner.' })
  }
  setWorkspaceMemberRole(req.params.id, req.params.userId, role)
  res.json({ ok: true, role })
})

// Invite a member by email (owner). Existing accounts are added directly;
// unknown/pending emails get a pending account + an invite link. The link is
// always returned so it works without SMTP.
app.post('/api/workspaces/:id/members', async (req, res) => {
  const user = requirePermission(req, res, req.params.id, 'members.manage')
  if (!user) return
  const email = (req.body?.email || '').trim().toLowerCase()
  if (!email) return res.status(400).json({ error: 'Email is required.' })
  // Invite straight into a role rather than always landing on 'member' and
  // needing a second call to move them.
  const role = req.body?.role || 'member'
  if (!roleExists(role)) return res.status(400).json({ error: 'Unknown role.' })

  let target = getUserByEmail(email)
  if (target && memberRole(req.params.id, target.id)) {
    return res.status(400).json({ error: 'That person is already a member.' })
  }
  if (isSystemAdmin(target)) {
    return res.status(400).json({ error: 'That account administers the instance and cannot join a workspace.' })
  }

  let inviteLink = null
  if (!target) {
    // Brand-new account: 'user' is the system role (a plain, non-admin account);
    // what they may do here is the workspace role set just below.
    const { user: created, inviteToken } = createUser({ email, name: email, inviteWorkspaceId: req.params.id })
    target = { id: created.id, username: email, status: 'pending' }
    inviteLink = `${baseUrl(req)}/invite/${inviteToken}`
  } else if (target.status === 'pending') {
    inviteLink = `${baseUrl(req)}/invite/${issueInviteToken(target.id, req.params.id)}`
  }

  addWorkspaceMember(req.params.id, target.id, role)

  // Email the invite link when SMTP is configured — non-fatal, link is returned regardless.
  let emailed = false
  if (inviteLink) {
    const ws = meta.prepare('SELECT name FROM workspaces WHERE id = ?').get(req.params.id)
    const cfg = smtpConfig()
    if (cfg) {
      try {
        await sendInviteEmail(cfg, { to: email, workspaceName: ws.name, link: inviteLink })
        emailed = true
      } catch (e) {
        console.error('Invite email failed:', e.message)
      }
    }
  }

  res.json({
    member: { userId: target.id, email, name: target.name || email, role, status: target.status },
    inviteLink,
    emailed,
  })
})

// Remove a member. Can't remove yourself or the last owner.
app.delete('/api/workspaces/:id/members/:userId', (req, res) => {
  const user = requirePermission(req, res, req.params.id, 'members.manage')
  if (!user) return
  if (req.params.userId === user.id) return res.status(400).json({ error: "You can't remove yourself." })
  const role = memberRole(req.params.id, req.params.userId)
  if (!role) return res.status(404).json({ error: 'Member not found' })
  if (isOwnerRole(role) && countOwners(req.params.id) <= 1) {
    return res.status(400).json({ error: 'The workspace needs at least one owner.' })
  }
  // Drops the membership plus everything it granted (team seats, individual
  // connection grants).
  removeWorkspaceMember(req.params.id, req.params.userId)
  // Clean up a pending user that no longer belongs to any workspace.
  const left = meta.prepare('SELECT COUNT(*) c FROM workspace_members WHERE user_id = ?').get(req.params.userId).c
  const u = meta.prepare('SELECT status FROM users WHERE id = ?').get(req.params.userId)
  if (left === 0 && u?.status === 'pending') meta.prepare('DELETE FROM users WHERE id = ?').run(req.params.userId)
  res.json({ ok: true })
})

// ============================================================================
// Teams (workspace-scoped groups of members)
// ============================================================================

// List a workspace's teams with member counts (any member can view).
app.get('/api/workspaces/:id/teams', (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  if (!memberRole(req.params.id, user.id)) return res.status(403).json({ error: 'Forbidden' })
  const rows = meta
    .prepare(
      `SELECT t.id, t.name, t.created_at,
              (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = t.id) AS memberCount
       FROM teams t WHERE t.workspace_id = ? ORDER BY t.created_at`
    )
    .all(req.params.id)
  res.json(rows.map((r) => ({ id: r.id, name: r.name, memberCount: r.memberCount, createdAt: r.created_at })))
})

// Create a team.
app.post('/api/workspaces/:id/teams', (req, res) => {
  const user = requirePermission(req, res, req.params.id, 'teams.manage')
  if (!user) return
  const name = (req.body?.name || '').trim()
  if (!name) return res.status(400).json({ error: 'Team name is required.' })
  const id = randomUUID()
  const now = Date.now()
  meta.prepare('INSERT INTO teams (id, workspace_id, name, created_at) VALUES (?, ?, ?, ?)').run(id, req.params.id, name, now)
  res.json({ id, name, memberCount: 0, createdAt: now })
})

// Rename a team.
app.put('/api/workspaces/:id/teams/:teamId', (req, res) => {
  const user = requirePermission(req, res, req.params.id, 'teams.manage')
  if (!user) return
  const team = meta.prepare('SELECT id FROM teams WHERE id = ? AND workspace_id = ?').get(req.params.teamId, req.params.id)
  if (!team) return res.status(404).json({ error: 'Team not found' })
  const name = (req.body?.name || '').trim()
  if (!name) return res.status(400).json({ error: 'Team name is required.' })
  meta.prepare('UPDATE teams SET name = ? WHERE id = ?').run(name, req.params.teamId)
  res.json({ ok: true })
})

// Delete a team — cascades its members and any connection assignments.
app.delete('/api/workspaces/:id/teams/:teamId', (req, res) => {
  const user = requirePermission(req, res, req.params.id, 'teams.manage')
  if (!user) return
  const team = meta.prepare('SELECT id FROM teams WHERE id = ? AND workspace_id = ?').get(req.params.teamId, req.params.id)
  if (!team) return res.status(404).json({ error: 'Team not found' })
  meta.prepare('DELETE FROM team_members WHERE team_id = ?').run(req.params.teamId)
  meta.prepare("DELETE FROM connection_access WHERE principal_type = 'team' AND principal_id = ?").run(req.params.teamId)
  meta.prepare('DELETE FROM teams WHERE id = ?').run(req.params.teamId)
  res.json({ ok: true })
})

// List a team's members (any workspace member can view).
app.get('/api/workspaces/:id/teams/:teamId/members', (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  if (!memberRole(req.params.id, user.id)) return res.status(403).json({ error: 'Forbidden' })
  const team = meta.prepare('SELECT id FROM teams WHERE id = ? AND workspace_id = ?').get(req.params.teamId, req.params.id)
  if (!team) return res.status(404).json({ error: 'Team not found' })
  const rows = meta
    .prepare(
      `SELECT u.id AS userId, u.username AS email, u.name
       FROM team_members tm JOIN users u ON u.id = tm.user_id
       WHERE tm.team_id = ? ORDER BY tm.created_at`
    )
    .all(req.params.teamId)
  res.json(rows)
})

// Add a member to a team. The user must belong to the workspace.
app.post('/api/workspaces/:id/teams/:teamId/members', (req, res) => {
  const user = requirePermission(req, res, req.params.id, 'teams.manage')
  if (!user) return
  const team = meta.prepare('SELECT id FROM teams WHERE id = ? AND workspace_id = ?').get(req.params.teamId, req.params.id)
  if (!team) return res.status(404).json({ error: 'Team not found' })
  const userId = req.body?.userId
  if (!userId) return res.status(400).json({ error: 'userId is required.' })
  if (!memberRole(req.params.id, userId)) return res.status(400).json({ error: 'That person is not a workspace member.' })
  meta
    .prepare('INSERT OR IGNORE INTO team_members (id, team_id, user_id, created_at) VALUES (?, ?, ?, ?)')
    .run(randomUUID(), req.params.teamId, userId, Date.now())
  res.json({ ok: true })
})

// Remove a member from a team.
app.delete('/api/workspaces/:id/teams/:teamId/members/:userId', (req, res) => {
  const user = requirePermission(req, res, req.params.id, 'teams.manage')
  if (!user) return
  const team = meta.prepare('SELECT id FROM teams WHERE id = ? AND workspace_id = ?').get(req.params.teamId, req.params.id)
  if (!team) return res.status(404).json({ error: 'Team not found' })
  meta.prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?').run(req.params.teamId, req.params.userId)
  res.json({ ok: true })
})

// ============================================================================
// Connections (scoped to a workspace the caller belongs to)
// ============================================================================

// List connections for a workspace.
app.get('/api/connections', (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  const workspaceId = req.query.workspace
  if (!workspaceId) return res.json([])
  if (!memberRole(workspaceId, user.id)) return res.status(403).json({ error: 'Forbidden' })
  res.json(listConnections().filter((c) => c.workspaceId === workspaceId && userCanAccessConnection(c, user.id)))
})

// Probe an unsaved connection form.
app.post('/api/test-connection', async (req, res) => {
  try {
    res.json(await db.testConnection(req.body))
  } catch (error) {
    res.status(error.status || 200).json({ ok: false, message: error.message })
  }
})

// Add a connection to a workspace. Defining one is `connections.create`: the
// credentials it carries are the workspace's, not something anyone who can use a
// database gets to point somewhere else.
app.post('/api/connections', (req, res) => {
  const workspaceId = req.body.workspaceId
  if (!workspaceId) return res.status(403).json({ error: 'Forbidden' })
  const user = requirePermission(req, res, workspaceId, 'connections.create')
  if (!user) return
  // Default the owner to the creating user (unless one was explicitly provided).
  const conn = { ...req.body, id: randomUUID(), workspaceId, ownerId: req.body.ownerId || user.id }
  saveConnection(conn)
  res.json(getConnection(conn.id))
})

// Import an export document as a brand-new connection in `workspaceId`.
// Mounted above the `/api/connections/:id` guard so "import" isn't read as an id.
app.post('/api/connections/import', (req, res) => {
  const { workspaceId, document, name, settings } = req.body || {}
  if (!workspaceId) return res.status(403).json({ error: 'Forbidden' })
  const user = requirePermission(req, res, workspaceId, 'connections.create')
  if (!user) return
  try {
    res.json(importConnectionDoc(document, { workspaceId, ownerId: user.id, name, settings }))
  } catch (error) {
    fail(res, error)
  }
})

// ---- Storage destinations (S3-compatible, workspace-scoped) ----
app.get('/api/storages', (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  const workspaceId = req.query.workspace
  if (!workspaceId) return res.json([])
  if (!memberRole(workspaceId, user.id)) return res.status(403).json({ error: 'Forbidden' })
  res.json(listStorageRows(workspaceId))
})

// Create a storage destination — it holds credentials for somewhere the
// workspace's data gets written, so it carries its own permission.
app.post('/api/storages', (req, res) => {
  const body = req.body || {}
  if (!body.workspaceId) return res.status(403).json({ error: 'Forbidden' })
  const user = requirePermission(req, res, body.workspaceId, 'storage.manage')
  if (!user) return
  if (!body.name?.trim() || !body.bucket?.trim()) return res.status(400).json({ error: 'A name and bucket are required' })
  res.json(createStorage(body.workspaceId, body))
})

// Guard every per-storage route: reading needs membership, changing needs
// `storage.manage`.
app.use('/api/storages/:sid', (req, res, next) => {
  const user = requireAuth(req, res)
  if (!user) return
  const dest = getStorage(req.params.sid)
  if (!dest) return res.status(404).json({ error: 'Storage destination not found' })
  if (!memberRole(dest.workspaceId, user.id)) return res.status(403).json({ error: 'Forbidden' })
  if (req.method !== 'GET' && !requirePermission(req, res, dest.workspaceId, 'storage.manage')) return
  next()
})

app.put('/api/storages/:sid', (req, res) => {
  const merged = { ...getStorage(req.params.sid), ...(req.body || {}) }
  if (!merged.name?.trim() || !merged.bucket?.trim()) return res.status(400).json({ error: 'A name and bucket are required' })
  res.json(updateStorage(req.params.sid, merged))
})

app.delete('/api/storages/:sid', (req, res) => {
  if (isStorageInUse(req.params.sid)) {
    return res.status(409).json({ error: 'This storage destination is used by a workflow and cannot be deleted.' })
  }
  deleteStorage(req.params.sid)
  res.json({ ok: true })
})

app.post('/api/storages/:sid/test', async (req, res) => {
  res.json(await testStorage(getStorage(req.params.sid)))
})

// Guard every per-connection route: caller must be able to access the
// connection. One mount covers PUT/DELETE /:id and all /:id/* data routes.
app.use('/api/connections/:id', (req, res, next) => {
  const user = requireAuth(req, res)
  if (!user) return
  const conn = getConnection(req.params.id)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })
  if (conn.workspaceId && !userCanAccessConnection(conn, user.id)) return res.status(403).json({ error: 'Forbidden' })
  next()
})

/**
 * Editing the *connection record* — its credentials, target host, access list —
 * versus using the database behind it. This guard sits on the handful of routes
 * that change the record; every /:id/* data route stays open to whoever the
 * access list grants (CLAUDE.md "AUTH MODEL").
 *
 * Two ways to pass, which is the point of `connections.owner_id`: hold
 * `connections.manage` and you may change any connection in the workspace; own
 * this one and you may change it whatever your role. That is what lets a plain
 * member run their own connection — its backups, its access list — without being
 * given the whole workspace.
 */
const requireConnectionOwner = (req, res, what = 'change a connection') => {
  const conn = getConnection(req.params.id)
  if (!conn) {
    res.status(404).json({ error: 'Connection not found' })
    return null
  }
  const userId = authUser(req).id
  if (conn.workspaceId && conn.ownerId !== userId && !can(conn.workspaceId, userId, 'connections.manage')) {
    res.status(403).json({ error: `You need to own this connection to ${what}.` })
    return null
  }
  return conn
}

// Update connection (owner).
app.put('/api/connections/:id', async (req, res) => {
  if (!requireConnectionOwner(req, res)) return
  const existing = getConnection(req.params.id)
  if (!existing) return res.status(404).json({ error: 'Connection not found' })
  const updated = { ...existing, ...req.body, id: req.params.id }
  saveConnection(updated)

  // Drop any cached pool/handle so the next query reconnects with the new
  // config (otherwise edits to host/credentials/database are ignored), and end
  // the sessions that were using those handles — they describe connections that
  // no longer exist.
  db.releaseConnection(existing)
  db.releaseConnection(updated)
  await endAllConnectionSessions(req.params.id)

  res.json(updated)
})

// Delete connection (owner).
app.delete('/api/connections/:id', async (req, res) => {
  const conn = requireConnectionOwner(req, res)
  if (!conn) return

  db.releaseConnection(conn)
  await endAllConnectionSessions(req.params.id)

  deleteConnectionRow(req.params.id)
  meta.prepare('DELETE FROM saved_queries WHERE connection_id = ?').run(req.params.id)
  meta.prepare('DELETE FROM folders WHERE connection_id = ?').run(req.params.id)
  meta.prepare('DELETE FROM connection_tables WHERE connection_id = ?').run(req.params.id)
  meta.prepare('DELETE FROM workflows WHERE connection_id = ?').run(req.params.id)
  meta.prepare('DELETE FROM workflow_runs WHERE connection_id = ?').run(req.params.id)
  meta.prepare('DELETE FROM dashboards WHERE connection_id = ?').run(req.params.id)
  meta.prepare('DELETE FROM query_history WHERE connection_id = ?').run(req.params.id)
  meta.prepare('DELETE FROM connection_access WHERE connection_id = ?').run(req.params.id)
  res.json({ ok: true })
})

// Export this connection as one portable JSON document (see
// server/connection-transfer.js for what's in it). `?secrets=1` keeps the stored
// password — off by default, since the file usually leaves the instance.
// Owner-only: the document is the connection's definition, secrets aside.
app.get('/api/connections/:id/export', (req, res) => {
  if (!requireConnectionOwner(req, res, 'export a connection')) return
  const includeSecrets = ['1', 'true', 'yes'].includes(String(req.query.secrets || '').toLowerCase())
  const doc = buildConnectionExport(req.params.id, { includeSecrets })
  if (!doc) return res.status(404).json({ error: 'Connection not found' })
  res.json(doc)
})

/**
 * Hand a connection to someone else in the workspace.
 *
 * Its own permission rather than part of `connections.manage`, because it is the
 * one change that can take a connection *away* from the caller: an owner moving
 * a connection to a member gives that member full control of the record and
 * keeps none for themselves unless their role says otherwise.
 *
 * The new owner must already be a member — ownership is not a way to grant
 * workspace access — and an instance admin can never hold it, for the same
 * reason they hold no membership.
 */
app.put('/api/connections/:id/owner', (req, res) => {
  const conn = getConnection(req.params.id)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })
  if (!conn.workspaceId) return res.status(400).json({ error: 'This connection does not belong to a workspace.' })
  if (!requirePermission(req, res, conn.workspaceId, 'connections.transfer')) return

  const ownerId = req.body?.ownerId
  if (!ownerId) return res.status(400).json({ error: 'ownerId is required.' })
  if (!memberRole(conn.workspaceId, ownerId)) return res.status(400).json({ error: 'That person is not a member of this workspace.' })
  if (isSystemAdmin(userRow(ownerId))) return res.status(400).json({ error: 'An instance admin cannot own a connection.' })

  saveConnection({ ...conn, ownerId })
  res.json(getConnection(req.params.id))
})

// ---- Connection access (which teams/members may see this connection) ----
// Any user who passes the access guard can read the assignment; only a
// workspace owner can change it.
app.get('/api/connections/:id/access', (req, res) => {
  res.json(connectionAccess(req.params.id))
})

app.put('/api/connections/:id/access', (req, res) => {
  if (!requireConnectionOwner(req, res, "change a connection's access list")) return
  const teams = Array.isArray(req.body?.teams) ? req.body.teams : []
  const users = Array.isArray(req.body?.users) ? req.body.users : []
  setConnectionAccess(req.params.id, { teams, users })
  res.json(connectionAccess(req.params.id))
})

// ============================================================================
// Saved queries + folders (per connection)
// ============================================================================

app.get('/api/connections/:id/saved', (req, res) => {
  const rows = meta
    .prepare('SELECT id, name, sql, kind, folder_id, ts FROM saved_queries WHERE connection_id = ? ORDER BY ts DESC')
    .all(req.params.id)
  res.json(rows.map((r) => ({ ...r, kind: r.kind || 'query', folderId: r.folder_id || null })))
})

app.get('/api/connections/:id/folders', (req, res) => {
  const type = folderTypeOf(req.query.type)
  const rows = meta
    .prepare('SELECT id, name, color, parent_id, ts FROM folders WHERE connection_id = ? AND type = ? ORDER BY ts ASC')
    .all(req.params.id, type)
  res.json(rows.map((r) => folderRow(req.params.id, type, r)))
})

app.post('/api/connections/:id/folders', (req, res) => {
  const { name, parentId, color } = req.body || {}
  const type = folderTypeOf(req.body?.type)
  if (!name?.trim()) return res.status(400).json({ error: 'A folder name is required' })
  if (parentId) {
    const parent = meta
      .prepare('SELECT id FROM folders WHERE id = ? AND connection_id = ? AND type = ?')
      .get(parentId, req.params.id, type)
    if (!parent) return res.status(400).json({ error: 'Parent folder not found' })
    if (folderDepth(req.params.id, type, parentId) >= FOLDER_TYPES[type].maxDepth)
      return res.status(400).json({ error: `Folders can only nest ${FOLDER_TYPES[type].maxDepth} levels deep` })
  }
  const entry = {
    id: randomUUID(),
    name: name.trim(),
    color: color || null,
    parentId: parentId || null,
    type,
    ts: Date.now(),
  }
  meta
    .prepare('INSERT INTO folders (id, connection_id, type, name, color, parent_id, ts) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(entry.id, req.params.id, entry.type, entry.name, entry.color, entry.parentId, entry.ts)
  res.json(type === 'table' ? { ...entry, tables: [] } : entry)
})

app.put('/api/connections/:id/folders/:fid', (req, res) => {
  const body = req.body || {}
  const folder = meta
    .prepare('SELECT type FROM folders WHERE id = ? AND connection_id = ?')
    .get(req.params.fid, req.params.id)
  if (!folder) return res.status(404).json({ error: 'Not found' })
  const type = folderTypeOf(folder.type)
  const { name } = body
  const sets = []
  const vals = []
  if (name != null) {
    if (!name.trim()) return res.status(400).json({ error: 'A folder name is required' })
    sets.push('name = ?')
    vals.push(name.trim())
  }
  // color is explicitly settable (null clears it back to the default look).
  if ('color' in body) {
    sets.push('color = ?')
    vals.push(body.color || null)
  }
  // parentId is explicitly settable (null moves the folder to the root).
  if ('parentId' in body) {
    const parentId = body.parentId || null
    if (parentId) {
      if (parentId === req.params.fid) return res.status(400).json({ error: "A folder can't be its own parent" })
      const parent = meta
        .prepare('SELECT id FROM folders WHERE id = ? AND connection_id = ? AND type = ?')
        .get(parentId, req.params.id, type)
      if (!parent) return res.status(400).json({ error: 'Parent folder not found' })
      if (folderHasAncestor(req.params.id, type, parentId, req.params.fid))
        return res.status(400).json({ error: "Can't move a folder into its own subfolder" })
      // The moved subtree's deepest leaf must still fit within the depth cap.
      const newDepth = folderDepth(req.params.id, type, parentId) + folderHeight(req.params.id, type, req.params.fid)
      if (newDepth > FOLDER_TYPES[type].maxDepth)
        return res.status(400).json({ error: `Folders can only nest ${FOLDER_TYPES[type].maxDepth} levels deep` })
    }
    sets.push('parent_id = ?')
    vals.push(parentId)
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' })
  const r = meta
    .prepare(`UPDATE folders SET ${sets.join(', ')} WHERE id = ? AND connection_id = ?`)
    .run(...vals, req.params.fid, req.params.id)
  if (!r.changes) return res.status(404).json({ error: 'Not found' })
  res.json({ ok: true })
})

app.delete('/api/connections/:id/folders/:fid', (req, res) => {
  // Reparent the folder's contents up one level (to its own parent) rather than
  // deleting them: child folders and items move to the deleted folder's parent.
  const row = meta
    .prepare('SELECT type, parent_id FROM folders WHERE id = ? AND connection_id = ?')
    .get(req.params.fid, req.params.id)
  const type = folderTypeOf(row?.type)
  const parentId = row?.parent_id || null
  meta
    .prepare('UPDATE folders SET parent_id = ? WHERE parent_id = ? AND connection_id = ?')
    .run(parentId, req.params.fid, req.params.id)
  // itemTable comes from the FOLDER_TYPES allowlist (via folderTypeOf) — safe to interpolate.
  meta
    .prepare(`UPDATE ${FOLDER_TYPES[type].itemTable} SET folder_id = ? WHERE folder_id = ? AND connection_id = ?`)
    .run(parentId, req.params.fid, req.params.id)
  // A connection_tables row only records membership, so "moved to the root" means
  // ungrouped — drop the row rather than leaving a folder-less mapping behind.
  if (type === 'table' && !parentId)
    meta.prepare('DELETE FROM connection_tables WHERE folder_id IS NULL AND connection_id = ?').run(req.params.id)
  meta.prepare('DELETE FROM folders WHERE id = ? AND connection_id = ?').run(req.params.fid, req.params.id)
  res.json({ ok: true })
})

// Set (or clear) a table's folder. `folderId: null` ungroups the table;
// otherwise it's reassigned to that single folder (upsert — one folder per
// table). Table names are plain strings, so this works for any dialect.
app.put('/api/connections/:id/tables/:table/folder', (req, res) => {
  const folderId = req.body?.folderId ?? null
  const table = req.params.table
  if (folderId === null) {
    meta.prepare('DELETE FROM connection_tables WHERE connection_id = ? AND table_name = ?').run(req.params.id, table)
    return res.json({ ok: true })
  }
  const folder = meta
    .prepare("SELECT id FROM folders WHERE id = ? AND connection_id = ? AND type = 'table'")
    .get(folderId, req.params.id)
  if (!folder) return res.status(404).json({ error: 'Folder not found' })
  meta
    .prepare(
      `INSERT INTO connection_tables (id, connection_id, table_name, folder_id, ts) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(connection_id, table_name) DO UPDATE SET folder_id = excluded.folder_id, ts = excluded.ts`
    )
    .run(randomUUID(), req.params.id, table, folderId, Date.now())
  res.json({ ok: true })
})

app.post('/api/connections/:id/saved', (req, res) => {
  const { name, sql, kind } = req.body || {}
  if (!name?.trim() || !sql?.trim()) return res.status(400).json({ error: 'A name and SQL are required' })
  const entry = { id: randomUUID(), name: name.trim(), sql: sql.trim(), kind: kind || 'query', ts: Date.now() }
  meta
    .prepare('INSERT INTO saved_queries (id, connection_id, name, sql, kind, ts) VALUES (?, ?, ?, ?, ?, ?)')
    .run(entry.id, req.params.id, entry.name, entry.sql, entry.kind, entry.ts)
  res.json(entry)
})

app.put('/api/connections/:id/saved/:sid', (req, res) => {
  const body = req.body || {}
  const { name, sql } = body
  const sets = []
  const vals = []
  if (name != null) {
    if (!name.trim()) return res.status(400).json({ error: 'A name is required' })
    sets.push('name = ?')
    vals.push(name.trim())
  }
  if (sql != null) {
    if (!sql.trim()) return res.status(400).json({ error: 'SQL is required' })
    sets.push('sql = ?')
    vals.push(sql.trim())
  }
  // folderId is explicitly settable (null moves the query back to the root).
  if ('folderId' in body) {
    sets.push('folder_id = ?')
    vals.push(body.folderId || null)
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' })
  const r = meta
    .prepare(`UPDATE saved_queries SET ${sets.join(', ')} WHERE id = ? AND connection_id = ?`)
    .run(...vals, req.params.sid, req.params.id)
  if (!r.changes) return res.status(404).json({ error: 'Not found' })
  res.json({ ok: true })
})

app.delete('/api/connections/:id/saved/:sid', (req, res) => {
  meta.prepare('DELETE FROM saved_queries WHERE id = ? AND connection_id = ?').run(req.params.sid, req.params.id)
  res.json({ ok: true })
})

// ============================================================================
// Workflows (per connection)
// ============================================================================
// A workflow can be marked `protected` (undeletable) — `DELETE` 409s on it,
// everything else behaves like a normal workflow. Nothing currently sets this
// automatically (backups are a separate system — see the Backup section below).

app.get('/api/connections/:id/workflows', (req, res) => {
  const rows = meta
    .prepare('SELECT id, name, ts, protected, schedule_enabled, folder_id FROM workflows WHERE connection_id = ? ORDER BY ts DESC')
    .all(req.params.id)
  res.json(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      ts: r.ts,
      protected: !!r.protected,
      scheduleEnabled: !!r.schedule_enabled,
      folderId: r.folder_id || null,
    }))
  )
})

app.post('/api/connections/:id/workflows', (req, res) => {
  const { name, graph, folderId } = req.body || {}
  if (!name?.trim()) return res.status(400).json({ error: 'A workflow name is required' })
  const entry = {
    id: randomUUID(),
    name: name.trim(),
    graph: graph && typeof graph === 'object' ? graph : { nodes: [], edges: [] },
    folderId: folderId || null,
    ts: Date.now(),
  }
  meta
    .prepare('INSERT INTO workflows (id, connection_id, name, graph, folder_id, ts) VALUES (?, ?, ?, ?, ?, ?)')
    .run(entry.id, req.params.id, entry.name, JSON.stringify(entry.graph), entry.folderId, entry.ts)
  res.json({ ...entry, protected: false, scheduleEnabled: false })
})

app.get('/api/connections/:id/workflows/:wid', (req, res) => {
  const row = meta
    .prepare('SELECT id, name, graph, protected, schedule_enabled FROM workflows WHERE id = ? AND connection_id = ?')
    .get(req.params.wid, req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  res.json({
    id: row.id,
    name: row.name,
    graph: safeJson(row.graph),
    protected: !!row.protected,
    scheduleEnabled: !!row.schedule_enabled,
  })
})

app.put('/api/connections/:id/workflows/:wid', (req, res) => {
  const body = req.body || {}
  const existing = meta.prepare('SELECT graph, schedule_enabled FROM workflows WHERE id = ? AND connection_id = ?').get(req.params.wid, req.params.id)
  if (!existing) return res.status(404).json({ error: 'Not found' })
  const sets = []
  const vals = []
  if (body.name != null) {
    if (!body.name.trim()) return res.status(400).json({ error: 'A name is required' })
    sets.push('name = ?')
    vals.push(body.name.trim())
  }
  if (body.graph != null) {
    sets.push('graph = ?')
    vals.push(JSON.stringify(body.graph))
  }
  if (body.scheduleEnabled != null) {
    sets.push('schedule_enabled = ?')
    vals.push(body.scheduleEnabled ? 1 : 0)
  }
  // folderId is explicitly settable (null moves the workflow back to the root).
  if ('folderId' in body) {
    sets.push('folder_id = ?')
    vals.push(body.folderId || null)
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' })
  // Recompute next_run_at whenever the graph or the enabled flag changes —
  // whichever the request just posted wins over what's already stored.
  if (body.graph != null || body.scheduleEnabled != null) {
    const graph = body.graph != null ? body.graph : safeJson(existing.graph)
    const enabled = body.scheduleEnabled != null ? !!body.scheduleEnabled : !!existing.schedule_enabled
    sets.push('next_run_at = ?')
    vals.push(nextRunForGraph(graph, enabled))
  }
  const r = meta
    .prepare(`UPDATE workflows SET ${sets.join(', ')} WHERE id = ? AND connection_id = ?`)
    .run(...vals, req.params.wid, req.params.id)
  if (!r.changes) return res.status(404).json({ error: 'Not found' })
  res.json({ ok: true })
})

app.delete('/api/connections/:id/workflows/:wid', (req, res) => {
  const row = meta.prepare('SELECT protected FROM workflows WHERE id = ? AND connection_id = ?').get(req.params.wid, req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  if (row.protected) return res.status(409).json({ error: 'This workflow is protected and cannot be deleted.' })
  meta.prepare('DELETE FROM workflows WHERE id = ? AND connection_id = ?').run(req.params.wid, req.params.id)
  res.json({ ok: true })
})

// Run a workflow — executes the posted graph (unsaved edits) or the stored
// one, and records the outcome in workflow_runs.
app.post('/api/connections/:id/workflows/:wid/run', async (req, res) => {
  const conn = getConnection(req.params.id)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })
  let graph = req.body?.graph
  if (!graph) {
    const row = meta.prepare('SELECT graph FROM workflows WHERE id = ? AND connection_id = ?').get(req.params.wid, req.params.id)
    if (!row) return res.status(404).json({ error: 'Not found' })
    graph = safeJson(row.graph)
  }
  // `trigger` distinguishes dashboard row-action runs in the workflow_runs
  // audit trail; anything unrecognized falls back to 'manual'.
  const trigger = req.body?.trigger === 'dashboard' ? 'dashboard' : 'manual'
  const result = await executeAndRecord(req.params.wid, req.params.id, conn, graph, trigger, req.body?.input ?? null)
  res.json(result)
})

// ---- Workflow run history (the "Activity" trail) ----
// Every run (manual, dashboard, schedule, webhook) is persisted to workflow_runs
// by executeAndRecord; these expose that trail. The list omits the (potentially
// large) per-node log; fetch a single run to drill into it.
app.get('/api/connections/:id/workflows/:wid/runs', (req, res) => {
  const wf = meta.prepare('SELECT id FROM workflows WHERE id = ? AND connection_id = ?').get(req.params.wid, req.params.id)
  if (!wf) return res.status(404).json({ error: 'Not found' })
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200)
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0)
  const rows = meta
    .prepare(
      `SELECT id, trigger_kind, status, error, started_at, finished_at
       FROM workflow_runs WHERE workflow_id = ? ORDER BY started_at DESC LIMIT ? OFFSET ?`
    )
    .all(req.params.wid, limit, offset)
  res.json(
    rows.map((r) => ({
      id: r.id,
      triggerKind: r.trigger_kind,
      status: r.status,
      error: r.error || null,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      ms: r.finished_at && r.started_at ? r.finished_at - r.started_at : null,
    }))
  )
})

app.get('/api/connections/:id/workflows/:wid/runs/:runId', (req, res) => {
  const row = meta
    .prepare(
      `SELECT id, trigger_kind, status, log, error, started_at, finished_at
       FROM workflow_runs WHERE id = ? AND workflow_id = ? AND connection_id = ?`
    )
    .get(req.params.runId, req.params.wid, req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  res.json({
    id: row.id,
    triggerKind: row.trigger_kind,
    status: row.status,
    ok: row.status === 'success',
    log: safeJson(row.log) || [],
    error: row.error || null,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    ms: row.finished_at && row.started_at ? row.finished_at - row.started_at : null,
  })
})

// ---- Public webhook trigger (unauthenticated, token-guarded) ----
// The ONE workflow surface reachable without a session: an inbound HTTP call
// fires a workflow whose trigger is a `webhook` node, with the request body as
// the trigger input. Deliberately mounted OUTSIDE `/api/connections/:id` (whose
// middleware requires auth+membership) — a per-webhook opaque token is the only
// gate, so keep it secret. The SSRF/`vm` caveat in server/workflow.js still
// applies: the run executes with the same trust as any member-authored workflow.
app.all('/api/hooks/wf/:wid/:token', async (req, res) => {
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).json({ error: 'Use GET or POST' })
  const row = meta.prepare('SELECT id, connection_id, graph FROM workflows WHERE id = ?').get(req.params.wid)
  if (!row) return res.status(404).json({ error: 'Not found' })
  const graph = safeJson(row.graph)
  const hook = (graph?.nodes || []).find((n) => n.type === 'webhook')
  if (!hook) return res.status(404).json({ error: 'This workflow has no webhook trigger' })
  const expected = String(hook.data?.token || '')
  const provided = String(req.params.token || '')
  const ok =
    expected.length > 0 &&
    expected.length === provided.length &&
    timingSafeEqual(Buffer.from(expected), Buffer.from(provided))
  if (!ok) return res.status(401).json({ error: 'Invalid webhook token' })
  const conn = getConnection(row.connection_id)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })
  // The request body seeds the trigger; query params are exposed too so simple
  // GET pings can pass data without a body.
  const input = { body: req.body ?? null, query: req.query || {}, headers: req.headers, method: req.method }
  const result = await executeAndRecord(row.id, row.connection_id, conn, graph, 'webhook', input)
  res.status(result.ok ? 200 : 500).json({ ok: result.ok, output: result.output, error: result.error || null })
})

// ============================================================================
// Dashboards (per connection)
// ============================================================================
// A dashboard is a name + one JSON config: { variables: [...], widgets: [...] }.
// The config shape is owned by the frontend (src/features/dashboard/types.ts);
// the server just stores and returns it, so it stays database-agnostic.
// Dashboards can live in a folder (folders table, type='dashboard').

app.get('/api/connections/:id/dashboards', (req, res) => {
  const rows = meta
    .prepare('SELECT id, name, folder_id, ts FROM dashboards WHERE connection_id = ? ORDER BY ts DESC')
    .all(req.params.id)
  res.json(rows.map((r) => ({ id: r.id, name: r.name, folderId: r.folder_id || null, ts: r.ts })))
})

app.post('/api/connections/:id/dashboards', (req, res) => {
  const { name, config, folderId } = req.body || {}
  if (!name?.trim()) return res.status(400).json({ error: 'A dashboard name is required' })
  if (folderId) {
    const parent = meta
      .prepare("SELECT id FROM folders WHERE id = ? AND connection_id = ? AND type = 'dashboard'")
      .get(folderId, req.params.id)
    if (!parent) return res.status(400).json({ error: 'Folder not found' })
  }
  const entry = {
    id: randomUUID(),
    name: name.trim(),
    config: config && typeof config === 'object' ? config : { variables: [], widgets: [] },
    folderId: folderId || null,
    ts: Date.now(),
  }
  meta
    .prepare('INSERT INTO dashboards (id, connection_id, name, config, folder_id, ts) VALUES (?, ?, ?, ?, ?, ?)')
    .run(entry.id, req.params.id, entry.name, JSON.stringify(entry.config), entry.folderId, entry.ts)
  res.json(entry)
})

app.get('/api/connections/:id/dashboards/:did', (req, res) => {
  const row = meta
    .prepare('SELECT id, name, config, ts FROM dashboards WHERE id = ? AND connection_id = ?')
    .get(req.params.did, req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  res.json({ id: row.id, name: row.name, ts: row.ts, config: safeJson(row.config) || { variables: [], widgets: [] } })
})

app.put('/api/connections/:id/dashboards/:did', (req, res) => {
  const body = req.body || {}
  const sets = []
  const vals = []
  if (body.name != null) {
    if (!body.name.trim()) return res.status(400).json({ error: 'A name is required' })
    sets.push('name = ?')
    vals.push(body.name.trim())
  }
  if (body.config != null) {
    if (typeof body.config !== 'object') return res.status(400).json({ error: 'config must be an object' })
    sets.push('config = ?')
    vals.push(JSON.stringify(body.config))
  }
  // folderId is explicitly settable (null moves the dashboard back to the root).
  if ('folderId' in body) {
    const folderId = body.folderId || null
    if (folderId) {
      const parent = meta
        .prepare("SELECT id FROM folders WHERE id = ? AND connection_id = ? AND type = 'dashboard'")
        .get(folderId, req.params.id)
      if (!parent) return res.status(400).json({ error: 'Folder not found' })
    }
    sets.push('folder_id = ?')
    vals.push(folderId)
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' })
  const r = meta
    .prepare(`UPDATE dashboards SET ${sets.join(', ')} WHERE id = ? AND connection_id = ?`)
    .run(...vals, req.params.did, req.params.id)
  if (!r.changes) return res.status(404).json({ error: 'Not found' })
  res.json({ ok: true })
})

app.delete('/api/connections/:id/dashboards/:did', (req, res) => {
  const r = meta.prepare('DELETE FROM dashboards WHERE id = ? AND connection_id = ?').run(req.params.did, req.params.id)
  if (!r.changes) return res.status(404).json({ error: 'Not found' })
  res.json({ ok: true })
})

// ============================================================================
// Backup (standalone system: own schedule + run history, independent of the
// generic workflow engine — see server/backup/)
// ============================================================================

// Current backup schedule for this connection (null if none has been created yet).
app.get('/api/connections/:id/backup/schedule', (req, res) => {
  res.json({ schedule: getBackupSchedule(req.params.id) })
})

app.post('/api/connections/:id/backup/schedule', (req, res) => {
  const conn = getConnection(req.params.id)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })
  // An engine with no dump can't be scheduled for backup.
  if (!db.supports(conn, 'dump')) {
    return res.status(400).json({ error: `Backups are not supported for connection type: ${conn.type}` })
  }
  if (getBackupScheduleRow(req.params.id)) return res.status(409).json({ error: 'This connection already has a backup schedule.' })
  const body = req.body || {}
  const err = validateScheduleBody(conn, body.destinationIds, body.frequency)
  if (err) return res.status(400).json({ error: err })
  res.json({ schedule: createSchedule(req.params.id, body) })
})

// Update any subset of the schedule's fields (also how Active/Paused toggles
// via a lightweight `{ enabled }` body).
app.put('/api/connections/:id/backup/schedule', (req, res) => {
  const conn = getConnection(req.params.id)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })
  const row = getBackupScheduleRow(req.params.id)
  if (!row) return res.status(404).json({ error: 'No backup schedule exists for this connection.' })
  const body = req.body || {}
  const err = validateScheduleBody(
    conn,
    body.destinationIds ?? safeJson(row.destination_ids) ?? [],
    body.frequency ?? row.frequency
  )
  if (err) return res.status(400).json({ error: err })
  res.json({ schedule: updateSchedule(row, body) })
})

// Run the connection's backup schedule immediately (no retry — same semantics
// as today's "Run now").
app.post('/api/connections/:id/backup/run', async (req, res) => {
  const conn = getConnection(req.params.id)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })
  const row = getBackupScheduleRow(req.params.id)
  if (!row) return res.status(404).json({ error: 'No backup schedule exists for this connection.' })
  res.json(await runBackupOnce(row, conn, 'manual'))
})

// Per-day run counts — feeds the GitHub-style calendar.
app.get('/api/connections/:id/backup/calendar', (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 365, 366)
  const from = Date.now() - days * 86400000
  const rows = meta
    .prepare(
      `SELECT date(started_at / 1000, 'unixepoch') AS day, COUNT(*) AS runs,
              SUM(status = 'success') AS success, SUM(status = 'failed') AS failed
       FROM backup_runs WHERE connection_id = ? AND started_at >= ? GROUP BY day ORDER BY day`
    )
    .all(req.params.id, from)
  res.json({ days: rows })
})

// Paginated backup runs, with the uploaded-artifact info the version list
// needs. Optional `date=YYYY-MM-DD` filters to one day (heatmap click).
app.get('/api/connections/:id/backup/runs', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 200)
  const offset = Math.max(0, parseInt(req.query.offset) || 0)
  let where = 'connection_id = ?'
  const params = [req.params.id]
  if (req.query.date) {
    where += ` AND date(started_at / 1000, 'unixepoch') = ?`
    params.push(req.query.date)
  }
  const total = meta.prepare(`SELECT COUNT(*) AS c FROM backup_runs WHERE ${where}`).get(...params).c
  const rows = meta
    .prepare(`SELECT id, trigger_kind, status, error, started_at, finished_at, uploads FROM backup_runs WHERE ${where} ORDER BY started_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset)
  res.json({
    total,
    runs: rows.map((r) => ({
      id: r.id,
      trigger: r.trigger_kind,
      status: r.status,
      error: r.error,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      uploads: safeJson(r.uploads) || [],
    })),
  })
})

// One recorded run plus the upload entry for a destination — the shared lookup
// behind download / delete / restore.
const findRunUpload = (connectionId, runId, destinationId) => {
  const run = meta.prepare('SELECT * FROM backup_runs WHERE id = ? AND connection_id = ?').get(runId, connectionId)
  if (!run) return { run: null, uploads: [], upload: null }
  const uploads = safeJson(run.uploads) || []
  return { run, uploads, upload: uploads.find((u) => u.destinationId === destinationId && u.ok && !u.deleted) || null }
}

// Delete a specific uploaded backup artifact from storage. Irreversible —
// marks it `deleted` in the run's history rather than removing the row, so
// the date/status stays visible but Restore/Download disappear.
app.delete('/api/connections/:id/backup/runs/:runId/uploads/:destinationId', async (req, res) => {
  const { run, uploads, upload } = findRunUpload(req.params.id, req.params.runId, req.params.destinationId)
  if (!run) return res.status(404).json({ error: 'Backup run not found' })
  if (!upload?.key) return res.status(404).json({ error: 'No deletable upload found for this destination' })
  const dest = getStorage(req.params.destinationId)
  if (!dest) return res.status(404).json({ error: 'Storage destination not found' })
  try {
    // The connection-config JSON (when the schedule ships one) belongs to the
    // same run — it goes with the dump rather than lingering as an orphan.
    await deleteStorageObjects(dest, [upload.key, ...(upload.configKey ? [upload.configKey] : [])])
  } catch (err) {
    return res.status(500).json({ error: describeError(err) })
  }
  const next = uploads.map((u) => (u.destinationId === req.params.destinationId ? { ...u, deleted: true } : u))
  meta.prepare('UPDATE backup_runs SET uploads = ? WHERE id = ?').run(JSON.stringify(next), run.id)
  res.json({ ok: true })
})

// Download a specific uploaded backup artifact (decrypted server-side first, if
// needed). `?artifact=config` fetches the connection JSON the run shipped
// alongside the dump (only present when the schedule has includeConfig on).
app.get('/api/connections/:id/backup/runs/:runId/uploads/:destinationId/download', async (req, res) => {
  const { run, upload } = findRunUpload(req.params.id, req.params.runId, req.params.destinationId)
  if (!run) return res.status(404).json({ error: 'Backup run not found' })
  const wantConfig = req.query.artifact === 'config'
  const objectKey = wantConfig ? upload?.configKey : upload?.key
  if (!objectKey) return res.status(404).json({ error: `No downloadable ${wantConfig ? 'configuration' : 'upload'} found for this destination` })
  const dest = getStorage(req.params.destinationId)
  if (!dest) return res.status(404).json({ error: 'Storage destination not found' })
  const conn = getConnection(req.params.id)

  try {
    const encrypted = wantConfig ? upload.configEncrypted : upload.encrypted
    const { filePath, cleanup } = await fetchArtifact(dest, objectKey, { encrypted })
    const ext = wantConfig ? 'connection.json' : conn?.type === 'postgresql' ? 'dump' : 'sqlite'
    const filename = `${sanitizeForKey(conn?.name)}-${new Date(run.started_at).toISOString().slice(0, 10)}.${ext}`
    res.download(filePath, filename, (err) => {
      cleanup()
      if (err && !res.headersSent) res.status(500).json({ error: describeError(err) })
    })
  } catch (err) {
    res.status(500).json({ error: describeError(err) })
  }
})

// Restore: download a past backup artifact and overwrite a connection's live
// data in place. Defaults to the source connection; `targetConnectionId` may
// point at any other connection in the same workspace of the same type.
// Gated by typing the *target* connection's name to confirm.
app.post('/api/connections/:id/backup/restore', async (req, res) => {
  const sourceConn = getConnection(req.params.id)
  if (!sourceConn) return res.status(404).json({ error: 'Connection not found' })
  const { runId, destinationId, confirmName, targetConnectionId } = req.body || {}
  const targetConn = targetConnectionId ? getConnection(targetConnectionId) : sourceConn
  if (!targetConn) return res.status(404).json({ error: 'Target connection not found' })
  if (targetConn.workspaceId !== sourceConn.workspaceId) return res.status(400).json({ error: 'Target connection must be in the same workspace' })
  if (targetConn.type !== sourceConn.type) return res.status(400).json({ error: 'Target connection must be the same database type' })
  if (!canRestore(targetConn)) return res.status(400).json({ error: `Restore not supported for connection type: ${targetConn.type}` })
  if (confirmName !== targetConn.name) return res.status(400).json({ error: "Confirmation text doesn't match the target connection's name." })

  const { run, upload } = findRunUpload(req.params.id, runId, destinationId)
  if (!run) return res.status(404).json({ error: 'Backup run not found' })
  if (!upload?.key) return res.status(400).json({ error: 'No successful upload found for this destination' })
  const dest = getStorage(destinationId)
  if (!dest) return res.status(404).json({ error: 'Storage destination not found' })

  try {
    await restoreFromStorage(targetConn, dest, upload.key, { encrypted: !!upload.encrypted })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ ok: false, error: describeError(err) })
  }
})

// ---- Restore from arbitrary sources (storage browse / file upload) ----
// Unlike the run-based restore above, these restore into connection `:id`
// itself (the route param is the target), gated by typing its name. Encrypted
// artifacts (*.enc, written by the schedule's Encrypt option) are decrypted
// server-side with this server's key.

// Browse a destination's stored files so the user can pick one to restore.
app.get('/api/connections/:id/restore/storage-objects', async (req, res) => {
  const conn = getConnection(req.params.id)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })
  const dest = storageForRestore(conn, req.query.destinationId)
  if (!dest) return res.status(404).json({ error: 'Storage destination not found' })
  try {
    res.json({ objects: await listStorageObjects(dest) })
  } catch (err) {
    res.status(500).json({ error: describeError(err) })
  }
})

// Restore from a picked storage object.
app.post('/api/connections/:id/restore/from-storage', async (req, res) => {
  const conn = getConnection(req.params.id)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })
  const { destinationId, key, confirmName } = req.body || {}
  if (!canRestore(conn)) return res.status(400).json({ error: `Restore not supported for connection type: ${conn.type}` })
  if (confirmName !== conn.name) return res.status(400).json({ error: "Confirmation text doesn't match the connection's name." })
  if (typeof key !== 'string' || !key) return res.status(400).json({ error: 'An object key is required' })
  const dest = storageForRestore(conn, destinationId)
  if (!dest) return res.status(404).json({ error: 'Storage destination not found' })

  try {
    await restoreFromStorage(conn, dest, key, { encrypted: key.endsWith('.enc') })
    res.json({ ok: true })
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: describeError(err) })
  }
})

// Restore from an uploaded backup file. The file streams straight from the
// request body (Content-Type: application/octet-stream, which express.json
// ignores) into a temp file — no multipart parser needed. `filename` and
// `confirmName` ride the query string.
const UPLOAD_RESTORE_MAX_BYTES = 2 * 1024 * 1024 * 1024 // 2 GB

app.post('/api/connections/:id/restore/upload', async (req, res) => {
  const conn = getConnection(req.params.id)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })
  if (!canRestore(conn)) return res.status(400).json({ error: `Restore not supported for connection type: ${conn.type}` })
  if (req.query.confirmName !== conn.name) return res.status(400).json({ error: "Confirmation text doesn't match the connection's name." })
  const declared = parseInt(req.headers['content-length'])
  if (declared > UPLOAD_RESTORE_MAX_BYTES) return res.status(413).json({ error: 'Upload exceeds the 2 GB restore limit' })

  const filename = String(req.query.filename || '')
  const tmpPath = path.join(BACKUP_TMP_DIR, `${randomUUID()}-upload`)
  try {
    let received = 0
    const counter = new Transform({
      transform(chunk, _enc, cb) {
        received += chunk.length
        cb(received > UPLOAD_RESTORE_MAX_BYTES ? new Error('Upload exceeds the 2 GB restore limit') : null, chunk)
      },
    })
    await pipeline(req, counter, fs.createWriteStream(tmpPath))
    if (received === 0) return res.status(400).json({ error: 'The uploaded file is empty' })
    await restoreFromFile(conn, tmpPath, { encrypted: filename.endsWith('.enc') })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ ok: false, error: describeError(err) })
  } finally {
    fs.rm(tmpPath, { force: true }, () => {})
  }
})

// ============================================================================
// Query history (per connection)
// ============================================================================

app.get('/api/connections/:id/history', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 500, 5000)
  const rows = meta
    .prepare(
      `SELECT id, table_name, query, status, latency, error, executor_id, executor_name, ts
       FROM query_history WHERE connection_id = ? ORDER BY ts DESC LIMIT ?`
    )
    .all(req.params.id, limit)
  res.json(
    rows.map((r) => ({
      id: r.id,
      table: r.table_name || null,
      query: r.query,
      status: r.status,
      latency: r.latency,
      error: r.error || null,
      executorId: r.executor_id || null,
      executorName: r.executor_name || r.executor_id || null,
      executedAt: r.ts,
    }))
  )
})

app.post('/api/connections/:id/history', (req, res) => {
  const { table, query, status, latency, error, executorId, executorName } = req.body || {}
  if (!query?.trim()) return res.status(400).json({ error: 'A query is required' })
  const entry = {
    id: randomUUID(),
    table: table?.trim() || null,
    query: query.trim(),
    status: status === 'failed' ? 'failed' : 'success',
    latency: Number.isFinite(latency) ? Math.round(latency) : null,
    error: error || null,
    executorId: executorId || null,
    executorName: executorName || null,
    executedAt: Date.now(),
  }
  meta
    .prepare(
      `INSERT INTO query_history
       (id, connection_id, table_name, query, status, latency, error, executor_id, executor_name, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      entry.id,
      req.params.id,
      entry.table,
      entry.query,
      entry.status,
      entry.latency,
      entry.error,
      entry.executorId,
      entry.executorName,
      entry.executedAt
    )
  res.json(entry)
})

app.delete('/api/connections/:id/history', (req, res) => {
  // With { ids: [...] } delete just those entries; otherwise clear everything.
  const ids = req.body?.ids
  if (Array.isArray(ids) && ids.length) {
    const del = meta.prepare('DELETE FROM query_history WHERE id = ? AND connection_id = ?')
    const tx = meta.transaction((list) => list.forEach((hid) => del.run(hid, req.params.id)))
    tx(ids)
  } else {
    meta.prepare('DELETE FROM query_history WHERE connection_id = ?').run(req.params.id)
  }
  res.json({ ok: true })
})

// ============================================================================
// Schema migrations (per connection)
// ============================================================================
// Records a DDL commit that has already been executed (via /query) — one row
// per successful commitChanges() batch, bumping the connection's schema
// version. Audit trail only; nothing here re-executes SQL.

app.post('/api/connections/:id/schema/migrations', (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  const statements = Array.isArray(req.body?.statements) ? req.body.statements : []
  if (!statements.length) return res.status(400).json({ error: 'At least one statement is required' })
  const version = bumpSchemaVersion(req.params.id)
  const entry = {
    id: randomUUID(),
    connectionId: req.params.id,
    version,
    forwardSql: statements.map((s) => s.sql),
    rollbackSql: statements.map((s) => s.rollbackSql || null),
    reversible: statements.every((s) => !!s.rollbackSql),
    executorId: user.id,
    executorName: user.name || user.username,
    ts: Date.now(),
  }
  meta
    .prepare(
      `INSERT INTO schema_migrations
       (id, connection_id, version, forward_sql, rollback_sql, reversible, status, executor_id, executor_name, ts)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`
    )
    .run(
      entry.id,
      entry.connectionId,
      entry.version,
      JSON.stringify(entry.forwardSql),
      JSON.stringify(entry.rollbackSql),
      entry.reversible ? 1 : 0,
      entry.executorId,
      entry.executorName,
      entry.ts
    )
  res.json({ version, migration: { ...entry, status: 'active' } })
})

// List a connection's schema migration history, newest first. `ORDER BY ts`
// (not version) so rolled-back rows that share a reused version number keep
// their real chronological order.
app.get('/api/connections/:id/schema/migrations', (req, res) => {
  const rows = meta
    .prepare(
      `SELECT id, version, forward_sql, rollback_sql, reversible, status, executor_id, executor_name, ts
       FROM schema_migrations WHERE connection_id = ? ORDER BY ts DESC`
    )
    .all(req.params.id)
  res.json(
    rows.map((r) => ({
      id: r.id,
      version: r.version,
      forwardSql: safeJson(r.forward_sql) || [],
      rollbackSql: safeJson(r.rollback_sql) || [],
      reversible: !!r.reversible,
      status: r.status || 'active',
      executorId: r.executor_id || null,
      executorName: r.executor_name || r.executor_id || null,
      ts: r.ts,
    }))
  )
})

// Roll the schema back to a target version. Runs the down (rollback) SQL for
// every still-active migration newer than `toVersion` — newest first — then
// marks those migrations 'rollbacked' and resets the connection's schema
// version to `toVersion`. The target version itself stays active. A later
// commit reuses the next number (e.g. rolling 3→1 then committing yields a new
// v2), so version numbers are not globally unique — status distinguishes them.
app.post('/api/connections/:id/schema/rollback', async (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  const conn = getConnection(req.params.id)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })

  const toVersion = Number(req.body?.toVersion)
  if (!Number.isInteger(toVersion) || toVersion < 0) {
    return res.status(400).json({ error: 'A valid target version is required' })
  }

  // Still-active migrations newer than the target, newest first — these get undone.
  const rows = meta
    .prepare(
      `SELECT id, version, forward_sql, rollback_sql, reversible
       FROM schema_migrations
       WHERE connection_id = ? AND version > ? AND COALESCE(status, 'active') = 'active'
       ORDER BY version DESC`
    )
    .all(req.params.id, toVersion)

  if (!rows.length) return res.status(400).json({ error: 'Nothing to roll back for that version' })
  const irreversible = rows.find((r) => !r.reversible)
  if (irreversible) {
    return res.status(400).json({ error: `v${irreversible.version} is not reversible — can't roll back past it` })
  }

  // Undo each migration's statements in reverse order (last applied, first
  // undone). runQueryOrThrow, not runQuery: a down-statement that fails must
  // abort here, or we'd mark the migrations rolled back and drop the schema
  // version while the database still has the changes.
  try {
    for (const r of rows) {
      const downs = (safeJson(r.rollback_sql) || []).filter(Boolean).reverse()
      for (const sql of downs) {
        await db.runQueryOrThrow(conn, bodyCtx(req), sql)
      }
    }
  } catch (error) {
    // Statements before the failure have already run — the trail is left
    // untouched so the remaining ones can be retried or undone by hand.
    return res.status(500).json({ error: `Rollback failed: ${error.message}` })
  }

  const markRolledBack = meta.prepare(`UPDATE schema_migrations SET status = 'rollbacked' WHERE id = ?`)
  const tx = meta.transaction((list) => list.forEach((r) => markRolledBack.run(r.id)))
  tx(rows)
  setSchemaVersion(req.params.id, toVersion)

  res.json({ version: toVersion, rolledBack: rows.map((r) => r.version) })
})

// ============================================================================
// Database browsing + querying
// ============================================================================
// Every route below dispatches through server/db/index.js. Engines that don't
// have the concept answer with the empty result (tables, columns, diagram…) or
// a 400 naming the type (insert, analyze) — never `undefined`.

// The connection this request is for; the /:id guard has already authorized it.
const connOr404 = (req, res) => {
  const conn = getConnection(req.params.id)
  if (!conn) {
    res.status(404).json({ error: 'Connection not found' })
    return null
  }
  return conn
}

app.get('/api/connections/:id/tables', async (req, res) => {
  const conn = connOr404(req, res)
  if (!conn) return
  try {
    res.json(await db.listTables(conn, queryCtx(req)))
  } catch (error) {
    fail(res, error)
  }
})

// Connectivity check — attempts to reach the database and reports { ok }.
app.get('/api/connections/:id/ping', async (req, res) => {
  const conn = getConnection(req.params.id)
  if (!conn) return res.status(404).json({ ok: false, error: 'Connection not found' })
  try {
    res.json(await db.ping(conn, queryCtx(req)))
  } catch (error) {
    res.json({ ok: false, error: error.message })
  }
})

// Pre-flight handshake the console runs before it opens a connection. Same
// probe as /ping, but a failure explains itself: { ok:false, reason, cause,
// hint } — see server/db/diagnose.js. Never throws, so the UI always has
// something to show.
app.get('/api/connections/:id/handshake', async (req, res) => {
  const conn = connOr404(req, res)
  if (!conn) return
  res.json(await db.handshake(conn, queryCtx(req)))
})

// ---- Connection sessions ----
// A session is one open driver handle (a Postgres pool for a database, an
// ioredis client for a db index, a SQLite file handle) — what "max sessions"
// counts. Everyone browsing the same target shares one session and appears as
// a participant on it. See server/sessions.

// Who's currently connected, and against what cap.
app.get('/api/connections/:id/sessions', async (req, res) => {
  const conn = connOr404(req, res)
  if (!conn) return
  try {
    res.json(await connectionSessionStats(conn))
  } catch (error) {
    fail(res, error)
  }
})

// Leave a session (or, for a workspace admin, close it for everyone). Leaving
// only drops the caller's participation; the handle is released once the last
// participant is gone.
app.delete('/api/connections/:id/sessions/:sessionId', async (req, res) => {
  const conn = connOr404(req, res)
  if (!conn) return
  const user = authUser(req)
  const force = ['1', 'true', 'yes'].includes(String(req.query.force || '').toLowerCase())
  if (force && conn.workspaceId && memberRole(conn.workspaceId, user.id) !== 'owner') {
    return res.status(403).json({ error: 'Only a workspace owner can close someone else’s session.' })
  }
  try {
    const actor = force ? null : { id: user.id, name: user.name || user.username }
    const ended = await endConnectionSession(conn.id, req.params.sessionId, actor)
    res.json({ ok: ended, ...(await connectionSessionStats(conn)) })
  } catch (error) {
    fail(res, error)
  }
})

// List all browsable database objects (tables, views, functions, …) as a
// generic [{ name, type, ... }] list so any dialect can populate the browser.
app.get('/api/connections/:id/objects', async (req, res) => {
  const conn = connOr404(req, res)
  if (!conn) return
  try {
    res.json(await db.listObjects(conn, queryCtx(req)))
  } catch (error) {
    fail(res, error)
  }
})

// Function definition(s) for a named routine (empty for engines without them).
app.get('/api/connections/:id/function/:name', async (req, res) => {
  const conn = connOr404(req, res)
  if (!conn) return
  try {
    res.json(await db.listFunctions(conn, queryCtx(req), req.params.name))
  } catch (error) {
    fail(res, error)
  }
})

app.get('/api/connections/:id/table/:table', async (req, res) => {
  const conn = connOr404(req, res)
  if (!conn) return
  try {
    res.json(await db.getTableData(conn, queryCtx(req), { table: req.params.table, limit: parseInt(req.query.limit) || 200 }))
  } catch (error) {
    fail(res, error)
  }
})

app.get('/api/connections/:id/columns/:table', async (req, res) => {
  const conn = connOr404(req, res)
  if (!conn) return
  try {
    res.json(await db.getColumns(conn, queryCtx(req), req.params.table))
  } catch (error) {
    fail(res, error)
  }
})

app.get('/api/connections/:id/indexes/:table', async (req, res) => {
  const conn = connOr404(req, res)
  if (!conn) return
  try {
    res.json(await db.getIndexes(conn, queryCtx(req), req.params.table))
  } catch (error) {
    fail(res, error)
  }
})

// Full schema (table -> column names) for editor autocomplete.
app.get('/api/connections/:id/schema', async (req, res) => {
  const conn = connOr404(req, res)
  if (!conn) return
  try {
    res.json(await db.getSchemaMap(conn, queryCtx(req)))
  } catch (error) {
    fail(res, error)
  }
})

// List databases + schemas available on a connection (for the breadcrumb).
app.get('/api/connections/:id/namespaces', async (req, res) => {
  const conn = connOr404(req, res)
  if (!conn) return
  try {
    res.json(await db.namespaces(conn, queryCtx(req)))
  } catch (error) {
    fail(res, error)
  }
})

// Column data types the schema editor offers. Schemaless engines (Redis)
// report none — the schema designer is hidden for them.
app.get('/api/connections/:id/types', (req, res) => {
  const conn = connOr404(req, res)
  if (!conn) return
  res.json({ types: db.dataTypesFor(conn) })
})

// Schema diagram: every table's columns + foreign-key relationships.
app.get('/api/connections/:id/diagram', async (req, res) => {
  const conn = connOr404(req, res)
  if (!conn) return
  try {
    res.json(await db.getDiagram(conn, queryCtx(req)))
  } catch (error) {
    fail(res, error)
  }
})

// Insert a row (parameterized).
app.post('/api/connections/:id/insert', async (req, res) => {
  const conn = connOr404(req, res)
  if (!conn) return
  const { table, values } = req.body
  if (!table || Object.keys(values || {}).length === 0) {
    return res.status(400).json({ error: 'A table and at least one value are required' })
  }
  try {
    res.json(await db.insertRow(conn, bodyCtx(req), { table, values }))
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

// Analyze query performance — EXPLAIN-based, normalized across dialects.
// Read-only SELECTs also run for real timings; writes are never executed.
app.post('/api/connections/:id/analyze', async (req, res) => {
  const conn = connOr404(req, res)
  if (!conn) return
  const { sql } = req.body
  if (!sql || !sql.trim()) return res.status(400).json({ error: 'SQL query required' })

  try {
    // Checked before parsing, so a non-SQL engine gets a message about itself
    // rather than one about statement shapes it doesn't have.
    db.requireCapability(conn, 'analyze')
    const statements = splitSqlStatements(stripSqlComments(sql))
    if (statements.length !== 1) throw new Error('Only a single statement can be analyzed.')
    // Drop any EXPLAIN prefix the user already typed so we don't explain an EXPLAIN.
    const statement = statements[0].replace(/^explain\s+(query\s+plan\s+|analyze\s+|\([^)]*\)\s*)?/i, '')
    res.json(await db.analyze(conn, bodyCtx(req), { sql: statement, cls: classifyStatement(statement) }))
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

// Execute a query (or, on a command-driven engine, a command buffer).
app.post('/api/connections/:id/query', async (req, res) => {
  const conn = connOr404(req, res)
  if (!conn) return
  const { sql } = req.body
  if (!sql || !sql.trim()) return res.status(400).json({ error: 'SQL query required' })
  try {
    res.json(await db.runQuery(conn, bodyCtx(req), sql))
  } catch (error) {
    fail(res, error)
  }
})

// ============================================================================
// Redis keyspace browsing
// ============================================================================
// Redis has no tables, so the generic /tables and /objects routes return nothing
// for it and the console's sidebar reads the keyspace through these routes
// instead. Everything else (running commands, workflows, dashboards) goes
// through the shared /query route.

// Guard: these routes only make sense on a Redis connection. They reach the
// driver directly (a keyspace has no SQL equivalent), so this is also where
// they register their session — the gate the generic dispatchers apply for
// every other route.
const requireRedis = async (req, res) => {
  const conn = getConnection(req.params.id)
  if (!conn) {
    res.status(404).json({ error: 'Connection not found' })
    return null
  }
  if (conn.type !== 'redis') {
    res.status(400).json({ error: `Not a Redis connection (type: ${conn.type}).` })
    return null
  }
  try {
    await db.enterSession(conn, queryCtx(req))
  } catch (error) {
    fail(res, error)
    return null
  }
  return conn
}
const redis = db.drivers.redis

// One SCAN page of the keyspace: [{ key, type, ttlMs }] plus the cursor to hand
// back for the next page. SCAN (never KEYS) so a large keyspace stays responsive.
app.get('/api/connections/:id/redis/keys', async (req, res) => {
  const conn = await requireRedis(req, res)
  if (!conn) return
  try {
    res.json(
      await redis.scanKeys(conn, queryCtx(req), {
        pattern: req.query.pattern,
        cursor: req.query.cursor,
        count: req.query.count,
        type: req.query.type,
      })
    )
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Keyspace summary for the sidebar header (db, key count, server version).
app.get('/api/connections/:id/redis/overview', async (req, res) => {
  const conn = await requireRedis(req, res)
  if (!conn) return
  try {
    res.json(await redis.overview(conn, queryCtx(req)))
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// One key's value as a generic { columns, rows } page (plus type/TTL/length).
// Every collection type is paged by offset/limit.
app.get('/api/connections/:id/redis/key', async (req, res) => {
  const conn = await requireRedis(req, res)
  if (!conn) return
  if (!req.query.key) return res.status(400).json({ error: 'A key is required.' })
  try {
    res.json(await redis.readKey(conn, queryCtx(req), req.query.key, { offset: req.query.offset, limit: req.query.limit }))
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

// Delete one or more keys. Body: { keys: string[] } → { deleted }.
app.delete('/api/connections/:id/redis/keys', async (req, res) => {
  const conn = await requireRedis(req, res)
  if (!conn) return
  const keys = Array.isArray(req.body?.keys) ? req.body.keys.filter((k) => typeof k === 'string' && k) : []
  if (!keys.length) return res.status(400).json({ error: 'At least one key is required.' })
  try {
    res.json(await redis.deleteKeys(conn, queryCtx(req), keys))
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

// Set or clear a key's expiry. Body: { key, ttlMs } — null/0 removes the expiry.
app.put('/api/connections/:id/redis/ttl', async (req, res) => {
  const conn = await requireRedis(req, res)
  if (!conn) return
  const { key, ttlMs } = req.body || {}
  if (!key) return res.status(400).json({ error: 'A key is required.' })
  try {
    res.json(await redis.setTtl(conn, queryCtx(req), key, ttlMs))
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

// ============================================================================
// System / Updates
// ============================================================================

// The running app's identity — cheap; used by the wizard's verify-poll.
app.get('/api/system/version', (req, res) => {
  if (!requireAuth(req, res)) return
  res.json({ name: APP_NAME, version: APP_VERSION, sha: GIT_SHA, autoCheckUpdates: AUTO_CHECK_UPDATES })
})

// Check for a newer release (cached ~30 min; ?refresh=1 bypasses the cache).
app.get('/api/system/update/check', async (req, res) => {
  if (!requireAuth(req, res)) return
  const refresh = req.query.refresh === '1' || req.query.refresh === 'true'
  res.json(await getUpdateInfo({ refresh }))
})

// Snapshot the metadata DB before updating (rollback insurance).
app.post('/api/system/backup', async (req, res) => {
  if (!requireSystemAdmin(req, res)) return
  try {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true })
    const file = `app-${APP_VERSION}-${Date.now()}.db`
    const dest = path.join(BACKUPS_DIR, file)
    await meta.backup(dest)
    res.json({ ok: true, file, sizeBytes: fs.statSync(dest).size, createdAt: Date.now() })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Download a previously-taken snapshot.
app.get('/api/system/backup/:file/download', (req, res) => {
  if (!requireSystemAdmin(req, res)) return
  const safe = path.basename(req.params.file)
  const full = path.join(BACKUPS_DIR, safe)
  if (path.dirname(full) !== BACKUPS_DIR || !fs.existsSync(full)) {
    return res.status(404).json({ error: 'Backup not found' })
  }
  res.download(full, safe)
})

// Pre-flight validation before applying an update.
app.get('/api/system/preflight', (req, res) => {
  if (!requireSystemAdmin(req, res)) return
  const checks = []

  try {
    const r = meta.pragma('integrity_check', { simple: true })
    checks.push({ id: 'integrity', label: 'Metadata database integrity', status: r === 'ok' ? 'pass' : 'fail', detail: r === 'ok' ? 'No corruption detected' : String(r) })
  } catch (e) {
    checks.push({ id: 'integrity', label: 'Metadata database integrity', status: 'fail', detail: e.message })
  }

  try {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true })
    const st = fs.statfsSync(BACKUPS_DIR)
    const freeBytes = st.bavail * st.bsize
    const metaSize = fs.existsSync(META_DB_PATH) ? fs.statSync(META_DB_PATH).size : 0
    const ok = freeBytes > metaSize * 3 + 50e6
    checks.push({ id: 'disk', label: 'Free disk for snapshot', status: ok ? 'pass' : 'warn', detail: `${Math.round(freeBytes / 1e6)} MB free` })
  } catch {
    checks.push({ id: 'disk', label: 'Free disk for snapshot', status: 'warn', detail: 'Could not determine free space' })
  }

  const applyMethod = updateApplyMethod()
  checks.push({
    id: 'apply',
    label: 'Update apply method',
    status: applyMethod === 'docker' ? 'pass' : 'warn',
    detail:
      applyMethod === 'docker'
        ? 'Docker socket detected — one-click self-update available'
        : 'No Docker socket — a manual pull will be required',
  })

  const info = cachedUpdateInfo()
  if (info?.upgradeBlocked) {
    checks.push({ id: 'path', label: 'Upgrade path', status: 'fail', detail: `Upgrade from ${info.minUpgradeFrom}+ required first — step through intermediate versions` })
  } else if (info?.breaking) {
    checks.push({ id: 'breaking', label: 'Breaking changes', status: 'warn', detail: 'This release contains breaking changes — review the changelog' })
  }

  res.json({ checks })
})

// Trigger the update. Self-updates via the Docker socket when available; without
// it, returns the manual command for the UI to display.
app.post('/api/system/update/apply', async (req, res) => {
  if (!requireSystemAdmin(req, res)) return
  const tag = (req.body && req.body.tag) || cachedUpdateInfo()?.latest?.version || 'latest'

  if (dockerSelfUpdateAvailable()) {
    try {
      const r = await dockerSelfUpdate()
      return res.json({ ok: true, method: 'docker', message: 'Pulling the new image and recreating the container — this will restart shortly.', ...r })
    } catch (e) {
      console.error('Docker self-update failed:', e.message)
      return res.status(500).json({ error: `Docker self-update failed: ${e.message}` })
    }
  }

  res.json(manualUpdateCommand(tag))
})

// Health check — also carries boot readiness + identity for the update flow.
app.get('/api/health', (req, res) => {
  res.json({ status: bootReady ? 'ok' : 'starting', ready: bootReady, version: APP_VERSION, sha: GIT_SHA })
})

// ============================================================================
// Static frontend, fallbacks and startup
// ============================================================================

// Serve the built frontend (production) with SPA fallback for client routes.
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR))
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(DIST_DIR, 'index.html')))
}

// 404 (API + anything else when no frontend build is present)
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' })
})

// Error handler
app.use((error, req, res, next) => {
  console.error(error)
  res.status(500).json({ error: error.message })
})

// One tick drives both schedulers: workflows with a due Schedule trigger, and
// connections with a due backup schedule.
if (SCHEDULER_ENABLED) {
  cron.schedule('* * * * *', () => {
    runDueWorkflows().catch((e) => console.error('Scheduler tick error:', e.message))
    runDueBackups().catch((e) => console.error('Backup scheduler tick error:', e.message))
  })
}

// Expire idle connection sessions and close the driver handles behind them.
// Runs regardless of SCHEDULER_ENABLED: that flag is about *doing work on a
// schedule*, while this only releases resources this process is holding.
cron.schedule('* * * * *', () => {
  sweepConnectionSessions().catch((e) => console.error('Session sweep error:', e.message))
})

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`)
  console.log(`📊 API available at http://localhost:${PORT}/api`)
  console.log(`🔑 Sessions: logins in ${META_DB_PATH}, cached in ${sessionCache.kind}`)
  // Open what can be opened eagerly (SQLite files) so the first query is fast.
  for (const conn of listConnections()) {
    try {
      db.prewarmConnection(conn)
    } catch (error) {
      console.error(`Failed to open ${conn.name}:`, error.message)
    }
  }
})

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...')
  db.closeAllConnections()
  await closeSessionStore().catch(() => {})
  meta.close()
  process.exit(0)
})
