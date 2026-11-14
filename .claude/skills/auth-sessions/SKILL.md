---
name: auth-sessions
description: Signing in and authorization over Hayat — server/hayat (the service API client, cached decisions, Watch, resource mirrors), server/auth.js guards, server/permissions-catalog.js (permission keys and tabletsgo's Hayat contract), the Hayat import bundle, connection sessions and the max-sessions limit, and instance SMTP. Use this skill when touching server/auth.js, server/hayat/*, server/permissions-catalog.js, server/sessions/*, server/workspaces.js, server/mail.js or server/app-settings.js; when adding a route that needs authorization or a new permission; when working on sign-in, members, workspaces, groups, roles or who may open a connection; when mirroring a resource into Hayat; when working on session limits or `SessionLimitError`; or when sending email from the server.
---

# Auth (Hayat), sessions & mail

## The model in one paragraph

**Hayat owns identity and authorization; tabletsgo keeps none of it** (decided
2026-11-10, migration `20261110000000_hayat_owns_identity` dropped the old tables).
People sign in at Hayat — an OpenID provider — with the console as a public client
(code + PKCE, `oidc-client-ts`), and every API call carries the Hayat access token.
A workspace *is* a Hayat **tenant**; its roster, groups, roles and grants are edited
in Hayat's console. Tabletsgo asks Hayat's service API (`server/hayat/`) every
question and mirrors the two resources it owns — connections and storage
destinations — into Hayat's tree so grants can be made on them.

## Asking: `server/hayat/`

- `connect.js` — the wire: Connect protocol over `fetch` (unary JSON POSTs to
  `/<pkg>.<Service>/<Method>`, Watch as length-prefixed frames), the
  client-credentials token (`HAYAT_CLIENT_ID/SECRET`), offline JWT verification
  against Hayat's JWKS (`jose`). No generated code. Discovery, token and JWKS go
  to `HAYAT_AUTH_URL` (default the issuer) — the browser and the server may reach
  the auth role at different addresses; the `iss` check is always the issuer.
- `index.js` — tabletsgo's vocabulary: `verifyAccessToken` (also checks the token
  was issued to `HAYAT_WEB_CLIENT_ID`), `getUser(s)`, `userTenants`,
  `tenantMembers`, `tenantGrants` (what each member was granted — Hayat's
  `DirectoryService.ListTenantGrants`, for the Member pages' roles and Access
  list; display only, a decision is still `permissionsAt`/`check`), `permissionsAt`/`check`, `lookupSubjects`, `upsertResource` /
  `updateResource` / `deleteResource`, `startHayat` (publishes the contract, starts
  Watch), `consoleLink`.
- **Caching lives only here.** Decisions are cached ~10 s keyed by tenant; Hayat's
  Watch stream drops a tenant's entries the moment it changes (all of them on a
  global event, and on reconnect). Our own writes drop the tenant too and send
  `atLeastRev` for 2 s (read-your-writes). Never keep a Hayat answer anywhere else.
- Tests swap the transport with `useHayatBackend({ call, watch, verify })` —
  see `tests/hayat.test.js` for a fake.

## Guards: `server/auth.js`

`sessionMiddleware` verifies the bearer token, loads the person from Hayat's
directory (inactive ⇒ signed out) and asks once whether they hold
`tabletsgo.instance.manage` at Hayat's root (`role: 'admin'`). `requireAuth` and
`requireSystemAdmin` stay **sync** reads of `req.authUser`.

Workspace guards are **async** and ask by permission:
`if (!(await requirePermission(req, res, wsId, 'storage.manage'))) return`.
`isMember` is the tenant roster (`ListUserTenants`). `permissionsIn` is Hayat's
`PermissionsAt` at the tenant node, mapped back to short keys (unknown keys
dropped; `instance.manage` never counts at a workspace).

Connections:
- **Open** = `connection.open` at the connection node (`userCanAccessConnection`).
  Hayat's rule: owner short-circuit, grants with `inherit`, the roster of a
  `hayat/group` ancestor (the contract sets `via_placement`, never the tenant
  itself), membership required (`requires_membership`). Nothing granted means nobody.
- **Manage the record** = own it, or `connections.manage` resolved *at the
  connection* (`canManageConnection`). **Transfer** = `connections.transfer` at the
  connection; Hayat's node owner is changed first, then our `owner_id` column.

## Permissions and the contract: `server/permissions-catalog.js`

A leaf module. Each entry: the short `key` routes use, its `hayat` key, the
`scope` (shallowest node type it means anything at) and whether tabletsgo's
contract declares it (`tabletsgo.*`) or it is Hayat's own (`hayat.members.manage`,
`hayat.groups.manage`, `hayat.resources.*` — shown so the console can point at
Hayat). `contractManifest()` builds the contract tabletsgo publishes at boot:
types `connection` (access: `connection.open`, placement, membership) and
`storage`; default roles `admin` (root), `owner`, `connection-user`,
`connection-manager`.

**Adding a permission:** add the entry, use it in a route, bump
`CONTRACT_VERSION`. Versions only add; the new one goes live as soon as it is
published, since it touches only tabletsgo's own namespace. Until it is
published Hayat doesn't know the key and every check for it answers no.

## Mirrors

`POST /api/connections` (and import) save the row, then `upsertResource` under
the tenant or `parentNodeId` (a Hayat group); a refusal deletes the row. Rename
and re-own go through `updateResource` (keeps the current parent). Delete removes
the mirror first. Storage destinations the same. `DELETE /api/workspaces/:id`
removes every mirror, then tabletsgo's data; the tenant stays in Hayat.
Dashboards and workflows are **not** mirrored.

## Moving an existing install: the import bundle

The migrator, right before the drop, writes `data/hayat-import-<time>.json`
(`server/migrator/hayat-export.js`; `npm run hayat:bundle` does it by hand, and
writes a contract-only bundle on a fresh install). `hayat import --file … --app-url …`
loads it (`--admin <email>` on the script adds a first admin — a pending account
with `tabletsgo.admin` at the root, who finishes by signing up at Hayat; Hayat's
console has no root grants, so this is how a fresh install gets one —
`npm run dev:hayat` runs the whole thing on its first run in development): users with their ids (the old unsalted SHA-256 hash becomes
`$sha256$<hex>`, verified once and upgraded to argon2id), workspaces → tenants
with their ids, groups and rosters, connections/storage as resources, built-in
`owner` → Hayat's Tenant admin + `tabletsgo.owner`, `member` → nothing, custom
roles → admin-owned roles, `connection_access` rows → `connection-user` grants,
instance admins → `tabletsgo.admin` at the root. An email Hayat already knew keeps
its Hayat id; `npm run hayat:remap -- result.json` rewrites tabletsgo's columns.

## Connection sessions

`server/sessions` now holds only connection sessions, in process memory
(`sessions/memory.js`). There is no login session to store — a login is a Hayat
token. **Don't add an external store**: a connection session describes a socket
in this process, so the limit is honestly per replica.

### What a session *is*

**A session is one open connection to a database — not a browser tab.** It maps to
the driver handle: the Postgres pool for a database, the ioredis client for a db
index, the SQLite file handle. Five people browsing the same database share one
session and appear as its `participants`.

The db layer registers them itself: `gatedRequired`/`gatedOptional` call
`enterSession` before the driver opens anything, so a session exists exactly as
long as the app really uses the connection. There is deliberately **no "open
session" endpoint** — an explicit lifecycle would drift out of sync with the actual
sockets. An idle session expires after `SESSION_IDLE_TTL_MS` and the minutely
sweeper releases its handle; the next query transparently opens a new one.

### The limit

Resolves most-specific-first: workspace (`settings.sessions.maxPerConnection`) →
`MAX_SESSIONS_PER_CONNECTION` → unlimited. 0 at both levels = unlimited, which is
the shipped default.

A connection carries **no override of its own** — a cap protects the database
server, so it's a workspace-owner decision rather than one re-answered on every
connection. (`connections.max_sessions` survives as an unread column: migrations
are additive-only.)

Exceeding it throws `SessionLimitError` (429); the handshake reports it as
`reason:'at_capacity'` with the session list, so the connect dialog can name who's
holding them. **Backup and restore are not gated** — a scheduled dump must not fail
because people are browsing. The limit counts what *this* process holds, so across
replicas it applies per replica.

Rules of thumb: **sessions must never depend on the db layer** (it hands them a
release callback via `setReleaseHandler` instead); a store write on the hot path is
skipped for `TOUCH_INTERVAL_MS`, which is clamped to a third of the idle TTL so a
live session can't expire underneath the process holding it.

## Email / SMTP

**There is exactly one mail server per instance, and only an instance admin sets
it.** Mail is an instance-level concern — who sends the instance's notices isn't a
workspace owner's decision — so nothing outside `server/mail.js` +
`server/app-settings.js` knows how it's configured, and **no caller passes a
workspace**.

| Layer | Where it lives | Who edits it |
| --- | --- | --- |
| Admin config | `app_settings` key `'smtp'` (`server/app-settings.js`) | an instance admin (`/api/admin/smtp`, Administration → Email) |
| Env | `SMTP_*` | whoever deploys the container |

`smtpConfig()` in `server/mail.js` is the only resolver: the admin config if it
names a host, else the env vars, else `null`. It tags the result with `source`
(`'global' | 'env'`) purely so the UI can say where the settings came from —
**never branch on it**. `publicSmtpConfig()` is the password-stripped form routes
hand a client (a workspace owner sees it read-only on the Notification page, so "no
mail server configured" is visible where it matters).

Rules:

- The saved password is AES-256-GCM sealed under its own scrypt namespace
  (`APP_SETTINGS_KEY`) and **never** leaves the server — reads report
  `hasPassword`, and a save that omits `pass` keeps the stored one.
- The env layer stays supported forever (an existing deployment must keep sending
  mail after an upgrade); it's the *fallback*, not the source of truth, so anything
  an operator might want to change belongs in the admin config, where it changes
  without a redeploy.
- Mail is optional at both layers: with neither configured, backup-failure and
  module notices simply aren't sent. (Invites, password resets and sign-up mail are
  Hayat's, sent by Hayat's own mail server.)

> Per-workspace SMTP was removed in meta migration v10, which promotes a
> workspace's config to the instance config when nothing else answers (see the step
> for why "nothing else"). `workspaces.settings.smtp` may still exist in old rows —
> **dead data, never read it.**
