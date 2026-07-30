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
  connectionAccess,
  createSession,
  deleteSession,
  getUserByEmail,
  memberRole,
  publicUser,
  requireAuth,
  requireSystemAdmin,
  setConnectionAccess,
  userCanAccessConnection,
  workspaceForUser,
} from './server/auth.js'
import { sendInviteEmail, sendMail, sendResetEmail, smtpConfig, smtpForUser } from './server/mail.js'
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

// Boot readiness — flipped true once the meta DB's migrations are done.
let bootReady = false
initMetaDb()
bootReady = true

// The database/schema a request is aimed at. Every db layer call takes one, and
// each engine reads only the parts that mean something to it.
const queryCtx = (req) => ({ database: req.query.database, schema: req.query.schema })

// Route error → response. `status` is set by the db layer for "this engine
// can't do that" and by the import/restore paths for bad input.
const fail = (res, error, fallbackStatus = 500) => res.status(error.status || fallbackStatus).json({ error: error.message })

// ============================================================================
// Authentication
// ============================================================================

// Authenticate a user (by email, stored in `username`). Returns a session token.
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {}
  const row = meta.prepare('SELECT id, username, name, role, status, password_hash FROM users WHERE username = ?').get(username)
  if (!row || row.status === 'pending' || row.password_hash !== sha256(password)) {
    return res.status(401).json({ error: 'Invalid email or password' })
  }
  res.json({ user: publicUser(row), token: createSession(row.id) })
})

// Log out — invalidate the current session token.
app.post('/api/auth/logout', (req, res) => {
  const token = bearerToken(req)
  if (token) deleteSession(token)
  res.json({ ok: true })
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
    const cfg = smtpForUser(user.id)
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
app.post('/api/auth/reset/:token', (req, res) => {
  const u = meta.prepare('SELECT id, reset_expires FROM users WHERE reset_token = ?').get(req.params.token)
  if (!u || (u.reset_expires && u.reset_expires < Date.now())) {
    return res.status(404).json({ error: 'This reset link is invalid or has expired.' })
  }
  const { password } = req.body || {}
  if (!password) return res.status(400).json({ error: 'A password is required.' })
  meta
    .prepare("UPDATE users SET password_hash = ?, status = 'active', reset_token = NULL, reset_expires = NULL WHERE id = ?")
    .run(sha256(password), u.id)
  meta.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id) // sign out other sessions
  const user = meta.prepare('SELECT id, username, name, role FROM users WHERE id = ?').get(u.id)
  res.json({ user: publicUser(user), token: createSession(u.id) })
})

// First-run status — true when no users exist yet (setup wizard needed).
app.get('/api/setup', (req, res) => {
  res.json({ needsSetup: !meta.prepare('SELECT 1 FROM users LIMIT 1').get() })
})

// First-run setup — creates the admin account + first workspace. Only allowed
// while no users exist, so it can't be used to hijack an initialized instance.
app.post('/api/setup', (req, res) => {
  if (meta.prepare('SELECT 1 FROM users LIMIT 1').get()) {
    return res.status(403).json({ error: 'Setup has already been completed.' })
  }
  const { email, password, name, workspace } = req.body || {}
  if (!email || !password || !workspace?.trim()) {
    return res.status(400).json({ error: 'Email, password and workspace name are required.' })
  }
  const uid = randomUUID()
  const wid = randomUUID()
  const now = Date.now()
  meta
    .prepare('INSERT INTO users (id, username, password_hash, name, role, status) VALUES (?, ?, ?, ?, ?, ?)')
    .run(uid, email.trim(), sha256(password), name?.trim() || 'Admin', 'admin', 'active')
  meta.prepare('INSERT INTO workspaces (id, name, settings, created_at) VALUES (?, ?, ?, ?)').run(wid, workspace.trim(), '{}', now)
  meta
    .prepare('INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(randomUUID(), wid, uid, 'admin', now)
  const user = meta.prepare('SELECT id, username, name, role FROM users WHERE id = ?').get(uid)
  res.json({ user: publicUser(user), token: createSession(uid) })
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
app.post('/api/invite/:token/accept', (req, res) => {
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
  res.json({ user: publicUser(user), token: createSession(u.id) })
})

// ============================================================================
// Workspaces
// ============================================================================

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
  res.json(
    rows.map((r) => {
      const settings = safeJson(r.settings)
      return { id: r.id, name: r.name, role: r.role, createdAt: r.created_at, experiments: settings.experiments || {}, notifications: settings.notifications || {} }
    })
  )
})

// Create a workspace — caller becomes its admin.
app.post('/api/workspaces', (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  const { name } = req.body || {}
  if (!name?.trim()) return res.status(400).json({ error: 'Workspace name is required.' })
  const wid = randomUUID()
  const now = Date.now()
  meta.prepare('INSERT INTO workspaces (id, name, settings, created_at) VALUES (?, ?, ?, ?)').run(wid, name.trim(), '{}', now)
  meta
    .prepare('INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(randomUUID(), wid, user.id, 'admin', now)
  res.json({ id: wid, name: name.trim(), role: 'admin', createdAt: now })
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
  // Admins also get the (password-masked) SMTP config for the settings form.
  if (ws.role === 'admin') {
    const smtp = settings.smtp || {}
    ws.smtp = { host: smtp.host || '', port: smtp.port || '', secure: !!smtp.secure, user: smtp.user || '', from: smtp.from || '', hasPassword: !!smtp.pass }
    ws.smtpEnvFallback = !!process.env.SMTP_HOST
    // Non-secret env values, so the settings form can show what's actually in effect
    // when the workspace hasn't overridden it (password never leaves the server).
    if (ws.smtpEnvFallback) {
      ws.smtpEnvDefaults = {
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT || '587',
        secure: process.env.SMTP_SECURE === 'true',
        user: process.env.SMTP_USER || '',
        from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
      }
    }
  }
  res.json(ws)
})

// Rename + SMTP settings + beta experiment flags (admin).
app.put('/api/workspaces/:id', (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  if (memberRole(req.params.id, user.id) !== 'admin') return res.status(403).json({ error: 'Admin only' })
  const row = meta.prepare('SELECT settings FROM workspaces WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Workspace not found' })
  const { name, smtp, experiments, notifications } = req.body || {}
  if (name?.trim()) meta.prepare('UPDATE workspaces SET name = ? WHERE id = ?').run(name.trim(), req.params.id)
  if (smtp || experiments || notifications) {
    const settings = safeJson(row.settings)
    if (smtp) {
      const prev = settings.smtp || {}
      settings.smtp = {
        host: smtp.host ?? prev.host,
        port: smtp.port ?? prev.port,
        secure: smtp.secure ?? prev.secure,
        user: smtp.user ?? prev.user,
        from: smtp.from ?? prev.from,
        // Keep the stored password unless a new one is supplied (never wiped by a save).
        pass: smtp.pass ? smtp.pass : prev.pass,
      }
    }
    if (experiments) settings.experiments = { ...(settings.experiments || {}), ...experiments }
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

// Send a test email using either the unsaved form values (body.smtp) or, if
// omitted, whatever is already saved/env-configured for this workspace.
app.post('/api/workspaces/:id/smtp/test', async (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  if (memberRole(req.params.id, user.id) !== 'admin') return res.status(403).json({ error: 'Admin only' })
  const row = meta.prepare('SELECT settings FROM workspaces WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Workspace not found' })
  const { to, smtp: overrides } = req.body || {}
  let cfg
  if (overrides?.host) {
    const prev = safeJson(row.settings).smtp || {}
    cfg = smtpConfig({
      settings: JSON.stringify({
        smtp: {
          host: overrides.host,
          port: overrides.port,
          secure: overrides.secure,
          user: overrides.user,
          from: overrides.from,
          pass: overrides.pass || prev.pass,
        },
      }),
    })
  } else {
    cfg = smtpConfig(row)
  }
  if (!cfg) return res.status(400).json({ error: 'No SMTP host configured.' })
  try {
    await sendMail(cfg, {
      to: to || user.username,
      subject: 'Tabletsgo test email',
      text: 'This is a test email from your Tabletsgo SMTP settings. If you received it, the configuration works.',
      html: '<p>This is a test email from your Tabletsgo SMTP settings.</p><p>If you received it, the configuration works.</p>',
    })
    res.json({ ok: true })
  } catch (err) {
    // "wrong version number" is OpenSSL-speak for "the TLS mode doesn't match
    // what the server expects on that port" — translate it, since the raw
    // error is meaningless to anyone who isn't reading OpenSSL source.
    const raw = err.message || 'Failed to send test email.'
    const message = /wrong version number/i.test(raw)
      ? "SSL/TLS handshake failed — the encryption mode probably doesn't match the port. Try switching between STARTTLS (587) and Implicit TLS/SSL (465)."
      : raw
    res.status(400).json({ error: message })
  }
})

// Delete a workspace and everything scoped to it (admin). Never the caller's last one.
app.delete('/api/workspaces/:id', (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  if (memberRole(req.params.id, user.id) !== 'admin') return res.status(403).json({ error: 'Admin only' })
  const mine = meta.prepare('SELECT COUNT(*) c FROM workspace_members WHERE user_id = ?').get(user.id).c
  if (mine <= 1) return res.status(400).json({ error: 'You must belong to at least one workspace.' })
  for (const row of meta.prepare('SELECT id, data FROM connections').all()) {
    if (JSON.parse(row.data).workspaceId === req.params.id) {
      deleteConnectionRow(row.id)
      meta.prepare('DELETE FROM saved_queries WHERE connection_id = ?').run(row.id)
      meta.prepare('DELETE FROM connection_tables WHERE connection_id = ?').run(row.id)
      meta.prepare('DELETE FROM workflows WHERE connection_id = ?').run(row.id)
      meta.prepare('DELETE FROM dashboards WHERE connection_id = ?').run(row.id)
      meta.prepare('DELETE FROM folders WHERE connection_id = ?').run(row.id)
      meta.prepare('DELETE FROM query_history WHERE connection_id = ?').run(row.id)
      meta.prepare('DELETE FROM connection_access WHERE connection_id = ?').run(row.id)
    }
  }
  meta.prepare('DELETE FROM workspace_members WHERE workspace_id = ?').run(req.params.id)
  // Drop the workspace's teams (and their membership rows).
  meta.prepare('DELETE FROM team_members WHERE team_id IN (SELECT id FROM teams WHERE workspace_id = ?)').run(req.params.id)
  meta.prepare('DELETE FROM teams WHERE workspace_id = ?').run(req.params.id)
  meta.prepare('DELETE FROM workspaces WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

// ---- Members ----

// List a workspace's members (any member can view).
app.get('/api/workspaces/:id/members', (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  if (!memberRole(req.params.id, user.id)) return res.status(403).json({ error: 'Forbidden' })
  const rows = meta
    .prepare(
      `SELECT u.id AS userId, u.username AS email, u.name, u.status, m.role, m.created_at
       FROM workspace_members m JOIN users u ON u.id = m.user_id
       WHERE m.workspace_id = ? ORDER BY m.created_at`
    )
    .all(req.params.id)
  res.json(rows)
})

// Invite a member by email (admin). Existing accounts are added directly;
// unknown/pending emails get a pending account + an invite link. The link is
// always returned so it works without SMTP.
app.post('/api/workspaces/:id/members', async (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  if (memberRole(req.params.id, user.id) !== 'admin') return res.status(403).json({ error: 'Admin only' })
  const email = (req.body?.email || '').trim().toLowerCase()
  if (!email) return res.status(400).json({ error: 'Email is required.' })

  let target = getUserByEmail(email)
  if (target && memberRole(req.params.id, target.id)) {
    return res.status(400).json({ error: 'That person is already a member.' })
  }

  const now = Date.now()
  const expires = now + 7 * 24 * 60 * 60 * 1000 // 7 days
  let inviteLink = null
  if (!target) {
    const uid = randomUUID()
    const token = randomUUID()
    meta
      .prepare('INSERT INTO users (id, username, password_hash, name, role, status, invite_token, invite_workspace, token_expires) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(uid, email, '', email, 'member', 'pending', token, req.params.id, expires)
    target = { id: uid, username: email, status: 'pending' }
    inviteLink = `${baseUrl(req)}/invite/${token}`
  } else if (target.status === 'pending') {
    const token = randomUUID()
    meta
      .prepare('UPDATE users SET invite_token = ?, invite_workspace = ?, token_expires = ? WHERE id = ?')
      .run(token, req.params.id, expires, target.id)
    inviteLink = `${baseUrl(req)}/invite/${token}`
  }

  meta
    .prepare('INSERT OR IGNORE INTO workspace_members (id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(randomUUID(), req.params.id, target.id, 'member', now)

  // Email the invite link when SMTP is configured — non-fatal, link is returned regardless.
  let emailed = false
  if (inviteLink) {
    const ws = meta.prepare('SELECT name, settings FROM workspaces WHERE id = ?').get(req.params.id)
    const cfg = smtpConfig(ws)
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
    member: { userId: target.id, email, name: target.name || email, role: 'member', status: target.status },
    inviteLink,
    emailed,
  })
})

// Remove a member (admin). Can't remove yourself or the last admin.
app.delete('/api/workspaces/:id/members/:userId', (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  if (memberRole(req.params.id, user.id) !== 'admin') return res.status(403).json({ error: 'Admin only' })
  if (req.params.userId === user.id) return res.status(400).json({ error: "You can't remove yourself." })
  const role = memberRole(req.params.id, req.params.userId)
  if (!role) return res.status(404).json({ error: 'Member not found' })
  if (role === 'admin') {
    const admins = meta.prepare("SELECT COUNT(*) c FROM workspace_members WHERE workspace_id = ? AND role = 'admin'").get(req.params.id).c
    if (admins <= 1) return res.status(400).json({ error: 'The workspace needs at least one admin.' })
  }
  meta.prepare('DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?').run(req.params.id, req.params.userId)
  // Drop the removed user from this workspace's teams so they can't retain
  // team-granted connection access.
  meta
    .prepare('DELETE FROM team_members WHERE user_id = ? AND team_id IN (SELECT id FROM teams WHERE workspace_id = ?)')
    .run(req.params.userId, req.params.id)
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

// Create a team (admin).
app.post('/api/workspaces/:id/teams', (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  if (memberRole(req.params.id, user.id) !== 'admin') return res.status(403).json({ error: 'Admin only' })
  const name = (req.body?.name || '').trim()
  if (!name) return res.status(400).json({ error: 'Team name is required.' })
  const id = randomUUID()
  const now = Date.now()
  meta.prepare('INSERT INTO teams (id, workspace_id, name, created_at) VALUES (?, ?, ?, ?)').run(id, req.params.id, name, now)
  res.json({ id, name, memberCount: 0, createdAt: now })
})

// Rename a team (admin).
app.put('/api/workspaces/:id/teams/:teamId', (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  if (memberRole(req.params.id, user.id) !== 'admin') return res.status(403).json({ error: 'Admin only' })
  const team = meta.prepare('SELECT id FROM teams WHERE id = ? AND workspace_id = ?').get(req.params.teamId, req.params.id)
  if (!team) return res.status(404).json({ error: 'Team not found' })
  const name = (req.body?.name || '').trim()
  if (!name) return res.status(400).json({ error: 'Team name is required.' })
  meta.prepare('UPDATE teams SET name = ? WHERE id = ?').run(name, req.params.teamId)
  res.json({ ok: true })
})

// Delete a team (admin) — cascades its members and any connection assignments.
app.delete('/api/workspaces/:id/teams/:teamId', (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  if (memberRole(req.params.id, user.id) !== 'admin') return res.status(403).json({ error: 'Admin only' })
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

// Add a member to a team (admin). The user must belong to the workspace.
app.post('/api/workspaces/:id/teams/:teamId/members', (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  if (memberRole(req.params.id, user.id) !== 'admin') return res.status(403).json({ error: 'Admin only' })
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

// Remove a member from a team (admin).
app.delete('/api/workspaces/:id/teams/:teamId/members/:userId', (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  if (memberRole(req.params.id, user.id) !== 'admin') return res.status(403).json({ error: 'Admin only' })
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

// Add connection to a workspace.
app.post('/api/connections', (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  const workspaceId = req.body.workspaceId
  if (!workspaceId || !memberRole(workspaceId, user.id)) return res.status(403).json({ error: 'Forbidden' })
  // Default the owner to the creating user (unless one was explicitly provided).
  const conn = { ...req.body, id: randomUUID(), workspaceId, ownerId: req.body.ownerId || user.id }
  saveConnection(conn)
  res.json(getConnection(conn.id))
})

// Import an export document as a brand-new connection in `workspaceId`.
// Mounted above the `/api/connections/:id` guard so "import" isn't read as an id.
app.post('/api/connections/import', (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  const { workspaceId, document, name, settings } = req.body || {}
  if (!workspaceId || !memberRole(workspaceId, user.id)) return res.status(403).json({ error: 'Forbidden' })
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

app.post('/api/storages', (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  const body = req.body || {}
  if (!body.workspaceId || !memberRole(body.workspaceId, user.id)) return res.status(403).json({ error: 'Forbidden' })
  if (!body.name?.trim() || !body.bucket?.trim()) return res.status(400).json({ error: 'A name and bucket are required' })
  res.json(createStorage(body.workspaceId, body))
})

// Guard every per-storage route: caller must be a member of the destination's workspace.
app.use('/api/storages/:sid', (req, res, next) => {
  const user = requireAuth(req, res)
  if (!user) return
  const dest = getStorage(req.params.sid)
  if (!dest) return res.status(404).json({ error: 'Storage destination not found' })
  if (!memberRole(dest.workspaceId, user.id)) return res.status(403).json({ error: 'Forbidden' })
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

// Guard every per-connection route: caller must be a member of the connection's
// workspace. One mount covers PUT/DELETE /:id and all /:id/* data routes.
app.use('/api/connections/:id', (req, res, next) => {
  const user = requireAuth(req, res)
  if (!user) return
  const conn = getConnection(req.params.id)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })
  if (conn.workspaceId && !userCanAccessConnection(conn, user.id)) return res.status(403).json({ error: 'Forbidden' })
  next()
})

// Update connection
app.put('/api/connections/:id', (req, res) => {
  const existing = getConnection(req.params.id)
  if (!existing) return res.status(404).json({ error: 'Connection not found' })
  const updated = { ...existing, ...req.body, id: req.params.id }
  saveConnection(updated)

  // Drop any cached pool/handle so the next query reconnects with the new
  // config (otherwise edits to host/credentials/database are ignored).
  db.releaseConnection(existing)
  db.releaseConnection(updated)

  res.json(updated)
})

// Delete connection
app.delete('/api/connections/:id', (req, res) => {
  const conn = getConnection(req.params.id)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })

  db.releaseConnection(conn)

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
app.get('/api/connections/:id/export', (req, res) => {
  const includeSecrets = ['1', 'true', 'yes'].includes(String(req.query.secrets || '').toLowerCase())
  const doc = buildConnectionExport(req.params.id, { includeSecrets })
  if (!doc) return res.status(404).json({ error: 'Connection not found' })
  res.json(doc)
})

// ---- Connection access (which teams/members may see this connection) ----
// Any user who passes the access guard can read the assignment; only a
// workspace admin can change it.
app.get('/api/connections/:id/access', (req, res) => {
  res.json(connectionAccess(req.params.id))
})

app.put('/api/connections/:id/access', (req, res) => {
  const user = authUser(req)
  const conn = getConnection(req.params.id)
  if (!conn) return res.status(404).json({ error: 'Connection not found' })
  if (conn.workspaceId && memberRole(conn.workspaceId, user.id) !== 'admin') return res.status(403).json({ error: 'Admin only' })
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
  const { database, schema } = req.body || {}

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
        await db.runQueryOrThrow(conn, { database, schema }, sql)
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
  const { table, values, database, schema } = req.body
  if (!table || Object.keys(values || {}).length === 0) {
    return res.status(400).json({ error: 'A table and at least one value are required' })
  }
  try {
    res.json(await db.insertRow(conn, { database, schema }, { table, values }))
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

// Analyze query performance — EXPLAIN-based, normalized across dialects.
// Read-only SELECTs also run for real timings; writes are never executed.
app.post('/api/connections/:id/analyze', async (req, res) => {
  const conn = connOr404(req, res)
  if (!conn) return
  const { sql, database, schema } = req.body
  if (!sql || !sql.trim()) return res.status(400).json({ error: 'SQL query required' })

  try {
    // Checked before parsing, so a non-SQL engine gets a message about itself
    // rather than one about statement shapes it doesn't have.
    db.requireCapability(conn, 'analyze')
    const statements = splitSqlStatements(stripSqlComments(sql))
    if (statements.length !== 1) throw new Error('Only a single statement can be analyzed.')
    // Drop any EXPLAIN prefix the user already typed so we don't explain an EXPLAIN.
    const statement = statements[0].replace(/^explain\s+(query\s+plan\s+|analyze\s+|\([^)]*\)\s*)?/i, '')
    res.json(await db.analyze(conn, { database, schema }, { sql: statement, cls: classifyStatement(statement) }))
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

// Execute a query (or, on a command-driven engine, a command buffer).
app.post('/api/connections/:id/query', async (req, res) => {
  const conn = connOr404(req, res)
  if (!conn) return
  const { sql, database, schema } = req.body
  if (!sql || !sql.trim()) return res.status(400).json({ error: 'SQL query required' })
  try {
    res.json(await db.runQuery(conn, { database, schema }, sql))
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

// Guard: these routes only make sense on a Redis connection.
const requireRedis = (req, res) => {
  const conn = getConnection(req.params.id)
  if (!conn) {
    res.status(404).json({ error: 'Connection not found' })
    return null
  }
  if (conn.type !== 'redis') {
    res.status(400).json({ error: `Not a Redis connection (type: ${conn.type}).` })
    return null
  }
  return conn
}
const redis = db.drivers.redis

// One SCAN page of the keyspace: [{ key, type, ttlMs }] plus the cursor to hand
// back for the next page. SCAN (never KEYS) so a large keyspace stays responsive.
app.get('/api/connections/:id/redis/keys', async (req, res) => {
  const conn = requireRedis(req, res)
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
  const conn = requireRedis(req, res)
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
  const conn = requireRedis(req, res)
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
  const conn = requireRedis(req, res)
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
  const conn = requireRedis(req, res)
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

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`)
  console.log(`📊 API available at http://localhost:${PORT}/api`)
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
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...')
  db.closeAllConnections()
  meta.close()
  process.exit(0)
})
