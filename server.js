#!/usr/bin/env node
/**
 * HTTP surface for the database manager.
 *
 * This file is routes and wiring only. Everything a route needs lives in a
 * module under server/:
 *
 *   db/           the engine-agnostic database layer (sqlite | postgres | redis)
 *   meta.js       the app's own SQLite/PostgreSQL store; migrator/ evolves its schema
 *   auth.js       sessions, guards, workspace/connection access rules
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

// Must stay the first import: it migrates the metadata DB before server/meta.js
// opens its connection (see server/migrator/boot.js).
import './server/migrator/boot.js'
import express from 'express'
import cors from 'cors'
import fs from 'fs'
import path from 'path'
import { randomUUID, timingSafeEqual } from 'crypto'
import { pipeline } from 'stream/promises'
import { Readable, Transform } from 'stream'
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
  META_DB_TYPE,
  PORT,
  SCHEDULER_ENABLED,
} from './server/config.js'
import { backupMeta, checkMetaIntegrity, closeMeta, db as meta, seedAdminFromEnv, transaction } from './server/meta.js'
import { sha256 } from './server/crypto.js'
import { describeError, filterAsync, safeJson, sanitizeForKey } from './server/util.js'
import {
  authUser,
  baseUrl,
  bearerToken,
  can,
  connectionAccess,
  createSession,
  deleteSession,
  getUserByEmail,
  isMember,
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
  membershipsOf,
  removeMember as removeWorkspaceMember,
  renameWorkspace,
  setMemberRole as setWorkspaceMemberRole,
} from './server/workspaces.js'
import {
  NODE_TYPES,
  PERMISSIONS,
  PERMISSION_KEYS,
  countRoleUsage,
  createRole,
  deleteRole,
  getRole,
  listRoles,
  loadPolicy,
  roleExists,
  roleGrantableOn,
  roleUsageCounts,
  updateRole,
} from './server/permissions.js'
import { CUSTOM_NODE_TYPES } from './server/permissions-catalog.js'
import {
  LOCK_FIELDS,
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
  userSummaries,
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
  deleteConnectionMetadata,
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
import {
  assertGatewayForWorkspace,
  connectionsUsingGateway,
  createSshGateway,
  createSshKey,
  deleteSshGateway,
  deleteSshKey,
  getSshGateway,
  getSshKey,
  listSshGateways,
  listSshKeys,
  renameSshKey,
  sshKeyGateways,
  testSshGateway,
  updateSshGateway,
} from './server/ssh.js'
import { executeAndRecord, listWorkflowsForConnections, runDueWorkflows } from './server/workflow.js'
import {
  createWorkflow,
  deleteWorkflow,
  getWebhookWorkflow,
  getWorkflow,
  getWorkflowRun,
  listConnectionWorkflows,
  listWorkflowRuns,
  updateWorkflow,
} from './server/workflow-store.js'
import {
  createDashboard,
  deleteDashboard,
  getDashboard,
  listDashboards,
  listDashboardsForConnections,
  updateDashboard,
} from './server/dashboards.js'
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
import { backupCalendar, findRunUpload, listBackupRuns, markRunUploadDeleted } from './server/backup/history.js'
import { buildConnectionExport, importConnectionDoc } from './server/connection-transfer.js'
import { IMPORT_MAX_BYTES, planExport, previewImport, runImport } from './server/data-transfer.js'
import {
  createDraft as createSchemaDraft,
  deleteDraft as deleteSchemaDraft,
  getDraft as getSchemaDraft,
  listDrafts as listSchemaDrafts,
  schemaLayout,
  statementCount as schemaStatementCount,
  updateDraft as updateSchemaDraft,
} from './server/schema-drafts.js'
import {
  addGrant,
  addNodeMember,
  chainOf,
  childrenOf,
  createGroupNode,
  createResourceNode,
  deleteNode,
  deleteResourceNode,
  getNode,
  listGrants,
  listNodeMembers,
  memberCounts,
  peopleAtNode,
  moveNode,
  ownsNode,
  permissionsAtNode,
  removeGrant,
  removeNodeMember,
  renameNode,
  renameResourceNode,
  setNodeOwner,
  visibleTree,
} from './server/resource-tree.js'
import {
  cachedUpdateInfo,
  dockerSelfUpdate,
  dockerSelfUpdateAvailable,
  getUpdateInfo,
  manualUpdateCommand,
  updateApplyMethod,
} from './server/system-update.js'

const app = express()

// Express 4 ignores the promise an async handler returns, so a rejection would
// leave the request hanging. Hand it to the error handler at the bottom of this
// file instead. (Four-argument functions are error handlers; one-argument
// `app.get(name)` is the settings getter.)
const forwardRejections = (handler) =>
  typeof handler !== 'function' || handler.length === 4
    ? handler
    : (req, res, next) => {
        const result = handler(req, res, next)
        if (typeof result?.catch === 'function') result.catch(next)
      }
for (const method of ['use', 'get', 'post', 'put', 'patch', 'delete']) {
  const register = app[method].bind(app)
  app[method] = (...args) => (method === 'get' && args.length === 1 ? register(...args) : register(...args.map(forwardRejections)))
}

app.use(cors())
app.use(express.json({ limit: '10mb' }))
// Resolve the bearer token once per request and park the user on `req`, so
// `requireAuth` stays a synchronous read (see server/auth.js).
app.use(sessionMiddleware)

// Boot readiness — flipped true once the policy is loaded. The meta DB is
// already current: server/migrator/boot.js migrated it before any import here
// opened it.
let bootReady = false
// The role policy is read once here; every permission check reads it from memory.
await loadPolicy()
await seedAdminFromEnv()
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
  const row = username
    ? await meta().users.findUnique({
        where: { username: String(username) },
        select: { id: true, username: true, name: true, role: true, status: true, password_hash: true, ...LOCK_FIELDS },
      })
    : null
  if (row) {
    const refusal = await loginRefusal(row)
    if (refusal) return res.status(refusal.status).json(refusal.body)
  }
  if (!row || row.status === 'pending' || row.password_hash !== sha256(password)) {
    if (row && row.status !== 'pending') {
      const lock = await recordFailure(row)
      if (lock) return res.status(423).json((await loginRefusal({ ...row, ...lockRow(lock) })).body)
    }
    return res.status(401).json({ error: 'Invalid email or password' })
  }
  await clearFailures(row.id)
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
app.get('/api/auth/me', async (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  res.json({ user: publicUser(user) })
})

// Rename yourself. Name is the only self-editable profile field.
app.patch('/api/auth/profile', async (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  const name = (req.body?.name ?? '').trim()
  if (!name) return res.status(400).json({ error: 'A name is required.' })
  await updateUser(user.id, { name })
  res.json({ user: publicUser(await userRow(user.id)) })
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
  if (!(await verifyPassword(user.id, currentPassword))) {
    return res.status(400).json({ error: 'Your current password is incorrect.' })
  }
  if (currentPassword === newPassword) {
    return res.status(400).json({ error: 'The new password must be different from the current one.' })
  }
  await updateUser(user.id, { password: newPassword })
  await destroyAuthSessionsForUser(user.id)
  res.json({ user: publicUser(await userRow(user.id)), token: await createSession(user.id, sessionContext(req)) })
})

// Request a password reset. Always 200 — never reveal whether the email exists.
// When SMTP is available the reset link is emailed; the link is never returned.
app.post('/api/auth/forgot', async (req, res) => {
  const email = (req.body?.email || '').trim().toLowerCase()
  const user = email ? await meta().users.findUnique({ where: { username: email }, select: { id: true, status: true } }) : null
  if (user && user.status !== 'pending') {
    const token = randomUUID()
    const expires = Date.now() + 60 * 60 * 1000 // 1 hour
    await meta().users.update({ where: { id: user.id }, data: { reset_token: token, reset_expires: expires } })
    const cfg = await smtpConfig()
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
app.get('/api/auth/reset/:token', async (req, res) => {
  const u = await meta().users.findFirst({ where: { reset_token: req.params.token }, select: { username: true, reset_expires: true } })
  if (!u || (u.reset_expires && u.reset_expires < Date.now())) {
    return res.status(404).json({ error: 'This reset link is invalid or has expired.' })
  }
  res.json({ email: u.username })
})

// Set a new password, invalidate existing sessions, and log the user in.
app.post('/api/auth/reset/:token', async (req, res) => {
  const u = await meta().users.findFirst({ where: { reset_token: req.params.token }, select: { id: true, reset_expires: true } })
  if (!u || (u.reset_expires && u.reset_expires < Date.now())) {
    return res.status(404).json({ error: 'This reset link is invalid or has expired.' })
  }
  const { password } = req.body || {}
  if (!password) return res.status(400).json({ error: 'A password is required.' })
  await meta().users.update({
    where: { id: u.id },
    data: { password_hash: sha256(password), status: 'active', reset_token: null, reset_expires: null },
  })
  // Setting a new password through an emailed link proves control of the
  // mailbox, so it lifts a brute-force block as well — otherwise the one
  // self-service recovery path would dead-end at the login page.
  await clearFailures(u.id)
  await destroyAuthSessionsForUser(u.id) // sign out everywhere else
  const user = await userRow(u.id)
  res.json({ user: publicUser(user), token: await createSession(u.id, sessionContext(req)) })
})

// First-run status — the wizard runs until the instance has an *administrator*,
// not until it has users. An install migrated from a version that predated the
// system role (migrateToWorkspaces) has accounts but no admin, and the admin
// area would otherwise be unreachable by everyone. `hasUsers` tells the wizard
// which of its two shapes to render.
app.get('/api/setup', async (req, res) => {
  res.json({
    needsSetup: await countAdmins() === 0,
    hasUsers: (await meta().users.count()) > 0,
  })
})

// First-run setup — creates the instance administrator, and nothing else. No
// workspace is made here: an admin holds no workspace access (CLAUDE.md "AUTH
// MODEL"), so an ownerless workspace created alongside them is just debt. The
// admin signs in and creates the first workspace with a real owner.
//
// Allowed only while the instance has no admin. On an instance that already has
// accounts the credentials must match one of them and that account is promoted
// — creating an admin out of nothing is reserved for a genuinely empty install,
// so an adminless legacy instance can't be claimed by a passing stranger.
app.post('/api/setup', async (req, res) => {
  if (await countAdmins() > 0) return res.status(403).json({ error: 'Setup has already been completed.' })
  const email = (req.body?.email || '').trim()
  const { password, name } = req.body || {}
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' })

  if ((await meta().users.count()) > 0) {
    const existing = await getUserByEmail(email)
    if (!existing || existing.status === 'pending' || !(await verifyPassword(existing.id, password))) {
      return res.status(401).json({ error: 'Invalid email or password' })
    }
    // Promotion drops every workspace membership, which can leave a legacy
    // workspace ownerless — recoverable, and only from here: the new admin
    // assigns an owner from the admin area (PUT /api/admin/workspaces/:id/members).
    await setSystemRole(existing.id, 'admin')
    if (name?.trim()) await updateUser(existing.id, { name: name.trim() })
    // The sessions this account already holds were authorized for access it no
    // longer has — same reason the admin role-change route signs them out.
    await destroyAuthSessionsForUser(existing.id)
    return res.json({ user: publicUser(await userRow(existing.id)), token: await createSession(existing.id, sessionContext(req)) })
  }

  if (await getUserByEmail(email)) return res.status(400).json({ error: 'That email already has an account.' })
  const { user: created } = await createUser({ email, name: name?.trim() || 'Admin', password, role: 'admin' })
  res.json({ user: publicUser(await userRow(created.id)), token: await createSession(created.id, sessionContext(req)) })
})

// Validate an invite token → who it's for and which workspace.
app.get('/api/invite/:token', async (req, res) => {
  const u = await meta().users.findFirst({
    where: { invite_token: req.params.token },
    select: { username: true, invite_workspace: true, token_expires: true },
  })
  if (!u || (u.token_expires && u.token_expires < Date.now())) {
    return res.status(404).json({ error: 'This invite is invalid or has expired.' })
  }
  const ws = await getWorkspaceRow(u.invite_workspace)
  res.json({ email: u.username, workspaceName: ws?.name || 'a workspace' })
})

// Accept an invite — set name + password, activate the account, log in.
app.post('/api/invite/:token/accept', async (req, res) => {
  const u = await meta().users.findFirst({
    where: { invite_token: req.params.token },
    select: { id: true, username: true, name: true, token_expires: true },
  })
  if (!u || (u.token_expires && u.token_expires < Date.now())) {
    return res.status(404).json({ error: 'This invite is invalid or has expired.' })
  }
  const { name, password } = req.body || {}
  if (!password) return res.status(400).json({ error: 'A password is required.' })
  await meta().users.update({
    where: { id: u.id },
    data: {
      password_hash: sha256(password),
      name: name?.trim() || u.name || u.username,
      status: 'active',
      invite_token: null,
      invite_workspace: null,
      token_expires: null,
    },
  })
  const user = await userRow(u.id)
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

app.get('/api/admin/workspaces', async (_req, res) => res.json(await listAllWorkspaces()))

// Create a workspace and hand it to someone. `ownerEmail` must name an account
// that already exists — creating a person as a side effect of creating a
// workspace produced accounts nobody had reviewed, so the admin creates the
// user first (POST /api/admin/users) and assigns them here. An account that is
// still `pending` is fine: it gets a fresh invite link scoped to the new
// workspace.
app.post('/api/admin/workspaces', async (req, res) => {
  const name = (req.body?.name || '').trim()
  const ownerEmail = (req.body?.ownerEmail || '').trim().toLowerCase()
  if (!name) return res.status(400).json({ error: 'Workspace name is required.' })
  if (!ownerEmail) return res.status(400).json({ error: 'An owner email is required — a workspace needs someone to run it.' })

  const owner = await getUserByEmail(ownerEmail)
  if (!owner) {
    return res.status(400).json({ error: 'No account with that email — create the user first, then assign them.' })
  }
  if (isSystemAdmin(owner)) {
    return res.status(400).json({ error: 'That account administers the instance and cannot own a workspace.' })
  }
  const ws = await createWorkspaceRow(name)
  let inviteLink = null
  if (owner.status === 'pending') {
    inviteLink = `${baseUrl(req)}/invite/${await issueInviteToken(owner.id, ws.id)}`
  }
  await addWorkspaceMember(ws.id, owner.id, 'owner')

  let emailed = false
  if (inviteLink) {
    const cfg = await smtpConfig()
    if (cfg) {
      try {
        await sendInviteEmail(cfg, { to: ownerEmail, workspaceName: ws.name, link: inviteLink })
        emailed = true
      } catch (e) {
        console.error('Owner invite email failed:', e.message)
      }
    }
  }
  res.json({ workspace: { ...ws, memberCount: 1, groupCount: 0, connectionCount: 0 }, inviteLink, emailed })
})

app.put('/api/admin/workspaces/:id', async (req, res) => {
  if (!(await getWorkspaceRow(req.params.id))) return res.status(404).json({ error: 'Workspace not found' })
  const name = (req.body?.name || '').trim()
  if (!name) return res.status(400).json({ error: 'Workspace name is required.' })
  await renameWorkspace(req.params.id, name)
  res.json({ ok: true, name })
})

app.delete('/api/admin/workspaces/:id', async (req, res) => {
  if (!(await getWorkspaceRow(req.params.id))) return res.status(404).json({ error: 'Workspace not found' })
  const removed = await dropWorkspace(req.params.id)
  res.json({ ok: true, connectionsDeleted: removed.length })
})

// The membership list, so an admin can see and change who owns a workspace
// without joining it.
app.get('/api/admin/workspaces/:id/members', async (req, res) => {
  if (!(await getWorkspaceRow(req.params.id))) return res.status(404).json({ error: 'Workspace not found' })
  res.json(await listWorkspaceMembers(req.params.id))
})

// Grant or revoke ownership. This is the admin's lever over a workspace they
// can't enter: it can rescue one whose owners have all left.
app.put('/api/admin/workspaces/:id/members/:userId', async (req, res) => {
  if (!(await getWorkspaceRow(req.params.id))) return res.status(404).json({ error: 'Workspace not found' })
  const role = req.body?.role
  if (!roleExists(role)) return res.status(400).json({ error: 'Unknown role.' })
  const target = await userRow(req.params.userId)
  if (!target) return res.status(404).json({ error: 'User not found' })
  if (isSystemAdmin(target)) return res.status(400).json({ error: 'An instance admin cannot belong to a workspace.' })

  const current = await memberRole(req.params.id, req.params.userId)
  if (!(await isMember(req.params.id, req.params.userId))) await addWorkspaceMember(req.params.id, req.params.userId, role)
  else {
    if (isOwnerRole(current) && !isOwnerRole(role) && await countOwners(req.params.id) <= 1) {
      return res.status(400).json({ error: 'The workspace needs at least one owner.' })
    }
    await setWorkspaceMemberRole(req.params.id, req.params.userId, role)
  }
  res.json({ ok: true, role })
})

app.delete('/api/admin/workspaces/:id/members/:userId', async (req, res) => {
  const current = await memberRole(req.params.id, req.params.userId)
  if (!(await isMember(req.params.id, req.params.userId))) return res.status(404).json({ error: 'Member not found' })
  if (isOwnerRole(current) && await countOwners(req.params.id) <= 1) {
    return res.status(400).json({ error: 'The workspace needs at least one owner.' })
  }
  await removeWorkspaceMember(req.params.id, req.params.userId)
  res.json({ ok: true })
})

// ---- Roles ----
//
// Workspace roles are instance-wide and defined here: an admin sets the access
// model once, and a workspace owner assigns people to it. The system tier
// (users.role) is deliberately not part of this — see server/permissions.js.

// The permission catalog: everything a role can be given, grouped for the editor.
// It comes from code, not the DB, so the UI can only offer what a route enforces.
app.get('/api/admin/permissions', async (_req, res) => res.json(PERMISSIONS))

app.post('/api/admin/roles', async (req, res) => {
  const name = (req.body?.name || '').trim()
  if (!name) return res.status(400).json({ error: 'A role name is required.' })
  res.json(
    await createRole({
      name,
      description: req.body?.description || '',
      permissions: req.body?.permissions || [],
      // The node types this role may be granted on — omit for "anywhere".
      appliesTo: Array.isArray(req.body?.appliesTo) ? req.body.appliesTo : null,
    })
  )
})

// Rename a role or change what it grants. The slug is fixed at creation because
// memberships store it, so a rename never touches a single membership row.
app.put('/api/admin/roles/:slug', async (req, res) => {
  if (!roleExists(req.params.slug)) return res.status(404).json({ error: 'Role not found' })
  const { name, description, permissions, appliesTo } = req.body || {}
  if (name !== undefined && !String(name).trim()) return res.status(400).json({ error: 'A role name is required.' })
  // `appliesTo` is three-valued (see updateRole): absent leaves the criteria
  // alone, null widens them to any node type, an array narrows them.
  res.json(await updateRole(req.params.slug, { name, description, permissions, appliesTo }))
})

// Delete a custom role. Refused while anyone holds it — those memberships would
// silently fail closed to no access — and builtins are never deletable.
app.delete('/api/admin/roles/:slug', async (req, res) => {
  const role = getRole(req.params.slug)
  if (!role) return res.status(404).json({ error: 'Role not found' })
  if (role.builtin) return res.status(400).json({ error: 'A built-in role cannot be deleted.' })
  // Memberships *and* tree grants — either one would fail closed to no access.
  const inUse = await countRoleUsage(req.params.slug)
  if (inUse) return res.status(409).json({ error: `${inUse} member${inUse === 1 ? '' : 's'} or grant${inUse === 1 ? '' : 's'} still hold this role.`, inUse })
  await deleteRole(req.params.slug)
  res.json({ ok: true })
})

// ---- Users ----

app.get('/api/admin/users', async (_req, res) => res.json(await listUsers()))

// Create an account. With a password it's usable immediately; without one it's
// pending and the returned invite link is how they set theirs.
app.post('/api/admin/users', async (req, res) => {
  const email = (req.body?.email || '').trim().toLowerCase()
  const { name, password, role } = req.body || {}
  if (!email) return res.status(400).json({ error: 'Email is required.' })
  if (await getUserByEmail(email)) return res.status(400).json({ error: 'That email already has an account.' })
  const { user: created, inviteToken } = await createUser({ email, name: name?.trim(), password, role })
  res.json({ user: created, inviteLink: inviteToken ? `${baseUrl(req)}/invite/${inviteToken}` : null })
})

// Rename, reset a password, or move between the two system roles. Promoting to
// admin drops every workspace membership the account had (server/users.js).
app.put('/api/admin/users/:id', async (req, res) => {
  const target = await userRow(req.params.id)
  if (!target) return res.status(404).json({ error: 'User not found' })
  const { name, password, role } = req.body || {}
  if (role !== undefined && !SYSTEM_ROLES.includes(role)) return res.status(400).json({ error: "Role must be 'admin' or 'user'." })
  if (role === 'user' && target.role === 'admin' && await countAdmins() <= 1) {
    return res.status(400).json({ error: 'The instance needs at least one admin.' })
  }
  // Promoting drops every workspace membership (an admin holds none), so it
  // would orphan any workspace this account is the last owner of. Same refusal
  // as deleting them — reassign ownership first.
  if (role === 'admin' && target.role !== 'admin') {
    const orphaned = await listUserSoleOwnerships(req.params.id)
    if (orphaned.length) {
      return res.status(409).json({
        error: `This account is the only owner of ${orphaned
          .map((w) => w.name)
          .join(', ')}. An instance admin holds no workspace access, so assign another owner first.`,
        workspaces: orphaned,
      })
    }
  }
  await updateUser(req.params.id, { name: name?.trim(), password })
  if (role !== undefined && role !== target.role) await setSystemRole(req.params.id, role)
  // A changed password or a changed role invalidates what the open sessions
  // were authorized for — make them sign in again.
  if (password || (role !== undefined && role !== target.role)) await destroyAuthSessionsForUser(req.params.id)
  res.json(await getUser(req.params.id))
})

// Lift a brute-force block: clears the failed-attempt counter and lets the
// account sign in again. The only way back in for a blocked account other than
// a password reset — an admin is never blocked indefinitely, so this can't be
// the door that locks itself.
app.post('/api/admin/users/:id/unblock', async (req, res) => {
  const target = await userRow(req.params.id)
  if (!target) return res.status(404).json({ error: 'User not found' })
  await unblockUser(req.params.id)
  res.json(await getUser(req.params.id))
})

app.delete('/api/admin/users/:id', async (req, res) => {
  const target = await userRow(req.params.id)
  if (!target) return res.status(404).json({ error: 'User not found' })
  if (req.params.id === authUser(req).id) return res.status(400).json({ error: "You can't delete your own account." })
  if (target.role === 'admin' && await countAdmins() <= 1) return res.status(400).json({ error: 'The instance needs at least one admin.' })
  // Refuse to orphan a workspace — reassign its ownership first, so the deletion
  // can never quietly leave a workspace nobody can manage.
  const orphaned = await listUserSoleOwnerships(req.params.id)
  if (orphaned.length) {
    return res.status(409).json({
      error: `This account is the only owner of ${orphaned.map((w) => w.name).join(', ')}. Assign another owner first.`,
      workspaces: orphaned,
    })
  }
  await destroyAuthSessionsForUser(req.params.id)
  await deleteUser(req.params.id)
  res.json({ ok: true })
})

// ---- Email (SMTP) ----
//
// The instance's one mail server — every email the app sends uses it. This is
// the admin-editable form of what used to be SMTP_* env only; the env vars
// still apply underneath, so an install that configures SMTP through
// docker-compose keeps working without an admin ever opening this page.
// Deliberately admin-only: workspaces no longer configure their own.

app.get('/api/admin/smtp', async (_req, res) => {
  // `env` is the layer under the saved config — shown so an admin can see what
  // docker-compose already configured (and pre-fill the form from it). Password
  // stripped, like every other config the API hands out.
  const env = envSmtp()
  res.json({
    smtp: await publicGlobalSmtp(),
    env: env ? { host: env.host, port: env.port || '587', secure: env.secure, user: env.user, from: env.from || env.user || '' } : null,
  })
})

app.put('/api/admin/smtp', async (req, res) => {
  const { host, port, secure, user, from, pass } = req.body || {}
  const saved = await saveGlobalSmtp({ host, port, secure, user, from, pass })
  res.json({ smtp: saved })
})

// Drop the saved config — the instance falls back to the SMTP_* env vars, or
// to no mail at all.
app.delete('/api/admin/smtp', async (_req, res) => {
  await clearGlobalSmtp()
  res.json({ ok: true, smtp: await publicGlobalSmtp() })
})

// Test the unsaved form values (body.smtp) or, with none, whatever is in
// effect instance-wide right now.
app.post('/api/admin/smtp/test', async (req, res) => {
  const { to, smtp: overrides } = req.body || {}
  const stored = await smtpConfig()
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
//
// `memberCount` rides along (one grouped query, not one per role) so the admin
// list can show who is affected by an edit — and why a delete would be refused.
app.get('/api/roles', async (req, res) => {
  if (!requireAuth(req, res)) return
  const usage = await roleUsageCounts()
  res.json(
    listRoles().map((r) => ({
      ...r,
      memberCount: usage[r.slug]?.members || 0,
      // Grants on tree nodes hold this role too, and also block a delete.
      grantCount: usage[r.slug]?.grants || 0,
      grantableOn: NODE_TYPES.filter((t) => roleGrantableOn(r.slug, t.type).ok).map((t) => t.type),
    }))
  )
})

// Workspaces the caller belongs to.
app.get('/api/workspaces', async (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  const rows = await membershipsOf(user.id)
  // Beta experiment flags + notification prefs ship in the list response (not
  // just the detail route) so nav-level gating and this settings panel don't
  // go stale after a save that only refreshes via listWorkspaces().
  // `permissions` rides along for the same reason: every nav item and button
  // gated on a capability would otherwise flicker until the detail route lands.
  res.json(
    await Promise.all(
      rows.map(async (r) => {
        const settings = safeJson(r.settings)
        return {
          id: r.id,
          name: r.name,
          role: r.role,
          permissions: [...(await permissionsIn(r.id, user.id))],
          createdAt: r.created_at,
          experiments: settings.experiments || {},
          notifications: settings.notifications || {},
        }
      })
    )
  )
})

// Create a workspace — the caller becomes its owner. Instance admins don't go
// through here (they'd become a member of it); they use POST /api/admin/workspaces,
// which names someone else as the owner.
app.post('/api/workspaces', async (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  if (isSystemAdmin(user)) {
    return res.status(403).json({ error: 'An instance admin cannot own a workspace. Create it from the admin area and assign an owner.' })
  }
  const { name } = req.body || {}
  if (!name?.trim()) return res.status(400).json({ error: 'Workspace name is required.' })
  const ws = await createWorkspaceRow(name.trim(), { ownerId: user.id })
  res.json({ ...ws, role: 'owner' })
})

app.get('/api/workspaces/:id', async (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  const ws = await workspaceForUser(req.params.id, user.id)
  if (!ws) return res.status(404).json({ error: 'Workspace not found' })
  const row = await getWorkspaceRow(req.params.id)
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
  if (ws.role === 'owner') ws.smtp = await publicSmtpConfig()
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
app.put('/api/workspaces/:id', async (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  // No `smtp` here on purpose: the mail server is instance-level (admin-only).
  // An older client still sending one is ignored rather than rejected.
  const { name, experiments, notifications, sessions } = req.body || {}
  const needsManage = name?.trim() || experiments || sessions
  if (needsManage && !(await requirePermission(req, res, req.params.id, 'workspace.manage'))) return
  if (notifications && !(await requirePermission(req, res, req.params.id, 'notifications.manage'))) return
  if (!needsManage && !notifications && !(await isMember(req.params.id, user.id))) return res.status(403).json({ error: 'Forbidden' })

  const row = await getWorkspaceRow(req.params.id)
  if (!row) return res.status(404).json({ error: 'Workspace not found' })
  if (name?.trim()) await meta().workspaces.update({ where: { id: req.params.id }, data: { name: name.trim() } })
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
    await meta().workspaces.update({ where: { id: req.params.id }, data: { settings: JSON.stringify(settings) } })
  }
  res.json({ ok: true })
})

// Delete a workspace and everything scoped to it. Never the caller's last one.
app.delete('/api/workspaces/:id', async (req, res) => {
  const user = await requirePermission(req, res, req.params.id, 'workspace.delete')
  if (!user) return
  const mine = (await membershipsOf(user.id)).length
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
  for (const conn of (await listConnections()).filter((c) => c.workspaceId === workspaceId)) {
    db.releaseConnection(conn)
    await endAllConnectionSessions(conn.id)
  }
  // The workspace's whole subtree goes with it — deleteWorkspaceCascade does it
  // inside the same transaction as the rest of the metadata.
  return await deleteWorkspaceCascade(workspaceId)
}

// ---- Resource tree ----
//
// One hierarchy of every addressable thing on the instance, and the place a role
// is granted. Application → Workspace → {Team, Group} → {Connection, Storage} →
// {Dashboard, Workflow}. See server/resource-tree.js for how a grant resolves.
//
// Authorization here is the tree answering about itself: what you may do to a
// node is resolved *at* that node, so the owner of a group can reorganise and
// grant inside it without holding anything at workspace level. An instance admin
// passes because the application root is theirs.

// May the caller do `permission` at this node? Returns the node, or null having
// already sent the response — the same shape as the guards in server/auth.js.
const requireNode = async (req, res, nodeId, permission) => {
  const user = requireAuth(req, res)
  if (!user) return null
  const node = await getNode(nodeId)
  if (!node) {
    res.status(404).json({ error: 'Node not found' })
    return null
  }
  if (isSystemAdmin(user)) return node
  if (!permission) {
    // A read: seeing the node at all is the permission.
    if (!(await visibleTree(user)).some((n) => n.id === node.id)) {
      res.status(403).json({ error: 'Forbidden' })
      return null
    }
    return node
  }
  if (!(await permissionsAtNode(node, user.id)).has(permission)) {
    res.status(403).json({ error: 'You do not have permission to do that.', permission })
    return null
  }
  return node
}

// The whole tree the caller can see, flat — the client nests it. Connection nodes
// carry `canOpen` because visibility and data access are different questions:
// the tree shows you a connection exists, `connection_access` decides whether you
// may open it.
app.get('/api/resource-tree', async (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  try {
    const counts = await memberCounts()
    const admin = isSystemAdmin(user)
    const nodes = await Promise.all((await visibleTree(user)).map(async (n) => ({
      ...n,
      owned: !!n.ownerId && n.ownerId === user.id,
      // Groups are principals, so their size is part of reading the tree — it is
      // how many people a grant to this group actually reaches.
      memberCount: n.kind === 'group' ? counts.get(n.id) || 0 : undefined,
      canOpen: n.type === 'connection' ? await userCanAccessConnection(await getConnection(n.resourceId), user.id) : undefined,
      // Whether the caller may reorganise *here*: file a new group inside a
      // group, and re-file this node somewhere else. Resolved at the node, like
      // every other permission, so the tree can offer both exactly where the
      // request would succeed instead of finding out by being refused. Answered
      // for resources too — a connection is the thing you most often move, and
      // the move guard asks at the node being moved, not at its parent.
      canOrganise: admin || (await permissionsAtNode(n, user.id)).has('resources.organise'),
    })))
    res.json(nodes)
  } catch (error) {
    console.error('resource-tree error:', error.message)
    res.json([])
  }
})

// What the tree is made of, and which roles may be granted where — so the grant
// editor never offers a choice the server would refuse.
app.get('/api/resource-tree/catalog', async (req, res) => {
  if (!requireAuth(req, res)) return
  res.json({
    nodeTypes: NODE_TYPES,
    roles: listRoles().map((r) => ({
      slug: r.slug,
      name: r.name,
      description: r.description,
      builtin: r.builtin,
      permissions: r.permissions,
      appliesTo: r.appliesTo,
      grantableOn: NODE_TYPES.filter((t) => roleGrantableOn(r.slug, t.type).ok).map((t) => t.type),
    })),
  })
})

/**
 * Who reaches this node — with the data-access answer attached where there is
 * one to give.
 *
 * `peopleAtNode` resolves *permissions*: grants up the chain, inheritance, group
 * rosters. On a connection that is only half the question, because opening a
 * database is not a permission (CLAUDE.md) — it is `userCanAccessConnection`,
 * which also reads membership, where the connection is filed and its access
 * list. Someone holding Member on the workspace therefore reaches every
 * connection node in it while being able to open none of them.
 *
 * The two answers are joined here rather than in `resource-tree.js` because that
 * module sits *below* `auth.js` in the dependency order and cannot see
 * `userCanAccessConnection`. Same reason, and the same `canOpen` field, as the
 * tree route above.
 */
const resolvedPeople = async (node) => {
  const people = await peopleAtNode(node)
  if (node.type !== 'connection') return people
  const conn = await getConnection(node.resourceId)
  return Promise.all(people.map(async (p) => ({ ...p, canOpen: await userCanAccessConnection(conn, p.userId) })))
}

// One node in full: where it sits, what's in it, who has been granted what, and
// what the caller themselves may do here.
app.get('/api/resource-tree/:id', async (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  const node = await requireNode(req, res, req.params.id, null)
  if (!node) return
  const mine = isSystemAdmin(user) ? [...PERMISSION_KEYS] : [...await permissionsAtNode(node, user.id)]

  // The tree already decided what this person may see; the detail payload has to
  // give the same answer, because `childrenOf` is the raw hierarchy. At the
  // application root that is *every workspace on the instance* — which a caller
  // reaches whenever a node they do hold something in sits underneath it.
  const seen = await visibleTree(user)
  const visible = new Set(seen.map((n) => n.id))
  // Scaffolding: in the payload only so what's underneath has a path to the root.
  // They hold nothing here, so who else was granted what — and who is in it — is
  // not theirs to read.
  const context = !!seen.find((n) => n.id === node.id)?.context

  res.json({
    node,
    context,
    ancestors: (await chainOf(node)).slice(0, -1).filter((a) => visible.has(a.id)),
    children: (await childrenOf(node.id)).filter((c) => visible.has(c.id)),
    grants: context ? [] : await listGrants(node.id),
    members: node.kind === 'group' && !context ? await listNodeMembers(node.id) : undefined,
    // Everyone who can actually reach this node, and why. `grants` is only what
    // was granted *here*; this resolves the ancestors, the inherited grants and
    // the group rosters too, so access the node never mentions cannot hide. On a
    // connection each person also carries `canOpen` — see `resolvedPeople`.
    // Blanked for scaffolding for the same reason grants are: they hold nothing
    // here, so who else does is not theirs to read.
    people: context ? [] : await resolvedPeople(node),
    permissions: mine,
    owner: node.ownerId ? publicUser(await userRow(node.ownerId)) : null,
  })
})

// Create a group — the one node type made by hand. Everything else appears
// because its resource was created.
app.post('/api/resource-tree/:id/groups', async (req, res) => {
  const parent = await requireNode(req, res, req.params.id, 'resources.organise')
  if (!parent) return
  // You own what you create — but only inside a subtree you already own, where
  // ownership is yours by cascade anyway and writing it down grants nothing new.
  // Ungated, `resources.organise` alone would be enough to mint a group you own
  // and move a connection into it, inheriting every permission on that
  // connection: the move guard checks both ends, and both ends would be legal.
  const caller = authUser(req)
  const ownerId = req.body?.ownerId || (await ownsNode(parent, caller.id) ? caller.id : null)
  const result = await createGroupNode(parent.id, req.body?.name, { ownerId })
  if (result.error) return res.status(400).json({ error: result.error })
  res.json(result.node)
})

// Rename a node. Mirrored nodes are renamed by their own resource's route, so
// this is refused for them rather than letting the two drift.
app.put('/api/resource-tree/:id', async (req, res) => {
  const node = await requireNode(req, res, req.params.id, 'resources.organise')
  if (!node) return
  if (!CUSTOM_NODE_TYPES.includes(node.type)) {
    return res.status(400).json({ error: `Rename the ${node.type} itself — its node follows automatically.` })
  }
  const result = await renameNode(node.id, req.body?.name)
  if (result.error) return res.status(400).json({ error: result.error })
  res.json(result.node)
})

// Re-file a node under a different group. Needs `resources.organise` at both
// ends: moving a connection out of a group you control and into one you don't
// would otherwise be a way to grant yourself access to it.
app.put('/api/resource-tree/:id/move', async (req, res) => {
  const node = await requireNode(req, res, req.params.id, 'resources.organise')
  if (!node) return
  const target = await requireNode(req, res, req.body?.parentId, 'resources.organise')
  if (!target) return
  // Re-filing a *connection* is a change to who may open the database, because a
  // group's roster can use what is filed under it (server/auth.js
  // `userCanAccessConnection`). `resources.organise` alone would otherwise be a
  // way to read every database in the workspace: move them one by one into a
  // group you are on the roster of. So moving one asks the same question its own
  // routes ask — manage every connection here, or own this one. Tidying the tree
  // still moves groups and everything else freely.
  const caller = authUser(req)
  if (node.type === 'connection' && !isSystemAdmin(caller)) {
    const conn = await getConnection(node.resourceId)
    if (conn && conn.ownerId !== caller.id && !(await permissionsAtNode(node, caller.id)).has('connections.manage')) {
      return res.status(403).json({ error: 'You need to own this connection to move it.' })
    }
  }
  const result = await moveNode(node.id, target.id)
  if (result.error) return res.status(400).json({ error: result.error })
  res.json(result.node)
})

// Hand a node over. Ownership cascades, so this is the strongest thing the tree
// can do — only the current owner (who resolves to every permission here) or an
// instance admin can.
app.put('/api/resource-tree/:id/owner', async (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  const node = await getNode(req.params.id)
  if (!node) return res.status(404).json({ error: 'Node not found' })
  const ownsIt = await ownsNode(node, user.id)
  if (!isSystemAdmin(user) && !ownsIt) return res.status(403).json({ error: 'Only the owner can hand this over.' })

  const ownerId = req.body?.ownerId || null
  if (ownerId) {
    const target = await userRow(ownerId)
    if (!target) return res.status(404).json({ error: 'User not found' })
    // An instance admin holds no membership anywhere by design; making one the
    // owner of a workspace node would hand them the data access that rule exists
    // to withhold.
    if (target.role === 'admin' && node.type !== 'application') {
      return res.status(400).json({ error: 'An instance admin cannot own a workspace resource.' })
    }
    if (node.workspaceId && !(await isMember(node.workspaceId, ownerId))) {
      return res.status(400).json({ error: 'The new owner must be a member of this workspace.' })
    }
  }
  res.json(await setNodeOwner(node.id, ownerId))
})

// Delete a group. What was filed inside it moves up rather than disappearing —
// the resources still exist.
app.delete('/api/resource-tree/:id', async (req, res) => {
  const node = await requireNode(req, res, req.params.id, 'resources.organise')
  if (!node) return
  if (!CUSTOM_NODE_TYPES.includes(node.type)) {
    return res.status(400).json({ error: `Delete the ${node.type} itself — its node goes with it.` })
  }
  // A node is deletable only when nothing is under it: re-filing what it held is
  // the user's call, not a silent reparent they never asked for. It also settles
  // by construction what `reparent` was there to prevent — a resource left with
  // no node, invisible in the tree and unanswerable by the resolver.
  const inside = await childrenOf(node.id)
  if (inside.length) {
    return res.status(409).json({
      error: `Move or delete the ${inside.length} item${inside.length === 1 ? '' : 's'} inside this group first.`,
      children: inside.map((n) => ({ id: n.id, name: n.name, type: n.type })),
    })
  }
  const result = await deleteNode(node.id)
  if (result.error) return res.status(400).json({ error: result.error })
  res.json({ ok: true })
})

// ---- Grants on a node ----

app.get('/api/resource-tree/:id/grants', async (req, res) => {
  const node = await requireNode(req, res, req.params.id, null)
  if (!node) return
  res.json(await listGrants(node.id))
})

// Give a person or group a role here. The role's requirement criteria decide
// whether it may be granted at this node type at all (server/permissions.js).
app.post('/api/resource-tree/:id/grants', async (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  const node = await requireNode(req, res, req.params.id, 'resources.grant')
  if (!node) return
  const { principalType, principalId, roleSlug, inherit } = req.body || {}
  const result = await addGrant(node.id, {
    principalType,
    principalId,
    roleSlug,
    inherit: inherit !== false,
    createdBy: user.id,
  })
  if (result.error) return res.status(400).json({ error: result.error })
  res.json(result.grant)
})

app.delete('/api/resource-tree/:id/grants/:grantId', async (req, res) => {
  const node = await requireNode(req, res, req.params.id, 'resources.grant')
  if (!node) return
  await removeGrant(req.params.grantId)
  res.json({ ok: true })
})

// ---- Membership: who is inside a group ----
//
// Governed by `teams.manage`, deliberately NOT by `resources.organise`. Adding
// someone to a group is granting them access — every grant naming that group
// reaches them the moment they are in it — and none of that shows up on the
// grant list of the node they just reached. Tidying the tree must not carry that
// power with it.

app.get('/api/resource-tree/:id/members', async (req, res) => {
  const node = await requireNode(req, res, req.params.id, null)
  if (!node) return
  if (node.kind !== 'group') return res.status(400).json({ error: 'Only a group holds people.' })
  res.json(await listNodeMembers(node.id))
})

// A workspace's roster *is* its membership, so it answers to `members.manage`;
// every other group's roster answers to `teams.manage`. Two capabilities, kept
// separate on purpose: staffing a folder and admitting someone to the workspace
// are different powers, and a role may carry one without the other.
const rosterPermission = (node) => (node.type === 'workspace' ? 'members.manage' : 'teams.manage')

app.post('/api/resource-tree/:id/members', async (req, res) => {
  const node = await requireNode(req, res, req.params.id, null)
  if (!node) return
  if (!(await requireNode(req, res, req.params.id, rosterPermission(node)))) return
  const userId = req.body?.userId
  if (!userId) return res.status(400).json({ error: 'userId is required.' })
  const target = await userRow(userId)
  if (!target) return res.status(404).json({ error: 'User not found' })
  // An instance admin holds no workspace membership by design — that is what
  // keeps instance administration away from workspace data.
  if (isSystemAdmin(target)) return res.status(400).json({ error: 'An instance admin cannot belong to a workspace.' })
  // A group inside a workspace can only staff itself from that workspace's
  // members. The workspace node is the exception: its roster is where membership
  // begins, so requiring membership first would be circular.
  if (node.type !== 'workspace' && node.workspaceId && !(await isMember(node.workspaceId, userId))) {
    return res.status(400).json({ error: 'That person is not a member of this workspace.' })
  }
  if (node.type === 'workspace') {
    // Goes through the workspace module so the roster and the membership's grant
    // are written together, exactly as an invite would.
    await addWorkspaceMember(node.resourceId, userId, 'member')
    return res.json({ ok: true })
  }
  const result = await addNodeMember(node.id, userId)
  if (result.error) return res.status(400).json({ error: result.error })
  res.json({ ok: true })
})

app.delete('/api/resource-tree/:id/members/:userId', async (req, res) => {
  const node = await requireNode(req, res, req.params.id, null)
  if (!node) return
  const user = await requireNode(req, res, req.params.id, rosterPermission(node))
  if (!user) return
  if (node.type === 'workspace') {
    // Removing a workspace member is the full cascade (their grants, their group
    // seats, anything they owned inside), and it must not strand the workspace.
    if (req.params.userId === authUser(req).id) return res.status(400).json({ error: "You can't remove yourself." })
    const role = await memberRole(node.resourceId, req.params.userId)
    if (role && isOwnerRole(role) && await countOwners(node.resourceId) <= 1) {
      return res.status(400).json({ error: 'The workspace needs at least one owner.' })
    }
    await removeWorkspaceMember(node.resourceId, req.params.userId)
    return res.json({ ok: true })
  }
  await removeNodeMember(node.id, req.params.userId)
  res.json({ ok: true })
})

// ---- Members ----

// List a workspace's members (any member can view).
app.get('/api/workspaces/:id/members', async (req, res) => {
  const user = await requireMember(req, res, req.params.id)
  if (!user) return
  res.json(await listWorkspaceMembers(req.params.id))
})

// Move a member to a different role. Any role in the instance catalog is valid;
// a workspace can have any number of owners but never zero, and an instance
// admin can't be given a seat at all.
app.put('/api/workspaces/:id/members/:userId', async (req, res) => {
  const user = await requirePermission(req, res, req.params.id, 'members.manage')
  if (!user) return
  const role = req.body?.role
  if (!roleExists(role)) return res.status(400).json({ error: 'Unknown role.' })
  const current = await memberRole(req.params.id, req.params.userId)
  if (!(await isMember(req.params.id, req.params.userId))) return res.status(404).json({ error: 'Member not found' })
  const target = await userRow(req.params.userId)
  if (isSystemAdmin(target)) {
    return res.status(400).json({ error: 'An instance admin cannot belong to a workspace.' })
  }
  // "Owner" is whoever holds workspace.manage — so this catches moving the last
  // one to any role that doesn't, not just to the built-in 'member'.
  if (isOwnerRole(current) && !isOwnerRole(role) && await countOwners(req.params.id) <= 1) {
    return res.status(400).json({ error: 'The workspace needs at least one owner.' })
  }
  await setWorkspaceMemberRole(req.params.id, req.params.userId, role)
  res.json({ ok: true, role })
})

// Invite a member by email (owner). Existing accounts are added directly;
// unknown/pending emails get a pending account + an invite link. The link is
// always returned so it works without SMTP.
app.post('/api/workspaces/:id/members', async (req, res) => {
  const user = await requirePermission(req, res, req.params.id, 'members.manage')
  if (!user) return
  const email = (req.body?.email || '').trim().toLowerCase()
  if (!email) return res.status(400).json({ error: 'Email is required.' })
  // Invite straight into a role rather than always landing on 'member' and
  // needing a second call to move them.
  const role = req.body?.role || 'member'
  if (!roleExists(role)) return res.status(400).json({ error: 'Unknown role.' })

  let target = await getUserByEmail(email)
  if (target && await isMember(req.params.id, target.id)) {
    return res.status(400).json({ error: 'That person is already a member.' })
  }
  if (isSystemAdmin(target)) {
    return res.status(400).json({ error: 'That account administers the instance and cannot join a workspace.' })
  }

  let inviteLink = null
  if (!target) {
    // Brand-new account: 'user' is the system role (a plain, non-admin account);
    // what they may do here is the workspace role set just below.
    const { user: created, inviteToken } = await createUser({ email, name: email, inviteWorkspaceId: req.params.id })
    target = { id: created.id, username: email, status: 'pending' }
    inviteLink = `${baseUrl(req)}/invite/${inviteToken}`
  } else if (target.status === 'pending') {
    inviteLink = `${baseUrl(req)}/invite/${await issueInviteToken(target.id, req.params.id)}`
  }

  await addWorkspaceMember(req.params.id, target.id, role)

  // Email the invite link when SMTP is configured — non-fatal, link is returned regardless.
  let emailed = false
  if (inviteLink) {
    const ws = await getWorkspaceRow(req.params.id)
    const cfg = await smtpConfig()
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
app.delete('/api/workspaces/:id/members/:userId', async (req, res) => {
  const user = await requirePermission(req, res, req.params.id, 'members.manage')
  if (!user) return
  if (req.params.userId === user.id) return res.status(400).json({ error: "You can't remove yourself." })
  const role = await memberRole(req.params.id, req.params.userId)
  if (!(await isMember(req.params.id, req.params.userId))) return res.status(404).json({ error: 'Member not found' })
  if (isOwnerRole(role) && await countOwners(req.params.id) <= 1) {
    return res.status(400).json({ error: 'The workspace needs at least one owner.' })
  }
  // Drops the membership plus everything it granted (group seats, individual
  // connection grants).
  await removeWorkspaceMember(req.params.id, req.params.userId)
  // Clean up a pending user that no longer belongs to any workspace.
  const left = (await membershipsOf(req.params.userId)).length
  const u = await userRow(req.params.userId)
  if (left === 0 && u?.status === 'pending') await meta().users.deleteMany({ where: { id: req.params.userId } })
  res.json({ ok: true })
})

// ============================================================================
// Connections (scoped to a workspace the caller belongs to)
// ============================================================================

// The connections in a workspace this caller may open — what every
// workspace-wide listing (connections, dashboards, workflows) is built from.
const openableConnections = async (workspaceId, userId) =>
  filterAsync(
    (await listConnections()).filter((c) => c.workspaceId === workspaceId),
    (c) => userCanAccessConnection(c, userId)
  )

// List connections for a workspace.
app.get('/api/connections', async (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  const workspaceId = req.query.workspace
  if (!workspaceId) return res.json([])
  if (!(await isMember(workspaceId, user.id))) return res.status(403).json({ error: 'Forbidden' })
  res.json(await openableConnections(workspaceId, user.id))
})

// May this caller tunnel a probe through `gatewayId`? A gateway is a way into
// the workspace's private network, so it takes a signed-in caller who could
// define a connection there — `connections.create`, or managing the existing
// connection the form is editing. Answers false after replying.
async function mayProbeThroughGateway(req, res, gatewayId) {
  const user = requireAuth(req, res)
  if (!user) return false
  const gateway = await getSshGateway(gatewayId)
  if (!gateway || !(await isMember(gateway.workspaceId, user.id))) {
    res.status(403).json({ ok: false, message: 'That SSH host is not available to you.' })
    return false
  }
  const editing = req.body.id && await getConnection(req.body.id)
  const managesEdited =
    editing && editing.workspaceId === gateway.workspaceId && (editing.ownerId === user.id || await can(gateway.workspaceId, user.id, 'connections.manage'))
  if (!managesEdited && !(await can(gateway.workspaceId, user.id, 'connections.create'))) {
    res.status(403).json({ ok: false, message: 'You need to be able to add connections to test one through an SSH host.' })
    return false
  }
  return true
}

// Probe an unsaved connection form.
app.post('/api/test-connection', async (req, res) => {
  if (req.body?.sshGatewayId && !(await mayProbeThroughGateway(req, res, req.body.sshGatewayId))) return
  try {
    res.json(await db.testConnection(req.body))
  } catch (error) {
    res.status(error.status || 200).json({ ok: false, message: error.message })
  }
})

// Add a connection to a workspace. Defining one is `connections.create`: the
// credentials it carries are the workspace's, not something anyone who can use a
// database gets to point somewhere else.
app.post('/api/connections', async (req, res) => {
  const workspaceId = req.body.workspaceId
  if (!workspaceId) return res.status(403).json({ error: 'Forbidden' })
  const user = await requirePermission(req, res, workspaceId, 'connections.create')
  if (!user) return
  try {
    await assertGatewayForWorkspace(req.body.sshGatewayId, workspaceId)
  } catch (error) {
    return fail(res, error)
  }
  // Default the owner to the creating user (unless one was explicitly provided).
  const conn = { ...req.body, id: randomUUID(), workspaceId, ownerId: req.body.ownerId || user.id }
  await saveConnection(conn)
  // File it in the resource tree. `parentId` lets the caller drop it straight
  // into a group they organise with; without one it lands under the workspace.
  await createResourceNode('connection', conn.id, {
    parentId: req.body.parentNodeId || null,
    name: conn.name,
    ownerId: conn.ownerId,
    workspaceId,
  })
  res.json(await getConnection(conn.id))
})

// Import an export document as a brand-new connection in `workspaceId`.
// Mounted above the `/api/connections/:id` guard so "import" isn't read as an id.
app.post('/api/connections/import', async (req, res) => {
  const { workspaceId, document, name, settings } = req.body || {}
  if (!workspaceId) return res.status(403).json({ error: 'Forbidden' })
  const user = await requirePermission(req, res, workspaceId, 'connections.create')
  if (!user) return
  try {
    const imported = await importConnectionDoc(document, { workspaceId, ownerId: user.id, name, settings })
    await createResourceNode('connection', imported.id, { name: imported.name, ownerId: user.id, workspaceId })
    res.json(imported)
  } catch (error) {
    fail(res, error)
  }
})

// ---- Storage destinations (S3-compatible, workspace-scoped) ----
app.get('/api/storages', async (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  const workspaceId = req.query.workspace
  if (!workspaceId) return res.json([])
  if (!(await isMember(workspaceId, user.id))) return res.status(403).json({ error: 'Forbidden' })
  res.json(await listStorageRows(workspaceId))
})

// Create a storage destination — it holds credentials for somewhere the
// workspace's data gets written, so it carries its own permission.
app.post('/api/storages', async (req, res) => {
  const body = req.body || {}
  if (!body.workspaceId) return res.status(403).json({ error: 'Forbidden' })
  const user = await requirePermission(req, res, body.workspaceId, 'storage.manage')
  if (!user) return
  if (!body.name?.trim() || !body.bucket?.trim()) return res.status(400).json({ error: 'A name and bucket are required' })
  const dest = await createStorage(body.workspaceId, body)
  await createResourceNode('storage', dest.id, { name: dest.name, workspaceId: body.workspaceId })
  res.json(dest)
})

// Guard every per-storage route: reading needs membership, changing needs
// `storage.manage`.
app.use('/api/storages/:sid', async (req, res, next) => {
  const user = requireAuth(req, res)
  if (!user) return
  const dest = await getStorage(req.params.sid)
  if (!dest) return res.status(404).json({ error: 'Storage destination not found' })
  if (!(await isMember(dest.workspaceId, user.id))) return res.status(403).json({ error: 'Forbidden' })
  if (req.method !== 'GET' && !(await requirePermission(req, res, dest.workspaceId, 'storage.manage'))) return
  next()
})

app.put('/api/storages/:sid', async (req, res) => {
  const merged = { ...await getStorage(req.params.sid), ...(req.body || {}) }
  if (!merged.name?.trim() || !merged.bucket?.trim()) return res.status(400).json({ error: 'A name and bucket are required' })
  await renameResourceNode('storage', req.params.sid, merged.name.trim())
  res.json(await updateStorage(req.params.sid, merged))
})

app.delete('/api/storages/:sid', async (req, res) => {
  if (await isStorageInUse(req.params.sid)) {
    return res.status(409).json({ error: 'This storage destination is used by a workflow and cannot be deleted.' })
  }
  await deleteStorage(req.params.sid)
  await deleteResourceNode('storage', req.params.sid)
  res.json({ ok: true })
})

app.post('/api/storages/:sid/test', async (req, res) => {
  res.json(await testStorage(await getStorage(req.params.sid)))
})

// ---- SSH keys + gateways (workspace-scoped) ----
// Members can see what exists (a connection form lists the gateways, a key's
// public half is meant to be shared); creating, changing and deleting either is
// `ssh.manage`. Private keys and passwords never leave the server.
app.get('/api/ssh/keys', async (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  const workspaceId = req.query.workspace
  if (!workspaceId) return res.json([])
  if (!(await isMember(workspaceId, user.id))) return res.status(403).json({ error: 'Forbidden' })
  res.json(await listSshKeys(workspaceId))
})

app.post('/api/ssh/keys', async (req, res) => {
  const body = req.body || {}
  if (!body.workspaceId) return res.status(403).json({ error: 'Forbidden' })
  const user = await requirePermission(req, res, body.workspaceId, 'ssh.manage')
  if (!user) return
  try {
    res.json(await createSshKey(body.workspaceId, body, user.id))
  } catch (error) {
    fail(res, error)
  }
})

app.use('/api/ssh/keys/:kid', async (req, res, next) => {
  const user = requireAuth(req, res)
  if (!user) return
  const key = await getSshKey(req.params.kid)
  if (!key) return res.status(404).json({ error: 'SSH key not found' })
  if (!(await isMember(key.workspaceId, user.id))) return res.status(403).json({ error: 'Forbidden' })
  if (req.method !== 'GET' && !(await requirePermission(req, res, key.workspaceId, 'ssh.manage'))) return
  next()
})

app.put('/api/ssh/keys/:kid', async (req, res) => {
  try {
    res.json(await renameSshKey(req.params.kid, req.body?.name))
  } catch (error) {
    fail(res, error)
  }
})

app.delete('/api/ssh/keys/:kid', async (req, res) => {
  const gateways = await sshKeyGateways(req.params.kid)
  if (gateways.length) {
    return res.status(409).json({ error: `This key is used by ${gateways.map((g) => `"${g.name}"`).join(', ')}. Point those SSH hosts at another key first.` })
  }
  await deleteSshKey(req.params.kid)
  res.json({ ok: true })
})

app.get('/api/ssh/gateways', async (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  const workspaceId = req.query.workspace
  if (!workspaceId) return res.json([])
  if (!(await isMember(workspaceId, user.id))) return res.status(403).json({ error: 'Forbidden' })
  res.json(await listSshGateways(workspaceId))
})

app.post('/api/ssh/gateways', async (req, res) => {
  const body = req.body || {}
  if (!body.workspaceId) return res.status(403).json({ error: 'Forbidden' })
  const user = await requirePermission(req, res, body.workspaceId, 'ssh.manage')
  if (!user) return
  try {
    res.json(await createSshGateway(body.workspaceId, body))
  } catch (error) {
    fail(res, error)
  }
})

app.use('/api/ssh/gateways/:gid', async (req, res, next) => {
  const user = requireAuth(req, res)
  if (!user) return
  const gateway = await getSshGateway(req.params.gid)
  if (!gateway) return res.status(404).json({ error: 'SSH host not found' })
  if (!(await isMember(gateway.workspaceId, user.id))) return res.status(403).json({ error: 'Forbidden' })
  // Testing logs in to the gateway with the workspace's credentials, so it is
  // a manager's action even though it changes nothing.
  if (req.method !== 'GET' && !(await requirePermission(req, res, gateway.workspaceId, 'ssh.manage'))) return
  next()
})

app.put('/api/ssh/gateways/:gid', async (req, res) => {
  let gateway
  try {
    gateway = await updateSshGateway(req.params.gid, req.body || {})
  } catch (error) {
    return fail(res, error)
  }
  // Every connection tunneling through it holds a tunnel (and pools) built from
  // the old settings; drop them so the next query dials the new ones.
  for (const conn of await connectionsUsingGateway(req.params.gid)) {
    db.releaseConnection(conn)
    await endAllConnectionSessions(conn.id)
  }
  res.json(gateway)
})

app.delete('/api/ssh/gateways/:gid', async (req, res) => {
  const users = await connectionsUsingGateway(req.params.gid)
  if (users.length) {
    return res.status(409).json({ error: `This SSH host is used by ${users.map((c) => `"${c.name}"`).join(', ')}. Switch those connections to another SSH host (or none) first.` })
  }
  await deleteSshGateway(req.params.gid)
  res.json({ ok: true })
})

app.post('/api/ssh/gateways/:gid/test', async (req, res) => {
  res.json(await testSshGateway(await getSshGateway(req.params.gid)))
})

// Guard every per-connection route: caller must be able to access the
// connection. One mount covers PUT/DELETE /:id and all /:id/* data routes.
app.use('/api/connections/:id', async (req, res, next) => {
  const user = requireAuth(req, res)
  if (!user) return
  const conn = await getConnection(req.params.id)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })
  if (conn.workspaceId && !(await userCanAccessConnection(conn, user.id))) return res.status(403).json({ error: 'Forbidden' })
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
const requireConnectionOwner = async (req, res, what = 'change a connection') => {
  const conn = await getConnection(req.params.id)
  if (!conn) {
    res.status(404).json({ error: 'Connection not found' })
    return null
  }
  const userId = authUser(req).id
  if (conn.workspaceId && conn.ownerId !== userId && !(await can(conn.workspaceId, userId, 'connections.manage'))) {
    res.status(403).json({ error: `You need to own this connection to ${what}.` })
    return null
  }
  return conn
}

// Update connection (owner).
app.put('/api/connections/:id', async (req, res) => {
  if (!(await requireConnectionOwner(req, res))) return
  const existing = await getConnection(req.params.id)
  if (!existing) return res.status(404).json({ error: 'Connection not found' })
  // The engine is fixed at creation: dashboards, workflows, saved queries and
  // the schema trail are all written for it, so changing it would leave them
  // pointing at a database that speaks something else.
  if (req.body.type && req.body.type !== existing.type) {
    return res.status(400).json({ error: 'A connection’s database type cannot be changed. Create a new connection instead.' })
  }
  const updated = { ...existing, ...req.body, id: req.params.id, type: existing.type }
  // A gateway from another workspace would borrow credentials the caller was
  // never given; the connection's workspace is the one that counts.
  if (updated.sshGatewayId !== existing.sshGatewayId) {
    try {
      await assertGatewayForWorkspace(updated.sshGatewayId, existing.workspaceId)
    } catch (error) {
      return fail(res, error)
    }
  }
  await saveConnection(updated)
  await renameResourceNode('connection', req.params.id, updated.name)

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
  const conn = await requireConnectionOwner(req, res)
  if (!conn) return

  db.releaseConnection(conn)
  await endAllConnectionSessions(req.params.id)

  await transaction(async () => {
    await deleteConnectionMetadata(req.params.id)
    // Takes the connection's node and everything filed under it (its dashboard
    // and workflow nodes), plus every grant made on any of them.
    await deleteResourceNode('connection', req.params.id)
  })
  res.json({ ok: true })
})

// Export this connection as one portable JSON document (see
// server/connection-transfer.js for what's in it). `?secrets=1` keeps the stored
// password — off by default, since the file usually leaves the instance.
// Owner-only: the document is the connection's definition, secrets aside.
app.get('/api/connections/:id/export', async (req, res) => {
  if (!(await requireConnectionOwner(req, res, 'export a connection'))) return
  const includeSecrets = ['1', 'true', 'yes'].includes(String(req.query.secrets || '').toLowerCase())
  const doc = await buildConnectionExport(req.params.id, { includeSecrets })
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
app.put('/api/connections/:id/owner', async (req, res) => {
  const conn = await getConnection(req.params.id)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })
  if (!conn.workspaceId) return res.status(400).json({ error: 'This connection does not belong to a workspace.' })
  if (!(await requirePermission(req, res, conn.workspaceId, 'connections.transfer'))) return

  const ownerId = req.body?.ownerId
  if (!ownerId) return res.status(400).json({ error: 'ownerId is required.' })
  if (!(await isMember(conn.workspaceId, ownerId))) return res.status(400).json({ error: 'That person is not a member of this workspace.' })
  if (isSystemAdmin(await userRow(ownerId))) return res.status(400).json({ error: 'An instance admin cannot own a connection.' })

  await saveConnection({ ...conn, ownerId })
  res.json(await getConnection(req.params.id))
})

// ---- Connection access (which groups/members may see this connection) ----
// Any user who passes the access guard can read the assignment; only a
// workspace owner can change it.
app.get('/api/connections/:id/access', async (req, res) => {
  res.json(await connectionAccess(req.params.id))
})

app.put('/api/connections/:id/access', async (req, res) => {
  if (!(await requireConnectionOwner(req, res, "change a connection's access list"))) return
  const groups = Array.isArray(req.body?.groups) ? req.body.groups : []
  const users = Array.isArray(req.body?.users) ? req.body.users : []
  await setConnectionAccess(req.params.id, { groups, users })
  res.json(await connectionAccess(req.params.id))
})

// ============================================================================
// Saved queries + folders (per connection)
// ============================================================================

app.get('/api/connections/:id/saved', async (req, res) => {
  const rows = await meta().saved_queries.findMany({ where: { connection_id: req.params.id }, orderBy: { ts: 'desc' } })
  // `layout` is the schema editor's diagram arrangement and only a schema draft
  // ever has one — a plain query row carries null, not an empty object, so the
  // editor can tell "never arranged" from "arranged into nothing".
  res.json(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      sql: r.sql,
      kind: r.kind || 'query',
      folderId: r.folder_id || null,
      layout: r.layout ? safeJson(r.layout) : null,
      ts: r.ts,
    }))
  )
})

// One of this connection's folders (optionally of one type), or null.
const findFolder = async (connectionId, folderId, type) =>
  folderId ? meta().folders.findFirst({ where: { id: folderId, connection_id: connectionId, ...(type ? { type } : null) } }) : null

app.get('/api/connections/:id/folders', async (req, res) => {
  const type = folderTypeOf(req.query.type)
  const rows = await meta().folders.findMany({ where: { connection_id: req.params.id, type }, orderBy: { ts: 'asc' } })
  res.json(await Promise.all(rows.map((r) => folderRow(req.params.id, type, r))))
})

app.post('/api/connections/:id/folders', async (req, res) => {
  const { name, parentId, color } = req.body || {}
  const type = folderTypeOf(req.body?.type)
  if (!name?.trim()) return res.status(400).json({ error: 'A folder name is required' })
  if (parentId) {
    const parent = await findFolder(req.params.id, parentId, type)
    if (!parent) return res.status(400).json({ error: 'Parent folder not found' })
    if ((await folderDepth(req.params.id, type, parentId)) >= FOLDER_TYPES[type].maxDepth)
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
  await meta().folders.create({
    data: { id: entry.id, connection_id: req.params.id, type: entry.type, name: entry.name, color: entry.color, parent_id: entry.parentId, ts: entry.ts },
  })
  res.json(type === 'table' ? { ...entry, tables: [] } : entry)
})

app.put('/api/connections/:id/folders/:fid', async (req, res) => {
  const body = req.body || {}
  const folder = await findFolder(req.params.id, req.params.fid)
  if (!folder) return res.status(404).json({ error: 'Not found' })
  const type = folderTypeOf(folder.type)
  const { name } = body
  const data = {}
  if (name != null) {
    if (!name.trim()) return res.status(400).json({ error: 'A folder name is required' })
    data.name = name.trim()
  }
  // color is explicitly settable (null clears it back to the default look).
  if ('color' in body) data.color = body.color || null
  // parentId is explicitly settable (null moves the folder to the root).
  if ('parentId' in body) {
    const parentId = body.parentId || null
    if (parentId) {
      if (parentId === req.params.fid) return res.status(400).json({ error: "A folder can't be its own parent" })
      const parent = await findFolder(req.params.id, parentId, type)
      if (!parent) return res.status(400).json({ error: 'Parent folder not found' })
      if (await folderHasAncestor(req.params.id, type, parentId, req.params.fid))
        return res.status(400).json({ error: "Can't move a folder into its own subfolder" })
      // The moved subtree's deepest leaf must still fit within the depth cap.
      const newDepth = (await folderDepth(req.params.id, type, parentId)) + (await folderHeight(req.params.id, type, req.params.fid))
      if (newDepth > FOLDER_TYPES[type].maxDepth)
        return res.status(400).json({ error: `Folders can only nest ${FOLDER_TYPES[type].maxDepth} levels deep` })
    }
    data.parent_id = parentId
  }
  if (!Object.keys(data).length) return res.status(400).json({ error: 'Nothing to update' })
  const { count } = await meta().folders.updateMany({ where: { id: req.params.fid, connection_id: req.params.id }, data })
  if (!count) return res.status(404).json({ error: 'Not found' })
  res.json({ ok: true })
})

app.delete('/api/connections/:id/folders/:fid', async (req, res) => {
  // Reparent the folder's contents up one level (to its own parent) rather than
  // deleting them: child folders and items move to the deleted folder's parent.
  const row = await findFolder(req.params.id, req.params.fid)
  const type = folderTypeOf(row?.type)
  const parentId = row?.parent_id || null
  const scope = { connection_id: req.params.id }
  await transaction(async () => {
    await meta().folders.updateMany({ where: { ...scope, parent_id: req.params.fid }, data: { parent_id: parentId } })
    // itemTable comes from the FOLDER_TYPES allowlist (via folderTypeOf), and each
    // one is also the name of its Prisma model.
    await meta()[FOLDER_TYPES[type].itemTable].updateMany({ where: { ...scope, folder_id: req.params.fid }, data: { folder_id: parentId } })
    // A connection_tables row only records membership, so "moved to the root" means
    // ungrouped — drop the row rather than leaving a folder-less mapping behind.
    if (type === 'table' && !parentId) await meta().connection_tables.deleteMany({ where: { ...scope, folder_id: null } })
    await meta().folders.deleteMany({ where: { ...scope, id: req.params.fid } })
  })
  res.json({ ok: true })
})

// Set (or clear) a table's folder. `folderId: null` ungroups the table;
// otherwise it's reassigned to that single folder (upsert — one folder per
// table). Table names are plain strings, so this works for any dialect.
app.put('/api/connections/:id/tables/:table/folder', async (req, res) => {
  const folderId = req.body?.folderId ?? null
  const table = req.params.table
  if (folderId === null) {
    await meta().connection_tables.deleteMany({ where: { connection_id: req.params.id, table_name: table } })
    return res.json({ ok: true })
  }
  const folder = await findFolder(req.params.id, folderId, 'table')
  if (!folder) return res.status(404).json({ error: 'Folder not found' })
  const now = Date.now()
  await meta().connection_tables.upsert({
    where: { connection_id_table_name: { connection_id: req.params.id, table_name: table } },
    create: { id: randomUUID(), connection_id: req.params.id, table_name: table, folder_id: folderId, ts: now },
    update: { folder_id: folderId, ts: now },
  })
  res.json({ ok: true })
})

// A saved *query* is nothing without its SQL, so it is required. A schema
// draft (`kind = 'schema'`) is not: it is a diagram whose staged DDL happens to
// be empty — you cleared the changes, or forked a copy before staging any — and
// refusing that is what left the editor unable to save a draft it had just
// emptied. Same split on the update below.
app.post('/api/connections/:id/saved', async (req, res) => {
  const { name, sql, kind, layout } = req.body || {}
  if (!name?.trim()) return res.status(400).json({ error: 'A name and SQL are required' })
  if ((kind || 'query') !== 'schema' && !sql?.trim()) return res.status(400).json({ error: 'A name and SQL are required' })
  const at = Date.now()
  const entry = {
    id: randomUUID(),
    name: name.trim(),
    sql: (sql || '').trim(),
    kind: kind || 'query',
    // Only a schema draft arranges a diagram; a query row has nothing to place.
    layout: schemaLayout(layout),
    // The audit trail (migration v20): a schema draft is workspace work, and
    // the Schema list names whoever started one. The creator is the last writer
    // too until someone else saves over it.
    createdBy: authUser(req).id,
    updatedBy: authUser(req).id,
    createdAt: at,
    ts: at,
  }
  await meta().saved_queries.create({
    data: {
      id: entry.id,
      connection_id: req.params.id,
      name: entry.name,
      sql: entry.sql,
      kind: entry.kind,
      layout: entry.layout ? JSON.stringify(entry.layout) : null,
      created_by: entry.createdBy,
      updated_by: entry.updatedBy,
      created_at: entry.createdAt,
      ts: entry.ts,
    },
  })
  res.json(entry)
})

app.put('/api/connections/:id/saved/:sid', async (req, res) => {
  const body = req.body || {}
  const { name, sql } = body
  // The row's own kind decides whether empty SQL is allowed, so read it first
  // rather than trusting a `kind` in the body — this is the same 404 the write
  // below would have produced, only reached before the validation.
  const row = await meta().saved_queries.findFirst({ where: { id: req.params.sid, connection_id: req.params.id }, select: { kind: true } })
  if (!row) return res.status(404).json({ error: 'Not found' })
  const data = {}
  if (name != null) {
    if (!name.trim()) return res.status(400).json({ error: 'A name is required' })
    data.name = name.trim()
  }
  if (sql != null) {
    if (!sql.trim() && row.kind !== 'schema') return res.status(400).json({ error: 'SQL is required' })
    data.sql = sql.trim()
  }
  // folderId is explicitly settable (null moves the query back to the root).
  if ('folderId' in body) data.folder_id = body.folderId || null
  // Saving the schema editor sends `sql` and `layout` together; a rename sends
  // neither. An explicit null forgets the arrangement.
  if ('layout' in body) {
    const layout = schemaLayout(body.layout)
    data.layout = layout ? JSON.stringify(layout) : null
  }
  if (!Object.keys(data).length) return res.status(400).json({ error: 'Nothing to update' })
  // Stamp the write. `ts` used to be set once, at insert, which made the Schema
  // list's "Updated 3 months ago" the *creation* date of a draft someone saved
  // this morning — and left "last updated by" nothing to hang off. Both move
  // together, so the name and the time always describe the same save. It also
  // reorders the saved list by last touched, which is what `/schemas/connection/:id`
  // means by "the draft to resume".
  data.ts = Date.now()
  data.updated_by = authUser(req).id
  const { count } = await meta().saved_queries.updateMany({ where: { id: req.params.sid, connection_id: req.params.id }, data })
  if (!count) return res.status(404).json({ error: 'Not found' })
  res.json({ ok: true })
})

app.delete('/api/connections/:id/saved/:sid', async (req, res) => {
  await meta().saved_queries.deleteMany({ where: { id: req.params.sid, connection_id: req.params.id } })
  res.json({ ok: true })
})

// ============================================================================
// Workflows (per connection)
// ============================================================================
// A workflow can be marked `protected` (undeletable) — `DELETE` 409s on it,
// everything else behaves like a normal workflow. Nothing currently sets this
// automatically (backups are a separate system — see the Backup section below).

// Every workflow in a workspace, in one list — what the home area's Workflow
// section shows. Membership gates seeing the workspace at all; each connection
// is then filtered by whether the caller may open it, so this can never show
// more than the per-connection routes below would.
app.get('/api/workspaces/:id/workflows', async (req, res) => {
  const user = await requireMember(req, res, req.params.id)
  if (!user) return
  const conns = await openableConnections(req.params.id, user.id)
  const byId = new Map(conns.map((c) => [c.id, c]))
  res.json(
    (await listWorkflowsForConnections([...byId.keys()])).map((w) => {
      const conn = byId.get(w.connectionId)
      return { ...w, connectionName: conn.name, connectionType: conn.type }
    })
  )
})

app.get('/api/connections/:id/workflows', async (req, res) => {
  res.json(await listConnectionWorkflows(req.params.id))
})

app.post('/api/connections/:id/workflows', async (req, res) => {
  try {
    res.json(await createWorkflow(req.params.id, req.body))
  } catch (error) {
    fail(res, error)
  }
})

app.get('/api/connections/:id/workflows/:wid', async (req, res) => {
  const workflow = await getWorkflow(req.params.id, req.params.wid)
  if (!workflow) return res.status(404).json({ error: 'Not found' })
  res.json(workflow)
})

app.put('/api/connections/:id/workflows/:wid', async (req, res) => {
  try {
    if (!(await updateWorkflow(req.params.id, req.params.wid, req.body))) return res.status(404).json({ error: 'Not found' })
    res.json({ ok: true })
  } catch (error) {
    fail(res, error)
  }
})

app.delete('/api/connections/:id/workflows/:wid', async (req, res) => {
  const result = await deleteWorkflow(req.params.id, req.params.wid)
  if (result === 'missing') return res.status(404).json({ error: 'Not found' })
  if (result === 'protected') return res.status(409).json({ error: 'This workflow is protected and cannot be deleted.' })
  res.json({ ok: true })
})

// Run a workflow — executes the posted graph (unsaved edits) or the stored
// one, and records the outcome in workflow_runs.
app.post('/api/connections/:id/workflows/:wid/run', async (req, res) => {
  const conn = await getConnection(req.params.id)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })
  let graph = req.body?.graph
  if (!graph) {
    const workflow = await getWorkflow(req.params.id, req.params.wid)
    if (!workflow) return res.status(404).json({ error: 'Not found' })
    graph = workflow.graph
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
app.get('/api/connections/:id/workflows/:wid/runs', async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200)
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0)
  const runs = await listWorkflowRuns(req.params.id, req.params.wid, { limit, offset })
  if (!runs) return res.status(404).json({ error: 'Not found' })
  res.json(runs)
})

app.get('/api/connections/:id/workflows/:wid/runs/:runId', async (req, res) => {
  const run = await getWorkflowRun(req.params.id, req.params.wid, req.params.runId)
  if (!run) return res.status(404).json({ error: 'Not found' })
  res.json(run)
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
  const workflow = await getWebhookWorkflow(req.params.wid)
  if (!workflow) return res.status(404).json({ error: 'Not found' })
  const graph = workflow.graph
  const hook = (graph?.nodes || []).find((n) => n.type === 'webhook')
  if (!hook) return res.status(404).json({ error: 'This workflow has no webhook trigger' })
  const expected = String(hook.data?.token || '')
  const provided = String(req.params.token || '')
  const ok =
    expected.length > 0 &&
    expected.length === provided.length &&
    timingSafeEqual(Buffer.from(expected), Buffer.from(provided))
  if (!ok) return res.status(401).json({ error: 'Invalid webhook token' })
  const conn = await getConnection(workflow.connectionId)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })
  // The request body seeds the trigger; query params are exposed too so simple
  // GET pings can pass data without a body.
  const input = { body: req.body ?? null, query: req.query || {}, headers: req.headers, method: req.method }
  const result = await executeAndRecord(workflow.id, workflow.connectionId, conn, graph, 'webhook', input)
  res.status(result.ok ? 200 : 500).json({ ok: result.ok, output: result.output, error: result.error || null })
})

// ============================================================================
// Dashboards (per connection)
// ============================================================================
// A dashboard is a name + one JSON config: { variables: [...], widgets: [...] }.
// The config shape is owned by the frontend (src/features/dashboard/types.ts);
// the server just stores and returns it, so it stays database-agnostic.
// Dashboards can live in a folder (folders table, type='dashboard').

// Every dashboard in a workspace, in one list — what the home area's Dashboard
// section shows. Mirrors the workspace-wide workflows route above: membership
// gates seeing the workspace at all, then each connection is filtered by whether
// the caller may open it, so this can never show more than the per-connection
// route below would.
//
// The config is summarised (widget/variable counts) rather than returned: the
// list only needs the shape of a dashboard, and a workspace's worth of full
// configs is a lot of JSON to send for a table nobody renders charts from.
app.get('/api/workspaces/:id/dashboards', async (req, res) => {
  const user = await requireMember(req, res, req.params.id)
  if (!user) return
  const conns = await openableConnections(req.params.id, user.id)
  res.json(await listDashboardsForConnections(conns))
})

/**
 * Resolve a row's audit ids to names — the one place "created by / last updated
 * by" turns into something renderable.
 *
 * Ids and names travel together (`createdBy` + `createdByName`) rather than as a
 * nested person: the list renders the name, and the id is what stays stable if a
 * display name changes. A name of `null` is a real answer — the account was
 * deleted, or the row predates the trail — and the UI shows it as unknown
 * rather than inventing an attribution.
 *
 * One query for the whole page, not one per row.
 */
const withAudit = async (rows) => {
  const people = await userSummaries(rows.flatMap((r) => [r.createdBy, r.updatedBy]))
  return rows.map((r) => ({
    ...r,
    createdByName: people.get(r.createdBy)?.name || null,
    updatedByName: people.get(r.updatedBy)?.name || null,
  }))
}

const withAuditOne = async (row) => (await withAudit([row]))[0]

// Every schema draft in a workspace, in one list — what the home area's Schema
// section shows. A draft is a saved_queries row with kind='schema': the staged,
// uncommitted DDL of a schema-editor tab. Same gating as the workspace-wide
// dashboards route above — membership to see the workspace, then per-connection
// access — so this can never show more than the per-connection /saved route.
//
// The DDL itself is summarised (a statement count) rather than returned: the
// list only needs the size of a draft, and rendering one needs the editor.
app.get('/api/workspaces/:id/schemas', async (req, res) => {
  const user = await requireMember(req, res, req.params.id)
  if (!user) return
  const conns = await openableConnections(req.params.id, user.id)
  const byId = new Map(conns.map((c) => [c.id, c]))
  const ids = [...byId.keys()]
  // No reachable connection is not an empty answer — the from-scratch drafts
  // below hang off the workspace, so they are still there to list.
  const rows = ids.length
    ? await meta().saved_queries.findMany({ where: { kind: 'schema', connection_id: { in: ids } }, orderBy: { ts: 'desc' } })
    : []
  // Both kinds of draft, in one list: designed against a connection (a saved
  // query) or from scratch (a workspace row with a dialect and no connection).
  // `connectionId: null` is what tells them apart — and where a row opens.
  const attached = rows.map((r) => {
    const conn = byId.get(r.connection_id)
    return {
      id: r.id,
      connectionId: r.connection_id,
      connectionName: conn.name,
      connectionType: conn.type,
      // The schema version the draft is staged *against* — the connection's
      // counter, bumped by every committed DDL migration. It answers "is this
      // draft still against the schema it was drawn from?", which is a property
      // of the database, not of the draft, so a from-scratch row has none.
      connectionSchemaVersion: conn.schemaVersion ?? 1,
      name: r.name,
      ts: r.ts,
      createdAt: r.created_at || r.ts,
      createdBy: r.created_by || null,
      // Same fallback the schema_drafts mapper makes: a row whose only writer
      // was its creator (or one older than the trail) names them rather than
      // going blank.
      updatedBy: r.updated_by || r.created_by || null,
      statementCount: schemaStatementCount(r.sql),
    }
  })
  const scratch = (await listSchemaDrafts(req.params.id)).map((d) => ({
    id: d.id,
    connectionId: null,
    connectionName: null,
    connectionType: d.dbType,
    // No database behind it, so no committed schema to be a version of.
    connectionSchemaVersion: null,
    name: d.name,
    ts: d.ts,
    createdAt: d.createdAt,
    createdBy: d.createdBy,
    updatedBy: d.updatedBy,
    statementCount: schemaStatementCount(d.sql),
  }))
  res.json((await withAudit([...attached, ...scratch])).sort((x, y) => (y.ts || 0) - (x.ts || 0)))
})

// One draft by id, whichever kind it is — what the standalone schema editor
// page (/schemas/:id) loads. The list above says a draft either hangs off a
// connection (a saved query) or off the workspace (a from-scratch row); this
// resolves both through one address, so the editor page has one thing to fetch
// and the caller never has to know which table the id came from.
//
// Access is the same rule the list applies, enforced per draft rather than by
// filtering: membership to reach the workspace, then `userCanAccessConnection`
// for a draft that targets a connection. A member who cannot open that database
// gets 403 here, exactly as they would from the connection's own /saved route.
app.get('/api/workspaces/:id/schemas/:draftId', async (req, res) => {
  const user = await requireMember(req, res, req.params.id)
  if (!user) return
  const scratch = await getSchemaDraft(req.params.draftId)
  if (scratch && scratch.workspaceId === req.params.id) {
    return res.json(
      await withAuditOne({
        id: scratch.id,
        name: scratch.name,
        sql: scratch.sql,
        layout: scratch.layout,
        ts: scratch.ts,
        createdAt: scratch.createdAt,
        createdBy: scratch.createdBy,
        updatedBy: scratch.updatedBy,
        connectionId: null,
        connectionName: null,
        connectionType: scratch.dbType,
      })
    )
  }
  const row = await meta().saved_queries.findFirst({ where: { id: req.params.draftId, kind: 'schema' } })
  if (!row) return res.status(404).json({ error: 'Schema draft not found' })
  const conn = await getConnection(row.connection_id)
  if (!conn || conn.workspaceId !== req.params.id) return res.status(404).json({ error: 'Schema draft not found' })
  if (!(await userCanAccessConnection(conn, user.id)))
    return res.status(403).json({ error: 'You do not have access to this connection' })
  res.json(
    await withAuditOne({
      id: row.id,
      name: row.name,
      sql: row.sql || '',
      layout: row.layout ? safeJson(row.layout) : null,
      ts: row.ts,
      createdAt: row.created_at || row.ts,
      createdBy: row.created_by || null,
      updatedBy: row.updated_by || row.created_by || null,
      connectionId: conn.id,
      connectionName: conn.name,
      connectionType: conn.type,
    })
  )
})

// The engines a from-scratch schema can be designed for. Comes from the driver
// registry (an engine reporting no column types is schemaless, so there is
// nothing to draw) — never a hand-kept list in the UI.
app.get('/api/schema-engines', async (req, res) => {
  if (!requireAuth(req, res)) return
  res.json(db.designableEngines())
})

// A schema designed from scratch: no connection, so the workspace holds it and
// the row carries the dialect its DDL is written for. Membership is the gate —
// designing a schema is not a permission (see permissions-catalog.js: using a
// database is per-connection access, and this one has no database at all).
app.post('/api/workspaces/:id/schema-drafts', async (req, res) => {
  const user = await requireMember(req, res, req.params.id)
  if (!user) return
  const { name, dbType } = req.body || {}
  if (!name?.trim()) return res.status(400).json({ error: 'A schema name is required' })
  const engine = db.designableEngines().find((e) => e.type === dbType)
  if (!engine) return res.status(400).json({ error: 'Pick a database type a schema can be designed for' })
  res.json(
    await createSchemaDraft({
      workspaceId: req.params.id,
      name: name.trim(),
      dbType: engine.type,
      sql: typeof req.body?.sql === 'string' ? req.body.sql : '',
      layout: schemaLayout(req.body?.layout),
      createdBy: user.id,
    })
  )
})

// One draft, with its DDL — what the standalone editor loads.
app.get('/api/workspaces/:id/schema-drafts/:draftId', async (req, res) => {
  const user = await requireMember(req, res, req.params.id)
  if (!user) return
  const draft = await getSchemaDraft(req.params.draftId)
  if (!draft || draft.workspaceId !== req.params.id) return res.status(404).json({ error: 'Schema draft not found' })
  res.json(draft)
})

// Partial: `name`, `sql`, `layout`, or any combination — saving the editor
// sends the DDL and the diagram arrangement together, a rename sends neither.
app.put('/api/workspaces/:id/schema-drafts/:draftId', async (req, res) => {
  const user = await requireMember(req, res, req.params.id)
  if (!user) return
  const draft = await getSchemaDraft(req.params.draftId)
  if (!draft || draft.workspaceId !== req.params.id) return res.status(404).json({ error: 'Schema draft not found' })
  const body = req.body || {}
  const { name, sql } = body
  if (name !== undefined && !String(name).trim()) return res.status(400).json({ error: 'A schema name is required' })
  res.json(
    await updateSchemaDraft(draft.id, {
      ...(name !== undefined && { name: String(name).trim() }),
      ...(sql !== undefined && { sql: String(sql) }),
      ...('layout' in body && { layout: schemaLayout(body.layout) }),
      // Stamped only if something above actually changes — see updateDraft.
      updatedBy: user.id,
    })
  )
})

app.delete('/api/workspaces/:id/schema-drafts/:draftId', async (req, res) => {
  const user = await requireMember(req, res, req.params.id)
  if (!user) return
  const draft = await getSchemaDraft(req.params.draftId)
  if (!draft || draft.workspaceId !== req.params.id) return res.status(404).json({ error: 'Schema draft not found' })
  await deleteSchemaDraft(draft.id)
  res.json({ ok: true })
})

app.get('/api/connections/:id/dashboards', async (req, res) => {
  res.json(await listDashboards(req.params.id))
})

app.post('/api/connections/:id/dashboards', async (req, res) => {
  try {
    res.json(await createDashboard(req.params.id, req.body))
  } catch (error) {
    fail(res, error)
  }
})

app.get('/api/connections/:id/dashboards/:did', async (req, res) => {
  const dashboard = await getDashboard(req.params.id, req.params.did)
  if (!dashboard) return res.status(404).json({ error: 'Not found' })
  res.json(dashboard)
})

app.put('/api/connections/:id/dashboards/:did', async (req, res) => {
  try {
    if (!(await updateDashboard(req.params.id, req.params.did, req.body))) return res.status(404).json({ error: 'Not found' })
    res.json({ ok: true })
  } catch (error) {
    fail(res, error)
  }
})

app.delete('/api/connections/:id/dashboards/:did', async (req, res) => {
  if (!(await deleteDashboard(req.params.id, req.params.did))) return res.status(404).json({ error: 'Not found' })
  res.json({ ok: true })
})

// ============================================================================
// Backup (standalone system: own schedule + run history, independent of the
// generic workflow engine — see server/backup/)
// ============================================================================

// Current backup schedule for this connection (null if none has been created yet).
app.get('/api/connections/:id/backup/schedule', async (req, res) => {
  res.json({ schedule: await getBackupSchedule(req.params.id) })
})

app.post('/api/connections/:id/backup/schedule', async (req, res) => {
  const conn = await getConnection(req.params.id)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })
  // An engine with no dump can't be scheduled for backup.
  if (!db.supports(conn, 'dump')) {
    return res.status(400).json({ error: `Backups are not supported for connection type: ${conn.type}` })
  }
  if (await getBackupScheduleRow(req.params.id)) return res.status(409).json({ error: 'This connection already has a backup schedule.' })
  const body = req.body || {}
  const err = await validateScheduleBody(conn, body.destinationIds, body.frequency)
  if (err) return res.status(400).json({ error: err })
  res.json({ schedule: await createSchedule(req.params.id, body) })
})

// Update any subset of the schedule's fields (also how Active/Paused toggles
// via a lightweight `{ enabled }` body).
app.put('/api/connections/:id/backup/schedule', async (req, res) => {
  const conn = await getConnection(req.params.id)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })
  const row = await getBackupScheduleRow(req.params.id)
  if (!row) return res.status(404).json({ error: 'No backup schedule exists for this connection.' })
  const body = req.body || {}
  const err = await validateScheduleBody(
    conn,
    body.destinationIds ?? safeJson(row.destination_ids) ?? [],
    body.frequency ?? row.frequency
  )
  if (err) return res.status(400).json({ error: err })
  res.json({ schedule: await updateSchedule(row, body) })
})

// Run the connection's backup schedule immediately (no retry — same semantics
// as today's "Run now").
app.post('/api/connections/:id/backup/run', async (req, res) => {
  const conn = await getConnection(req.params.id)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })
  const row = await getBackupScheduleRow(req.params.id)
  if (!row) return res.status(404).json({ error: 'No backup schedule exists for this connection.' })
  res.json(await runBackupOnce(row, conn, 'manual'))
})

// Per-day run counts — feeds the GitHub-style calendar.
app.get('/api/connections/:id/backup/calendar', async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 365, 1), 366)
  res.json({ days: await backupCalendar(req.params.id, days) })
})

// Paginated backup runs, with the uploaded-artifact info the version list
// needs. Optional `date=YYYY-MM-DD` filters to one day (heatmap click).
app.get('/api/connections/:id/backup/runs', async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 200)
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0)
  try {
    res.json(await listBackupRuns(req.params.id, { limit, offset, date: req.query.date && String(req.query.date) }))
  } catch (error) {
    fail(res, error)
  }
})

// Delete a specific uploaded backup artifact from storage. Irreversible —
// marks it `deleted` in the run's history rather than removing the row, so
// the date/status stays visible but Restore/Download disappear.
app.delete('/api/connections/:id/backup/runs/:runId/uploads/:destinationId', async (req, res) => {
  const { run, uploads, upload } = await findRunUpload(req.params.id, req.params.runId, req.params.destinationId)
  if (!run) return res.status(404).json({ error: 'Backup run not found' })
  if (!upload?.key) return res.status(404).json({ error: 'No deletable upload found for this destination' })
  const dest = await getStorage(req.params.destinationId)
  if (!dest) return res.status(404).json({ error: 'Storage destination not found' })
  try {
    // The connection-config JSON (when the schedule ships one) belongs to the
    // same run — it goes with the dump rather than lingering as an orphan.
    await deleteStorageObjects(dest, [upload.key, ...(upload.configKey ? [upload.configKey] : [])])
  } catch (err) {
    return res.status(500).json({ error: describeError(err) })
  }
  await markRunUploadDeleted(run, uploads, req.params.destinationId)
  res.json({ ok: true })
})

// Download a specific uploaded backup artifact (decrypted server-side first, if
// needed). `?artifact=config` fetches the connection JSON the run shipped
// alongside the dump (only present when the schedule has includeConfig on).
app.get('/api/connections/:id/backup/runs/:runId/uploads/:destinationId/download', async (req, res) => {
  const { run, upload } = await findRunUpload(req.params.id, req.params.runId, req.params.destinationId)
  if (!run) return res.status(404).json({ error: 'Backup run not found' })
  const wantConfig = req.query.artifact === 'config'
  const objectKey = wantConfig ? upload?.configKey : upload?.key
  if (!objectKey) return res.status(404).json({ error: `No downloadable ${wantConfig ? 'configuration' : 'upload'} found for this destination` })
  const dest = await getStorage(req.params.destinationId)
  if (!dest) return res.status(404).json({ error: 'Storage destination not found' })
  const conn = await getConnection(req.params.id)

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
  const sourceConn = await getConnection(req.params.id)
  if (!sourceConn) return res.status(404).json({ error: 'Connection not found' })
  const { runId, destinationId, confirmName, targetConnectionId } = req.body || {}
  const targetConn = targetConnectionId ? await getConnection(targetConnectionId) : sourceConn
  if (!targetConn) return res.status(404).json({ error: 'Target connection not found' })
  if (targetConn.workspaceId !== sourceConn.workspaceId) return res.status(400).json({ error: 'Target connection must be in the same workspace' })
  if (targetConn.type !== sourceConn.type) return res.status(400).json({ error: 'Target connection must be the same database type' })
  if (!canRestore(targetConn)) return res.status(400).json({ error: `Restore not supported for connection type: ${targetConn.type}` })
  if (confirmName !== targetConn.name) return res.status(400).json({ error: "Confirmation text doesn't match the target connection's name." })

  const { run, upload } = await findRunUpload(req.params.id, runId, destinationId)
  if (!run) return res.status(404).json({ error: 'Backup run not found' })
  if (!upload?.key) return res.status(400).json({ error: 'No successful upload found for this destination' })
  const dest = await getStorage(destinationId)
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
  const conn = await getConnection(req.params.id)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })
  const dest = await storageForRestore(conn, req.query.destinationId)
  if (!dest) return res.status(404).json({ error: 'Storage destination not found' })
  try {
    res.json({ objects: await listStorageObjects(dest) })
  } catch (err) {
    res.status(500).json({ error: describeError(err) })
  }
})

// Restore from a picked storage object.
app.post('/api/connections/:id/restore/from-storage', async (req, res) => {
  const conn = await getConnection(req.params.id)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })
  const { destinationId, key, confirmName } = req.body || {}
  if (!canRestore(conn)) return res.status(400).json({ error: `Restore not supported for connection type: ${conn.type}` })
  if (confirmName !== conn.name) return res.status(400).json({ error: "Confirmation text doesn't match the connection's name." })
  if (typeof key !== 'string' || !key) return res.status(400).json({ error: 'An object key is required' })
  const dest = await storageForRestore(conn, destinationId)
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
  const conn = await getConnection(req.params.id)
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

app.get('/api/connections/:id/history', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 500, 5000)
  const rows = await meta().query_history.findMany({ where: { connection_id: req.params.id }, orderBy: { ts: 'desc' }, take: limit })
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

app.post('/api/connections/:id/history', async (req, res) => {
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
  await meta().query_history.create({
    data: {
      id: entry.id,
      connection_id: req.params.id,
      table_name: entry.table,
      query: entry.query,
      status: entry.status,
      latency: entry.latency,
      error: entry.error,
      executor_id: entry.executorId,
      executor_name: entry.executorName,
      ts: entry.executedAt,
    },
  })
  res.json(entry)
})

app.delete('/api/connections/:id/history', async (req, res) => {
  // With { ids: [...] } delete just those entries; otherwise clear everything.
  const ids = req.body?.ids
  if (Array.isArray(ids) && ids.length) {
    await meta().query_history.deleteMany({ where: { connection_id: req.params.id, id: { in: ids.map(String) } } })
  } else {
    await meta().query_history.deleteMany({ where: { connection_id: req.params.id } })
  }
  res.json({ ok: true })
})

// ============================================================================
// Schema migrations (per connection)
// ============================================================================
// Records a DDL commit that has already been executed (via /query) — one row
// per successful commitChanges() batch, bumping the connection's schema
// version. Audit trail only; nothing here re-executes SQL.

app.post('/api/connections/:id/schema/migrations', async (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  const statements = Array.isArray(req.body?.statements) ? req.body.statements : []
  if (!statements.length) return res.status(400).json({ error: 'At least one statement is required' })
  const version = await bumpSchemaVersion(req.params.id)
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
  await meta().schema_migrations.create({
    data: {
      id: entry.id,
      connection_id: entry.connectionId,
      version: entry.version,
      forward_sql: JSON.stringify(entry.forwardSql),
      rollback_sql: JSON.stringify(entry.rollbackSql),
      reversible: entry.reversible ? 1 : 0,
      status: 'active',
      executor_id: entry.executorId,
      executor_name: entry.executorName,
      ts: entry.ts,
    },
  })
  res.json({ version, migration: { ...entry, status: 'active' } })
})

// List a connection's schema migration history, newest first. `ORDER BY ts`
// (not version) so rolled-back rows that share a reused version number keep
// their real chronological order.
app.get('/api/connections/:id/schema/migrations', async (req, res) => {
  const rows = await meta().schema_migrations.findMany({ where: { connection_id: req.params.id }, orderBy: { ts: 'desc' } })
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
  const conn = await getConnection(req.params.id)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })

  const toVersion = Number(req.body?.toVersion)
  if (!Number.isInteger(toVersion) || toVersion < 0) {
    return res.status(400).json({ error: 'A valid target version is required' })
  }

  // Still-active migrations newer than the target, newest first — these get undone.
  // A NULL status is a legacy row, and legacy rows are active.
  const rows = await meta().schema_migrations.findMany({
    where: { connection_id: req.params.id, version: { gt: toVersion }, OR: [{ status: null }, { status: 'active' }] },
    orderBy: { version: 'desc' },
  })

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

  await transaction(async () => {
    await meta().schema_migrations.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { status: 'rollbacked' } })
    await setSchemaVersion(req.params.id, toVersion)
  })

  res.json({ version: toVersion, rolledBack: rows.map((r) => r.version) })
})

// ============================================================================
// Database browsing + querying
// ============================================================================
// Every route below dispatches through server/db/index.js. Engines that don't
// have the concept answer with the empty result (tables, columns, diagram…) or
// a 400 naming the type (insert, analyze) — never `undefined`.

// The connection this request is for; the /:id guard has already authorized it.
const connOr404 = async (req, res) => {
  const conn = await getConnection(req.params.id)
  if (!conn) {
    res.status(404).json({ error: 'Connection not found' })
    return null
  }
  return conn
}

app.get('/api/connections/:id/tables', async (req, res) => {
  const conn = await connOr404(req, res)
  if (!conn) return
  try {
    res.json(await db.listTables(conn, queryCtx(req)))
  } catch (error) {
    fail(res, error)
  }
})

// Connectivity check — attempts to reach the database and reports { ok }.
app.get('/api/connections/:id/ping', async (req, res) => {
  const conn = await getConnection(req.params.id)
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
  const conn = await connOr404(req, res)
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
  const conn = await connOr404(req, res)
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
  const conn = await connOr404(req, res)
  if (!conn) return
  const user = authUser(req)
  const force = ['1', 'true', 'yes'].includes(String(req.query.force || '').toLowerCase())
  // Asks for the capability, not the role name: an admin may have defined some
  // other role that manages the workspace, and it should close sessions too.
  if (force && conn.workspaceId && !(await can(conn.workspaceId, user.id, 'workspace.manage'))) {
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
  const conn = await connOr404(req, res)
  if (!conn) return
  try {
    res.json(await db.listObjects(conn, queryCtx(req)))
  } catch (error) {
    fail(res, error)
  }
})

// Function definition(s) for a named routine (empty for engines without them).
app.get('/api/connections/:id/function/:name', async (req, res) => {
  const conn = await connOr404(req, res)
  if (!conn) return
  try {
    res.json(await db.listFunctions(conn, queryCtx(req), req.params.name))
  } catch (error) {
    fail(res, error)
  }
})

app.get('/api/connections/:id/table/:table', async (req, res) => {
  const conn = await connOr404(req, res)
  if (!conn) return
  try {
    res.json(await db.getTableData(conn, queryCtx(req), { table: req.params.table, limit: parseInt(req.query.limit) || 200 }))
  } catch (error) {
    fail(res, error)
  }
})

app.get('/api/connections/:id/columns/:table', async (req, res) => {
  const conn = await connOr404(req, res)
  if (!conn) return
  try {
    res.json(await db.getColumns(conn, queryCtx(req), req.params.table))
  } catch (error) {
    fail(res, error)
  }
})

app.get('/api/connections/:id/indexes/:table', async (req, res) => {
  const conn = await connOr404(req, res)
  if (!conn) return
  try {
    res.json(await db.getIndexes(conn, queryCtx(req), req.params.table))
  } catch (error) {
    fail(res, error)
  }
})

// Full schema (table -> column names) for editor autocomplete.
app.get('/api/connections/:id/schema', async (req, res) => {
  const conn = await connOr404(req, res)
  if (!conn) return
  try {
    res.json(await db.getSchemaMap(conn, queryCtx(req)))
  } catch (error) {
    fail(res, error)
  }
})

// List databases + schemas available on a connection (for the breadcrumb).
app.get('/api/connections/:id/namespaces', async (req, res) => {
  const conn = await connOr404(req, res)
  if (!conn) return
  try {
    res.json(await db.namespaces(conn, queryCtx(req)))
  } catch (error) {
    fail(res, error)
  }
})

// Column data types the schema editor offers. Schemaless engines (Redis)
// report none — the schema designer is hidden for them.
app.get('/api/connections/:id/types', async (req, res) => {
  const conn = await connOr404(req, res)
  if (!conn) return
  res.json({ types: db.dataTypesFor(conn) })
})

// Schema diagram: every table's columns and indexes + foreign-key relationships.
// `?tables=a,b,c` answers for just those tables, which is how the schema editor's
// Sync walks a large schema in slices and reports progress as it goes.
app.get('/api/connections/:id/diagram', async (req, res) => {
  const conn = await connOr404(req, res)
  if (!conn) return
  const only = String(req.query.tables || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
  try {
    res.json(await db.getDiagram(conn, queryCtx(req), { tables: only.length ? only : null }))
  } catch (error) {
    fail(res, error)
  }
})

// Insert a row (parameterized).
app.post('/api/connections/:id/insert', async (req, res) => {
  const conn = await connOr404(req, res)
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
  const conn = await connOr404(req, res)
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
  const conn = await connOr404(req, res)
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
// Table data export / import (the console's Export and Import panel)
// ============================================================================
// Rows in and out of the connected database's tables as CSV, JSON or SQL — see
// server/data-transfer.js. Engine-agnostic: an engine without tables (Redis)
// lists none to export and refuses an import with a 400 naming its type.

const truthy = (v) => ['1', 'true', 'yes'].includes(String(v || '').toLowerCase())

// Stream an export file. `?tables=a,b&format=csv|json|sql&includeSchema=1`, plus
// `limit` (rows per table — the panel's preview) and the usual namespace params.
app.get('/api/connections/:id/data/export', async (req, res) => {
  const conn = await connOr404(req, res)
  if (!conn) return
  const tables = String(req.query.tables || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
  try {
    const plan = await planExport(conn, queryCtx(req), {
      tables,
      format: String(req.query.format || ''),
      includeSchema: truthy(req.query.includeSchema),
      limit: req.query.limit,
    })
    res.setHeader('Content-Type', plan.mime)
    res.setHeader('Content-Disposition', `attachment; filename="${plan.filename}"`)
    await pipeline(Readable.from(plan.chunks), res)
  } catch (error) {
    // Once streaming has started the status is already sent — cut the
    // download short so it can't be mistaken for a complete file.
    if (res.headersSent) res.destroy(error)
    else fail(res, error)
  }
})

// The file arrives as the raw text body (not JSON-wrapped), up to IMPORT_MAX_BYTES.
const importBody = express.text({ type: () => true, limit: IMPORT_MAX_BYTES })
const readImportBody = (req, res, next) =>
  importBody(req, res, (err) => {
    if (!err) return next()
    const tooLarge = err.type === 'entity.too.large'
    res.status(tooLarge ? 413 : 400).json({
      error: tooLarge ? `The file is larger than the ${IMPORT_MAX_BYTES / 1024 / 1024} MB import limit.` : err.message,
    })
  })

// Import a file. `?filename=users.csv` is all it needs — the format, the target
// table and any missing table's schema all come from the file (see
// server/data-transfer.js parseImport). `format`, `table` and `createTables=0`
// override that; `dryRun=1` writes nothing and answers with what would happen.
app.post('/api/connections/:id/data/import', readImportBody, async (req, res) => {
  const conn = await connOr404(req, res)
  if (!conn) return
  const opts = {
    text: typeof req.body === 'string' ? req.body : '',
    filename: String(req.query.filename || ''),
    format: req.query.format ? String(req.query.format) : null,
    table: req.query.table ? String(req.query.table) : null,
    createTables: !['0', 'false', 'no'].includes(String(req.query.createTables ?? '').toLowerCase()),
  }
  try {
    res.json(truthy(req.query.dryRun) ? await previewImport(conn, queryCtx(req), opts) : await runImport(conn, queryCtx(req), opts))
  } catch (error) {
    fail(res, error, 400)
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
  const conn = await getConnection(req.params.id)
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
// Through `driverOps`, not `db.drivers.redis`, so a tunneled connection is
// dialed through its SSH gateway like every generic op.
const redis = db.driverOps('redis')

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
app.get('/api/system/version', async (req, res) => {
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
    const file = `app-${APP_VERSION}-${Date.now()}.${META_DB_TYPE === 'postgresql' ? 'dump' : 'db'}`
    const dest = path.join(BACKUPS_DIR, file)
    const sizeBytes = await backupMeta(dest)
    res.json({ ok: true, file, sizeBytes, createdAt: Date.now() })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Download a previously-taken snapshot.
app.get('/api/system/backup/:file/download', async (req, res) => {
  if (!requireSystemAdmin(req, res)) return
  const safe = path.basename(req.params.file)
  const full = path.join(BACKUPS_DIR, safe)
  if (path.dirname(full) !== BACKUPS_DIR || !fs.existsSync(full)) {
    return res.status(404).json({ error: 'Backup not found' })
  }
  res.download(full, safe)
})

// Pre-flight validation before applying an update.
app.get('/api/system/preflight', async (req, res) => {
  if (!requireSystemAdmin(req, res)) return
  const checks = []

  try {
    const r = await checkMetaIntegrity()
    checks.push({ id: 'integrity', label: 'Metadata database integrity', status: r === 'ok' ? 'pass' : 'fail', detail: r === 'ok' ? 'No corruption detected' : String(r) })
  } catch (e) {
    checks.push({ id: 'integrity', label: 'Metadata database integrity', status: 'fail', detail: e.message })
  }

  try {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true })
    if (META_DB_TYPE === 'postgresql') {
      const [{ bytes: size }] = await meta().$queryRaw`SELECT pg_database_size(current_database()) AS bytes`
      checks.push({ id: 'disk', label: 'Metadata snapshot', status: 'pass', detail: `PostgreSQL database: ${Math.round(size / 1e6)} MB; snapshot writes to local backup directory` })
    } else {
      const st = fs.statfsSync(BACKUPS_DIR)
      const freeBytes = st.bavail * st.bsize
      const metaSize = fs.existsSync(META_DB_PATH) ? fs.statSync(META_DB_PATH).size : 0
      const ok = freeBytes > metaSize * 3 + 50e6
      checks.push({ id: 'disk', label: 'Free disk for snapshot', status: ok ? 'pass' : 'warn', detail: `${Math.round(freeBytes / 1e6)} MB free` })
    }
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
app.get('/api/health', async (req, res) => {
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

// Error handler. A module error carrying `status` (a 400 from validation, say)
// keeps it, the same as `fail()` does in a route's own catch.
app.use((error, req, res, next) => {
  if (!error.status || error.status >= 500) console.error(error)
  if (res.headersSent) return next(error)
  res.status(error.status || 500).json({ error: error.message })
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

app.listen(PORT, async () => {
  console.log(`✅ Server running on http://localhost:${PORT}`)
  console.log(`📊 API available at http://localhost:${PORT}/api`)
  console.log(`🔑 Sessions: logins in ${META_DB_TYPE === 'postgresql' ? 'PostgreSQL metadata' : META_DB_PATH}, cached in ${sessionCache.kind}`)
  // Open what can be opened eagerly (SQLite files) so the first query is fast.
  const connections = await listConnections().catch((error) => {
    console.error('Listing connections to prewarm failed:', error.message)
    return []
  })
  for (const conn of connections) {
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
  await closeMeta().catch(() => {})
  process.exit(0)
})
