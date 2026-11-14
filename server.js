#!/usr/bin/env node
/**
 * HTTP surface for the database manager.
 *
 * This file is routes and wiring only. Everything a route needs lives in a
 * module under server/:
 *
 *   db/           the engine-agnostic database layer (sqlite | postgres | mysql | redis | kafka)
 *   meta.js       the app's own SQLite/PostgreSQL store; migrator/ evolves its schema
 *   auth.js       guards over Hayat: who is calling, what they may do
 *   hayat/        Hayat's service API — people, workspaces (tenants), decisions, mirrors
 *   connections.js  connection records (credentials encrypted at rest)
 *   folders.js    the polymorphic folder tree
 *   storage.js    S3-compatible + local backup destinations
 *   workflow.js   the node-graph executor and its scheduler
 *   backup/       backup schedule, runner and restore
 *   connection-transfer.js  the portable connection export/import bundle
 *   system-update.js        release checking + Docker self-update
 *   openapi.js    the API description behind Swagger UI at /api/docs
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
import swaggerUi from 'swagger-ui-express'

import {
  APP_NAME,
  APP_VERSION,
  BACKUPS_DIR,
  BACKUP_TMP_DIR,
  DIST_DIR,
  GIT_SHA,
  HAYAT_CONFIGURED,
  MAX_SESSIONS_PER_CONNECTION,
  META_DB_PATH,
  META_DB_TYPE,
  PORT,
  SCHEDULER_ENABLED,
} from './server/config.js'
import { backupMeta, checkMetaIntegrity, closeMeta, db as meta, transaction } from './server/meta.js'
import { describeError, filterAsync, safeJson, sanitizeForKey } from './server/util.js'
import {
  authUser,
  can,
  canManageConnection,
  isMember,
  permissionsAtConnection,
  publicUser,
  requireAuth,
  requireMember,
  requirePermission,
  requireSystemAdmin,
  sessionMiddleware,
  userCanAccessConnection,
  workspaceForUser,
} from './server/auth.js'
import {
  deleteWorkspaceCascade,
  getWorkspaceMember,
  getWorkspaceRow,
  listWorkspaceMembers,
  saveWorkspaceSettings,
  syncWorkspaceRows,
} from './server/workspaces.js'
import { CONNECTION_TYPE, STORAGE_TYPE, TENANT_TYPE, contractManifest, hayatKey } from './server/permissions-catalog.js'
import * as hayat from './server/hayat/index.js'
import {
  connectionSessionStats,
  endAllConnectionSessions,
  endConnectionSession,
  sweepConnectionSessions,
  closeSessionStore,
} from './server/sessions/index.js'
import { describeSmtpError, envSmtp, publicSmtpConfig, sendTestEmail, smtpConfig } from './server/mail.js'
import { clearGlobalSmtp, publicGlobalSmtp, saveGlobalSmtp } from './server/app-settings.js'
import { assertModuleEnabled, isModuleEnabled, moduleOffMessage, optionalModuleSetting } from './server/module-registry.js'
import { adminModules, loadModules, publicModules, updateModules } from './server/module-settings.js'
import { notifyModuleOwners } from './server/module-notices.js'
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
  cachedUpdateInfo,
  dockerSelfUpdate,
  dockerSelfUpdateAvailable,
  getUpdateInfo,
  manualUpdateCommand,
  updateApplyMethod,
} from './server/system-update.js'
import { openApiSpec, swaggerUiOptions } from './server/openapi.js'

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

// Boot readiness — flipped true once the modules are loaded. The meta DB is
// already current: server/migrator/boot.js migrated it before any import here
// opened it.
let bootReady = false
// Who people are and what they may do is Hayat's (CLAUDE.md "INVARIANTS"):
// without it nobody could sign in, so refuse to start rather than serve a
// login that can't work.
if (!HAYAT_CONFIGURED) {
  console.error('❌ Hayat is not configured. Set HAYAT_ISSUER, HAYAT_API_URL, HAYAT_CLIENT_ID, HAYAT_CLIENT_SECRET and HAYAT_WEB_CLIENT_ID (see README → Hayat).')
  process.exit(1)
}
// The instance's modules are read once here: the db layer asks on every dispatch.
await loadModules()
// Publish this version's contract (it waits for approval in Hayat's console) and
// follow Hayat's policy changes, which is what keeps cached answers honest.
await hayat.startHayat({ contract: contractManifest() })
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

// Route error → response. `status` is set by the db layer for "this engine
// can't do that" and by the import/restore paths for bad input.
const fail = (res, error, fallbackStatus = 500) => res.status(error.status || fallbackStatus).json({ error: error.message })

// ============================================================================
// Signing in — at Hayat
//
// The browser signs in at Hayat (authorization code + PKCE, as a public client)
// and sends the access token it gets as `Authorization: Bearer`. There is no
// login, password, invite or sign-up route here: all of that is Hayat's.
// ============================================================================

// What the browser needs to start signing in. Public: nobody is signed in yet.
app.get('/api/auth/config', (_req, res) => res.json(hayat.signInConfig()))

// The caller, as Hayat knows them. `role` is 'admin' for whoever holds
// tabletsgo's admin role at Hayat's root. `accountUrl` is where they change
// their name, password, time zone or sign-in methods.
app.get('/api/auth/me', async (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  res.json({ user: publicUser(user), accountUrl: hayat.consoleLink('/account') })
})

// ============================================================================
// Instance administration (system admins only)
//
// The admin area is deliberately narrow: modules, the mail server and updates.
// Accounts, workspaces, roles and sign-in methods are administered in Hayat. The
// admin role carries no workspace data access — it is granted at Hayat's root,
// and connections require tenant membership.
// ============================================================================

app.use('/api/admin', (req, res, next) => {
  if (!requireSystemAdmin(req, res)) return
  next()
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

// ---- Modules ----
// Which databases and features this instance offers, and their instance-wide
// settings (see server/module-registry.js). The first-run wizard writes them
// with the new admin's token, through these same routes.

app.get('/api/admin/modules', async (_req, res) => res.json({ modules: await adminModules() }))

// A refused change (an engine that connections still use, without `force`)
// answers 409 with the connections, so the admin can turn it off anyway.
const sendModuleError = (res, error) =>
  res.status(error.status || 500).json({ error: error.message, module: error.module, connections: error.connections })

// Batch: { modules: { [id]: { enabled?, settings? } }, force? } — what the wizard sends.
app.put('/api/admin/modules', async (req, res) => {
  try {
    res.json({ modules: await updateModules(req.body?.modules, { force: req.body?.force === true }) })
  } catch (error) {
    sendModuleError(res, error)
  }
})

// One module: { enabled?, settings?, force?, notify? } — what Admin → Modules
// sends. `force` turns off an engine connections still use (they are locked,
// not deleted); `notify` then notifies their owners by email, one per unique
// address. The switch stands even if that fails — `notified` says how it went.
app.put('/api/admin/modules/:id', async (req, res) => {
  const { enabled, settings, force, notify } = req.body || {}
  let modules
  try {
    modules = await updateModules({ [req.params.id]: { enabled, settings } }, { force: force === true })
  } catch (error) {
    return sendModuleError(res, error)
  }
  let notified
  if (force === true && notify === true && enabled === false) {
    notified = await notifyModuleOwners(req.params.id).catch((error) => ({ error: error.message }))
  }
  res.json({ modules, notified })
})

// ============================================================================
// Workspaces
// ============================================================================

// What's turned on, for any signed-in user — the client hides the rest (the
// server refuses it either way).
app.get('/api/modules', (req, res) => {
  if (!requireAuth(req, res)) return
  res.json({ modules: publicModules() })
})

// Workspaces the caller belongs to — their Hayat tenants, with tabletsgo's own
// settings for each. `permissions` rides along so every nav item and button
// gated on a capability renders right from the first payload.
app.get('/api/workspaces', async (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  const tenants = await hayat.userTenants(user.id)
  await syncWorkspaceRows(tenants)
  res.json(
    await Promise.all(
      tenants.map(async (t) => {
        const ws = await workspaceForUser(t.id, user.id)
        const settings = safeJson((await getWorkspaceRow(t.id))?.settings)
        return {
          ...ws,
          experiments: settings.experiments || {},
          notifications: settings.notifications || {},
          manageUrl: hayat.consoleLink(`/tenants/${t.id}`),
        }
      })
    )
  )
})

app.get('/api/workspaces/:id', async (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  const ws = await workspaceForUser(req.params.id, user.id)
  if (!ws) return res.status(404).json({ error: 'Workspace not found' })
  const settings = safeJson((await getWorkspaceRow(req.params.id))?.settings)
  // Beta experiment flags and notification preferences — visible to every
  // member, changed by permission (the PUT route below).
  ws.experiments = settings.experiments || {}
  ws.notifications = settings.notifications || {}
  // Session policy: the workspace-wide default cap on concurrent sessions per
  // connection (0 = unlimited). `instanceDefault` is the env fallback.
  ws.sessions = { maxPerConnection: settings.sessions?.maxPerConnection || 0, instanceDefault: MAX_SESSIONS_PER_CONNECTION }
  // Whoever manages notifications sees the (non-secret) instance mail server, to
  // know whether emails can go out at all.
  if (ws.permissions.includes('notifications.manage')) ws.smtp = await publicSmtpConfig()
  // Members, groups, roles and the workspace's name live in Hayat's console.
  ws.manageUrl = hayat.consoleLink(`/tenants/${req.params.id}`)
  ws.treeUrl = hayat.consoleLink(`/resource-tree/${req.params.id}`)
  res.json(ws)
})

/**
 * Tabletsgo's own settings for a workspace: experiment flags, notification and
 * session policy. One route, two permissions — notification preferences are a
 * capability of their own — so the body is checked field by field. The name is
 * Hayat's: rename the tenant there.
 */
app.put('/api/workspaces/:id', async (req, res) => {
  const user = requireAuth(req, res)
  if (!user) return
  const { name, experiments, notifications, sessions } = req.body || {}
  if (name !== undefined) return res.status(400).json({ error: 'Rename the workspace in Hayat — its name is the tenant’s.' })
  if ((experiments || sessions) && !(await requirePermission(req, res, req.params.id, 'workspace.manage'))) return
  if (notifications && !(await requirePermission(req, res, req.params.id, 'notifications.manage'))) return
  const ws = await workspaceForUser(req.params.id, user.id)
  if (!ws) return res.status(404).json({ error: 'Workspace not found' })

  if (experiments || notifications || sessions) {
    const settings = safeJson((await getWorkspaceRow(req.params.id))?.settings)
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
    await saveWorkspaceSettings(req.params.id, ws.name, settings)
  }
  res.json({ ok: true })
})

// Remove everything tabletsgo holds for a workspace. The tenant itself stays in
// Hayat, where deleting it is an instance admin's call — and possible once this
// has taken our resources out of its tree.
app.delete('/api/workspaces/:id', async (req, res) => {
  const user = await requirePermission(req, res, req.params.id, 'workspace.delete')
  if (!user) return
  const removed = await dropWorkspace(req.params.id)
  res.json({ ok: true, connectionsDeleted: removed.length })
})

/**
 * Tear down tabletsgo's side of a workspace: close the live database handles its
 * connections hold, take their mirrors out of Hayat's tree, then cascade the
 * metadata — so a workspace never disappears while its pools stay open.
 */
async function dropWorkspace(workspaceId) {
  for (const conn of (await listConnections()).filter((c) => c.workspaceId === workspaceId)) {
    db.releaseConnection(conn)
    await endAllConnectionSessions(conn.id)
    await hayat.deleteResource(CONNECTION_TYPE, conn.id)
  }
  for (const dest of await listStorageRows(workspaceId)) await hayat.deleteResource(STORAGE_TYPE, dest.id)
  return await deleteWorkspaceCascade(workspaceId)
}

// ---- Members ----

// A workspace's members — the tenant's roster in Hayat. Read-only here: people
// are added and removed, and given roles, in Hayat's console. Each carries the
// roles they hold on the workspace and what they may do there, so the list can
// say it without a second request.
app.get('/api/workspaces/:id/members', async (req, res) => {
  if (!(await requireMember(req, res, req.params.id))) return
  res.json(await listWorkspaceMembers(req.params.id))
})

// One member and their Access list: every grant that reaches them — on the
// workspace, a group, a connection or a storage destination; their own, a
// group's or everyone's — and what they own.
app.get('/api/workspaces/:id/members/:userId', async (req, res) => {
  if (!(await requireMember(req, res, req.params.id))) return
  const member = await getWorkspaceMember(req.params.id, req.params.userId)
  if (!member) return res.status(404).json({ error: 'Not a member of this workspace' })
  res.json(member)
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
  // `locked`: its database is turned off on this instance — listed, so nobody
  // wonders where it went, but nothing on it works until it's back on.
  res.json((await openableConnections(workspaceId, user.id)).map((c) => ({ ...c, locked: !isModuleEnabled(c.type) })))
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

// The node mirroring a connection in Hayat's tree.
const mirrorConnection = (conn, parentNodeId) =>
  hayat.upsertResource({
    type: CONNECTION_TYPE,
    externalId: conn.id,
    name: conn.name,
    parent: parentNodeId ? hayat.nodeRef(parentNodeId) : hayat.ref(TENANT_TYPE, conn.workspaceId),
    ownerId: conn.ownerId,
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
    assertModuleEnabled(req.body.type)
    await assertGatewayForWorkspace(req.body.sshGatewayId, workspaceId)
  } catch (error) {
    return fail(res, error)
  }
  // Default the owner to the creating user (unless one was explicitly provided).
  const conn = { ...req.body, id: randomUUID(), workspaceId, ownerId: req.body.ownerId || user.id }
  await saveConnection(conn)
  // Mirror it into Hayat's tree, where its access is granted. `parentNodeId` (a
  // Hayat group) files it straight into a group; without one it lands under the
  // workspace. If Hayat refuses, the connection isn't kept: a connection Hayat
  // doesn't know is one nobody could ever be granted.
  try {
    await mirrorConnection(conn, req.body.parentNodeId)
  } catch (error) {
    await deleteConnectionMetadata(conn.id)
    return fail(res, error, 502)
  }
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
    assertModuleEnabled(document?.connection?.type)
    const imported = await importConnectionDoc(document, { workspaceId, ownerId: user.id, name, settings })
    try {
      await mirrorConnection({ ...imported, workspaceId, ownerId: user.id })
    } catch (error) {
      await deleteConnectionMetadata(imported.id)
      throw error
    }
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
  try {
    await hayat.upsertResource({ type: STORAGE_TYPE, externalId: dest.id, name: dest.name, parent: hayat.ref(TENANT_TYPE, body.workspaceId), ownerId: user.id })
  } catch (error) {
    await deleteStorage(dest.id)
    return fail(res, error, 502)
  }
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
  await hayat.updateResource({ type: STORAGE_TYPE, externalId: req.params.sid, name: merged.name.trim(), workspaceId: merged.workspaceId })
  res.json(await updateStorage(req.params.sid, merged))
})

app.delete('/api/storages/:sid', async (req, res) => {
  if (await isStorageInUse(req.params.sid)) {
    return res.status(409).json({ error: 'This storage destination is used by a workflow and cannot be deleted.' })
  }
  await hayat.deleteResource(STORAGE_TYPE, req.params.sid)
  await deleteStorage(req.params.sid)
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
  // Its database turned off in Admin → Modules: the connection is locked —
  // kept exactly as it is, but nothing opens, edits, exports or backs it up.
  // Deleting it is the one way out, so its owner can still clean up. The
  // handshake passes too: the db layer refuses the engine before dialing and
  // answers `reason: 'disabled'`, which is how the console explains the lock.
  const deleting = req.method === 'DELETE' && (req.path === '/' || req.path === '')
  const diagnosing = req.method === 'GET' && req.path === '/handshake'
  if (!isModuleEnabled(conn.type) && !deleting && !diagnosing) return res.status(403).json({ error: moduleOffMessage(conn.type), locked: true })
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
  if (!(await canManageConnection(conn, authUser(req).id))) {
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
  if (updated.name !== existing.name) {
    await hayat.updateResource({ type: CONNECTION_TYPE, externalId: req.params.id, name: updated.name, workspaceId: existing.workspaceId })
  }

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

  // Its mirror first — Hayat takes every grant made on it along — then the rows.
  if (conn.workspaceId) await hayat.deleteResource(CONNECTION_TYPE, req.params.id)
  await deleteConnectionMetadata(req.params.id)
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
  // Resolved at the connection, so a grant on this one connection's node (or the
  // group it is filed in) is enough — not only one on the whole workspace.
  if (!(await permissionsAtConnection(conn.id, authUser(req).id)).has('connections.transfer')) {
    return res.status(403).json({ error: 'You do not have permission to do that.', permission: 'connections.transfer' })
  }

  const ownerId = req.body?.ownerId
  if (!ownerId) return res.status(400).json({ error: 'ownerId is required.' })
  if (!(await isMember(conn.workspaceId, ownerId))) return res.status(400).json({ error: 'That person is not a member of this workspace.' })

  // Hayat's node owner is what the decision rule reads; our column is what the
  // console shows. Hayat first, so a refusal leaves both as they were.
  await hayat.updateResource({ type: CONNECTION_TYPE, externalId: conn.id, name: conn.name, ownerId, workspaceId: conn.workspaceId })
  await saveConnection({ ...conn, ownerId })
  res.json(await getConnection(req.params.id))
})

// ---- Connection access: who may open it ----
// Read-only here: opening a connection is the `connection.open` permission in
// Hayat, granted on the connection (or a group above it) in Hayat's console.
// `people` is Hayat's resolved answer — every grant, group roster and ownership
// that reaches it — never the raw grant list; `manageUrl` opens its node there.
app.get('/api/connections/:id/access', async (req, res) => {
  const conn = await getConnection(req.params.id)
  const resource = hayat.ref(CONNECTION_TYPE, req.params.id)
  const [subjects, node] = await Promise.all([hayat.lookupSubjects(hayatKey('connection.open'), resource), hayat.getResource(resource)])
  const people = await hayat.getUsers(subjects.map((s) => s.userId))
  res.json({
    people: subjects.map((s) => ({
      userId: s.userId,
      name: people.get(s.userId)?.name || null,
      email: people.get(s.userId)?.email || null,
      reason: s.reason,
    })),
    parentNodeId: node?.parentNodeId || null,
    manageUrl: node && conn?.workspaceId ? hayat.consoleLink(`/resource-tree/${conn.workspaceId}/${node.nodeId}`) : null,
  })
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
    res.json(await createWorkflow(req.params.id, req.body, { ownerId: authUser(req).id }))
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
  // Outside the connection guard, so the lock is checked here too: a workflow on
  // a connection whose database is turned off doesn't run.
  if (!isModuleEnabled(conn.type)) return res.status(403).json({ error: moduleOffMessage(conn.type), locked: true })
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
  const people = await hayat.getUsers(rows.flatMap((r) => [r.createdBy, r.updatedBy])).catch(() => new Map())
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
    res.json(await createDashboard(req.params.id, req.body, { ownerId: authUser(req).id }))
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

// Every backup and restore route is the Backup module's: off, they answer 403.
// Schedules and run history stay put and resume when it's turned back on.
app.use(['/api/connections/:id/backup', '/api/connections/:id/restore'], (_req, res, next) => {
  try {
    assertModuleEnabled('backup')
    next()
  } catch (error) {
    fail(res, error)
  }
})

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
    const ext = wantConfig ? 'connection.json' : db.dumpExtensionFor(conn)
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

// The engine's release ("16.4"), for the status bar and the command reference.
// Always 200 — `version: null` when the engine can't say or isn't reachable.
app.get('/api/connections/:id/server-version', async (req, res) => {
  const conn = await connOr404(req, res)
  if (!conn) return
  try {
    res.json({ version: (await db.serverVersion(conn, queryCtx(req))) || null })
  } catch (error) {
    res.json({ version: null, error: error.message })
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
    // Opening a table fetches at most the engine's row limit (Admin → Modules),
    // whatever the client asks for. Export pages through the db layer, not here.
    const cap = optionalModuleSetting(conn.type, 'tableRowLimit') ?? Infinity
    const limit = Math.min(parseInt(req.query.limit) || 200, cap)
    res.json(await db.getTableData(conn, queryCtx(req), { table: req.params.table, limit }))
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
  const { sql, page } = req.body
  if (!sql || !sql.trim()) return res.status(400).json({ error: 'SQL query required' })
  const isCount = (n, min) => Number.isInteger(n) && n >= min
  if (page !== undefined && !(isCount(page?.limit, 1) && isCount(page?.offset, 0))) {
    return res.status(400).json({ error: 'page needs an integer limit ≥ 1 and offset ≥ 0' })
  }
  try {
    res.json(await db.runQuery(conn, bodyCtx(req), sql, { page }))
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

// The server's own reference for one command (COMMAND DOCS + COMMAND INFO), for
// the console's command reference. Always 200 — `available: false` says why not.
app.get('/api/connections/:id/redis/command-docs', async (req, res) => {
  const conn = await requireRedis(req, res)
  if (!conn) return
  const name = String(req.query.name || '')
  if (!/^[A-Za-z][\w-]*$/.test(name)) return res.status(400).json({ error: 'A command name is required.' })
  try {
    res.json(await redis.commandDocs(conn, queryCtx(req), name))
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
// Streams: topics, messages, consumer groups (Kafka today)
// ============================================================================
// A log-shaped engine's own browsing, beside the generic /query route its
// console commands ride. Each op is a generic dispatcher in server/db: an engine
// without the stream capability answers 400 naming its type, so there is no
// engine check here — only authorize (the /api/connections/:id guard above) →
// validate → call → respond. Deleting a topic or group, and applying an offset
// reset, must echo the name back as `confirm`.

const confirmed = (req, res, name) => {
  if (req.body?.confirm === name) return true
  res.status(400).json({ error: `Type "${name}" as "confirm" to go ahead — this cannot be undone.` })
  return false
}

// Cluster summary for the sidebar header: id, brokers, controller, topic counts.
app.get('/api/connections/:id/streams/overview', async (req, res) => {
  const conn = await connOr404(req, res)
  if (!conn) return
  try {
    res.json(await db.streamOverview(conn, queryCtx(req)))
  } catch (error) {
    fail(res, error)
  }
})

// Topics for the sidebar tree. `?pattern=orders.*` (glob, or a substring), `&internal=1`.
app.get('/api/connections/:id/streams/topics', async (req, res) => {
  const conn = await connOr404(req, res)
  if (!conn) return
  try {
    res.json(await db.listTopics(conn, queryCtx(req), { pattern: String(req.query.pattern || ''), internal: truthy(req.query.internal) }))
  } catch (error) {
    fail(res, error)
  }
})

// Create a topic. Body: { name, partitions?, replication?, configs?, validateOnly? }.
app.post('/api/connections/:id/streams/topics', async (req, res) => {
  const conn = await connOr404(req, res)
  if (!conn) return
  const { name, partitions, replication, configs, validateOnly } = req.body || {}
  if (!name) return res.status(400).json({ error: 'A topic name is required.' })
  try {
    res.json(await db.createTopic(conn, queryCtx(req), { name: String(name).trim(), partitions, replication, configs: configs || {}, validateOnly: Boolean(validateOnly) }))
  } catch (error) {
    fail(res, error)
  }
})

// One topic: partitions (leader, replicas, ISR, offsets) and its configs.
app.get('/api/connections/:id/streams/topics/:topic', async (req, res) => {
  const conn = await connOr404(req, res)
  if (!conn) return
  try {
    res.json(await db.describeTopic(conn, queryCtx(req), req.params.topic))
  } catch (error) {
    fail(res, error)
  }
})

// Change a topic. Body: { configs?: { key: value | null }, partitions?: n } —
// configs merge into the current overrides (null removes one); partitions only grow.
app.patch('/api/connections/:id/streams/topics/:topic', async (req, res) => {
  const conn = await connOr404(req, res)
  if (!conn) return
  const { configs, partitions } = req.body || {}
  if (!configs && partitions == null) return res.status(400).json({ error: 'Nothing to change — send configs and/or partitions.' })
  try {
    res.json(await db.alterTopic(conn, queryCtx(req), req.params.topic, { configs, partitions }))
  } catch (error) {
    fail(res, error)
  }
})

// Delete a topic and every message in it. Body: { confirm: <topic> }.
app.delete('/api/connections/:id/streams/topics/:topic', async (req, res) => {
  const conn = await connOr404(req, res)
  if (!conn) return
  if (!confirmed(req, res, req.params.topic)) return
  try {
    res.json(await db.deleteTopic(conn, queryCtx(req), req.params.topic))
  } catch (error) {
    fail(res, error)
  }
})

// Empty a topic and keep it (configs, consumers). Body: { confirm: <topic>, partitions?: [n] }.
app.delete('/api/connections/:id/streams/topics/:topic/messages', async (req, res) => {
  const conn = await connOr404(req, res)
  if (!conn) return
  if (!confirmed(req, res, req.params.topic)) return
  try {
    res.json(await db.clearTopic(conn, queryCtx(req), req.params.topic, { partitions: req.body?.partitions }))
  } catch (error) {
    fail(res, error)
  }
})

// A bounded read: `?partition=&from=latest|earliest|-N|offset:N|ts:<ISO>&limit=&filter=&decode=auto|string|json|hex|base64`.
// Joins no consumer group and commits nothing.
app.get('/api/connections/:id/streams/topics/:topic/messages', async (req, res) => {
  const conn = await connOr404(req, res)
  if (!conn) return
  try {
    res.json(
      await db.readMessages(conn, queryCtx(req), {
        topic: req.params.topic,
        partition: req.query.partition,
        from: req.query.from ? String(req.query.from) : 'latest',
        limit: req.query.limit,
        filter: req.query.filter ? String(req.query.filter) : '',
        decode: req.query.decode ? String(req.query.decode) : 'auto',
      })
    )
  } catch (error) {
    fail(res, error)
  }
})

// Produce one message. Body: { key?, value, headers?, partition?, keySchema?, valueSchema? } — value
// null is a tombstone; a schema ({ subject, version?, message? }) writes that side from its JSON.
app.post('/api/connections/:id/streams/topics/:topic/messages', async (req, res) => {
  const conn = await connOr404(req, res)
  if (!conn) return
  const { key, value, headers, partition, keySchema, valueSchema } = req.body || {}
  if (value === undefined) return res.status(400).json({ error: 'A value is required (null sends a tombstone).' })
  try {
    res.json(await db.produceMessage(conn, queryCtx(req), { topic: req.params.topic, key, value, headers, partition, keySchema, valueSchema }))
  } catch (error) {
    fail(res, error)
  }
})

// Consumer groups with state, member count, topics and total lag.
app.get('/api/connections/:id/streams/groups', async (req, res) => {
  const conn = await connOr404(req, res)
  if (!conn) return
  try {
    res.json(await db.listGroups(conn, queryCtx(req)))
  } catch (error) {
    fail(res, error)
  }
})

// One group: members and per-partition committed offset, log end and lag.
app.get('/api/connections/:id/streams/groups/:group', async (req, res) => {
  const conn = await connOr404(req, res)
  if (!conn) return
  try {
    res.json(await db.describeGroup(conn, queryCtx(req), req.params.group))
  } catch (error) {
    fail(res, error)
  }
})

// Reset a group's offsets on one topic. Body: { topic, strategy: earliest|latest|timestamp|offset|shift,
// value?, partitions?, dryRun = true, confirm } — `confirm` (the group id) only when applying.
app.put('/api/connections/:id/streams/groups/:group/offsets', async (req, res) => {
  const conn = await connOr404(req, res)
  if (!conn) return
  const { topic, strategy, value, partitions } = req.body || {}
  const dryRun = req.body?.dryRun !== false
  if (!dryRun && !confirmed(req, res, req.params.group)) return
  try {
    res.json(await db.resetOffsets(conn, queryCtx(req), req.params.group, { topic, strategy, value, partitions, dryRun }))
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, ...(error.reason ? { reason: error.reason } : {}) })
  }
})

// Delete a consumer group (it must have no active members). Body: { confirm: <group> }.
app.delete('/api/connections/:id/streams/groups/:group', async (req, res) => {
  const conn = await connOr404(req, res)
  if (!conn) return
  if (!confirmed(req, res, req.params.group)) return
  try {
    res.json(await db.deleteGroup(conn, queryCtx(req), req.params.group))
  } catch (error) {
    fail(res, error)
  }
})

// Brokers with leadership, replica, out-of-sync and skew counts, plus cluster totals.
app.get('/api/connections/:id/streams/brokers', async (req, res) => {
  const conn = await connOr404(req, res)
  if (!conn) return
  try {
    res.json(await db.listBrokers(conn, queryCtx(req)))
  } catch (error) {
    fail(res, error)
  }
})

// One broker's configuration; `dynamic` marks an override set at runtime.
app.get('/api/connections/:id/streams/brokers/:broker', async (req, res) => {
  const conn = await connOr404(req, res)
  if (!conn) return
  try {
    res.json(await db.describeBroker(conn, queryCtx(req), req.params.broker))
  } catch (error) {
    fail(res, error)
  }
})

// Change a broker's dynamic configs. Body: { configs: { key: value | null } } — merged into its overrides.
app.patch('/api/connections/:id/streams/brokers/:broker', async (req, res) => {
  const conn = await connOr404(req, res)
  if (!conn) return
  const { configs } = req.body || {}
  if (!configs || typeof configs !== 'object') return res.status(400).json({ error: 'Nothing to change — send configs.' })
  try {
    res.json(await db.alterBroker(conn, queryCtx(req), req.params.broker, { configs }))
  } catch (error) {
    fail(res, error)
  }
})

// ---- Schema registry ----------------------------------------------------------
// The connection's Schema Registry (its URL and credentials are connection
// settings); a connection without one answers 400.

// Every subject with its latest version and type, plus the registry-wide compatibility.
app.get('/api/connections/:id/streams/schemas', async (req, res) => {
  const conn = await connOr404(req, res)
  if (!conn) return
  try {
    res.json(await db.listSchemas(conn, queryCtx(req)))
  } catch (error) {
    fail(res, error)
  }
})

// The registry-wide compatibility rule. Body: { compatibility }.
app.put('/api/connections/:id/streams/schemas/config', async (req, res) => {
  const conn = await connOr404(req, res)
  if (!conn) return
  try {
    res.json(await db.setSchemaCompatibility(conn, queryCtx(req), null, req.body?.compatibility))
  } catch (error) {
    fail(res, error)
  }
})

// One subject: every version's schema and its compatibility.
app.get('/api/connections/:id/streams/schemas/:subject', async (req, res) => {
  const conn = await connOr404(req, res)
  if (!conn) return
  try {
    res.json(await db.describeSchema(conn, queryCtx(req), req.params.subject))
  } catch (error) {
    fail(res, error)
  }
})

// Register a schema (new subject or next version). Body: { schema, type: AVRO|PROTOBUF|JSON,
// references?, validateOnly? } — validateOnly only tests it against the subject's compatibility.
app.post('/api/connections/:id/streams/schemas/:subject', async (req, res) => {
  const conn = await connOr404(req, res)
  if (!conn) return
  const { schema, type, references, validateOnly } = req.body || {}
  try {
    res.json(await db.registerSchema(conn, queryCtx(req), req.params.subject, { schema, type, references, validateOnly: Boolean(validateOnly) }))
  } catch (error) {
    fail(res, error)
  }
})

// A subject's own compatibility rule. Body: { compatibility } — null goes back to the registry's.
app.put('/api/connections/:id/streams/schemas/:subject/config', async (req, res) => {
  const conn = await connOr404(req, res)
  if (!conn) return
  try {
    res.json(await db.setSchemaCompatibility(conn, queryCtx(req), req.params.subject, req.body?.compatibility ?? null))
  } catch (error) {
    fail(res, error)
  }
})

// Delete a subject or one version. Body: { confirm: <subject>, version?, permanent? }.
app.delete('/api/connections/:id/streams/schemas/:subject', async (req, res) => {
  const conn = await connOr404(req, res)
  if (!conn) return
  if (!confirmed(req, res, req.params.subject)) return
  const { version, permanent } = req.body || {}
  try {
    res.json(await db.deleteSchema(conn, queryCtx(req), req.params.subject, { version, permanent: Boolean(permanent) }))
  } catch (error) {
    fail(res, error)
  }
})

// ---- ACLs ---------------------------------------------------------------------------

// ACL bindings. `?principal=User:alice&resourceType=TOPIC&resourceName=orders` narrow it.
app.get('/api/connections/:id/streams/acls', async (req, res) => {
  const conn = await connOr404(req, res)
  if (!conn) return
  const { principal, resourceType, resourceName } = req.query
  try {
    res.json(await db.listAcls(conn, queryCtx(req), { principal: principal || undefined, resourceType: resourceType || undefined, resourceName: resourceName || undefined }))
  } catch (error) {
    fail(res, error)
  }
})

// Add bindings. Body: { acls: [{ principal, host?, operation, permission?, resourceType, resourceName, patternType? }] }.
app.post('/api/connections/:id/streams/acls', async (req, res) => {
  const conn = await connOr404(req, res)
  if (!conn) return
  try {
    res.json(await db.createAcls(conn, queryCtx(req), req.body?.acls))
  } catch (error) {
    fail(res, error)
  }
})

// Remove bindings, each matched exactly. Body: { acls: [...] } as listed.
app.delete('/api/connections/:id/streams/acls', async (req, res) => {
  const conn = await connOr404(req, res)
  if (!conn) return
  try {
    res.json(await db.deleteAcls(conn, queryCtx(req), req.body?.acls))
  } catch (error) {
    fail(res, error)
  }
})

// ---- Connectors ----------------------------------------------------------------------
// The connection's Kafka Connect cluster; a connection without one answers 400.

// Every connector with its state, class and tasks.
app.get('/api/connections/:id/streams/connectors', async (req, res) => {
  const conn = await connOr404(req, res)
  if (!conn) return
  try {
    res.json(await db.listConnectors(conn, queryCtx(req)))
  } catch (error) {
    fail(res, error)
  }
})

// The connector classes the workers have installed.
app.get('/api/connections/:id/streams/connector-plugins', async (req, res) => {
  const conn = await connOr404(req, res)
  if (!conn) return
  try {
    res.json(await db.listConnectorPlugins(conn, queryCtx(req)))
  } catch (error) {
    fail(res, error)
  }
})

// One connector: state, tasks with failure traces, config, topics.
app.get('/api/connections/:id/streams/connectors/:name', async (req, res) => {
  const conn = await connOr404(req, res)
  if (!conn) return
  try {
    res.json(await db.describeConnector(conn, queryCtx(req), req.params.name))
  } catch (error) {
    fail(res, error)
  }
})

// Create a connector or replace its config. Body: { config: { 'connector.class': …, … }, validateOnly? }.
app.put('/api/connections/:id/streams/connectors/:name', async (req, res) => {
  const conn = await connOr404(req, res)
  if (!conn) return
  const { config, validateOnly } = req.body || {}
  try {
    res.json(
      validateOnly
        ? await db.validateConnector(conn, queryCtx(req), req.params.name, config)
        : await db.saveConnector(conn, queryCtx(req), req.params.name, config)
    )
  } catch (error) {
    fail(res, error)
  }
})

// A lifecycle action. Body: { action: pause|resume|stop|restart|restartTask|resetOffsets, task?, onlyFailed? }.
app.post('/api/connections/:id/streams/connectors/:name/actions', async (req, res) => {
  const conn = await connOr404(req, res)
  if (!conn) return
  const { action, task, onlyFailed } = req.body || {}
  try {
    res.json(await db.connectorAction(conn, queryCtx(req), req.params.name, { action, task, onlyFailed: Boolean(onlyFailed) }))
  } catch (error) {
    fail(res, error)
  }
})

// Delete a connector. Body: { confirm: <name> }.
app.delete('/api/connections/:id/streams/connectors/:name', async (req, res) => {
  const conn = await connOr404(req, res)
  if (!conn) return
  if (!confirmed(req, res, req.params.name)) return
  try {
    res.json(await db.deleteConnector(conn, queryCtx(req), req.params.name))
  } catch (error) {
    fail(res, error)
  }
})

// ---- Streaming SQL ----------------------------------------------------------------------
// The connection's ksqlDB; a connection without one answers 400.

// Run statements, or one bounded query. Body: { sql, properties?, limit? }.
app.post('/api/connections/:id/streams/sql', async (req, res) => {
  const conn = await connOr404(req, res)
  if (!conn) return
  const { sql, properties, limit } = req.body || {}
  try {
    res.json(await db.runStreamSql(conn, queryCtx(req), { sql, properties: properties || {}, limit }))
  } catch (error) {
    fail(res, error)
  }
})

// Streams, tables and running queries.
app.get('/api/connections/:id/streams/sql/catalog', async (req, res) => {
  const conn = await connOr404(req, res)
  if (!conn) return
  try {
    res.json(await db.streamSqlCatalog(conn, queryCtx(req)))
  } catch (error) {
    fail(res, error)
  }
})

// ============================================================================
// System / Updates
// ============================================================================

// The running app's identity — cheap; used by the wizard's verify-poll.
app.get('/api/system/version', async (req, res) => {
  if (!requireAuth(req, res)) return
  res.json({ name: APP_NAME, version: APP_VERSION, sha: GIT_SHA })
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

// The API reference. Public on purpose: it describes the open-source app, not
// this instance, and says nothing /api/health doesn't about what is running.
app.get('/api/openapi.json', (_req, res) => res.json(openApiSpec()))
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(null, swaggerUiOptions))

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
    if (isModuleEnabled('backup')) runDueBackups().catch((e) => console.error('Backup scheduler tick error:', e.message))
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
  console.log(`🪪 Sign-in and access: Hayat at ${hayat.signInConfig().issuer}`)
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
  hayat.stopHayat()
  await closeSessionStore().catch(() => {})
  await closeMeta().catch(() => {})
  process.exit(0)
})
