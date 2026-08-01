---
name: auth-sessions
description: Authentication, the two-tier role model (system admin vs workspace owner/member), route guards, brute-force login blocking, the session store (durable logins vs cache-only connection sessions), the max-sessions limit, and instance SMTP/mail configuration. Use this skill when touching server/auth.js, server/sessions/*, server/login-guard.js, server/users.js, server/workspaces.js, server/mail.js or server/app-settings.js; when adding a route that needs authorization or a new guard; when working on login/signup/invite/password-reset/accept-invite; when changing roles, permissions, members, teams or connection access; when working on session limits or `SessionLimitError`; or when sending email from the server.
---

# Auth, sessions & mail

## Auth model

Login/setup/accept-invite return `{ user, token }`; the token is stored in
localStorage (`dbm.token`) and attached as `Authorization: Bearer` by
`shared/api/request.ts`. Server-side the token's source of truth is the meta DB's
`sessions` table, read through a cache.

> **Never make `requireAuth` async.** The store is async while `requireAuth` is
> called synchronously by ~100 routes, so `sessionMiddleware` resolves the token
> once per request onto `req.authUser`. Resolve in middleware; keep the guards sync.

### Roles are two independent tiers. Don't collapse them.

| Tier | Column | Values | Scope |
| --- | --- | --- | --- |
| System | `users.role` (surfaced as `user.role`) | `admin` \| `user` | The instance. An `admin` manages workspaces and accounts through `/api/admin/*` and **holds no workspace membership at all** — `memberRole()` returns null for them, so every workspace-scoped guard denies them. Instance administration deliberately carries no data access. |
| Workspace | `workspace_members.role` | `owner` \| `member` | One workspace. `owner` manages it (members, teams, settings, connections, storage destinations); a workspace may have **any number of owners but never zero**. `member` uses the connections they've been granted: full database access (query, row edits, workflows, dashboards, schema changes) but no create/edit/delete of the connection *record*. |

The guards live in `server/auth.js`: `requireSystemAdmin` (system),
`requireOwner`/`requireMember` (workspace), plus `requireConnectionOwner` in
`server.js` for the routes that change a connection record. **A route should use a
guard, not compare role strings** — the one place a literal is still read is
`memberRole`, which normalizes the pre-v8 spelling `admin` → `owner`.

Two invariants the routes enforce, both easy to break from a new code path:

1. **An instance admin can never be added to a workspace** — invite, role change,
   and workspace creation all refuse.
2. **A workspace can never lose its last owner** — demote, remove, delete-user and
   promote-to-admin all refuse, the last two with `409` + the affected workspaces.

Connections carry a `workspace_id` column and are filtered by the caller's current
workspace.

### Brute-force blocking

`server/login-guard.js` is a third, orthogonal thing — not a role and not
`users.status`. `LOGIN_MAX_ATTEMPTS` consecutive failures inside
`LOGIN_ATTEMPT_WINDOW_MS` set `users.locked_at` and the account can't sign in until
an instance admin lifts it (`POST /api/admin/users/:id/unblock`) or its password is
changed.

It lives on the account, not in memory, so a block survives a restart and is
visible in the admin user list; `users.status` keeps meaning the invite lifecycle
(`active` | `pending`) only. The check runs **before** the password is verified — a
blocked account can't be probed, and a correct password doesn't bypass the block.

> **An instance admin is never blocked indefinitely.** Blocking the last one would
> leave nobody able to unblock anyone, so they get `LOGIN_ADMIN_COOLDOWN_MS` (a
> `locked_until` that always expires) instead. Keep that asymmetry if you touch
> this — it is what stops an attacker from locking the operator out on purpose.

## Sessions

Two things share one store (`server/sessions`) but are **stored differently, on
purpose**:

- **Logins** (bearer tokens) are *durable*: the meta DB's `sessions` table is the
  source of truth (`sessions/db.js`), read through a cache (`sessions/hybrid.js`).
  A login survives a restart and a dropped cache — a cache failure degrades to a
  slower DB read and warns once; it never signs anyone out.
- **Connection sessions** are *cache-only*: one describes a live driver handle in
  one process, so persisting it would let a restart resurrect sessions whose
  sockets are gone, and the limit count phantoms. Losing them on restart is correct.

> **There is no external session store, and adding one is not the answer to a new
> requirement.** The cache is in-process (`sessions/memory.js`); the meta DB
> underneath it is what makes logins durable, so the app needs no infrastructure
> beyond its own SQLite file. (`REDIS_URL`/`SESSION_REDIS_URL` were removed in 0.21.)

The consequence is deliberate: with more than one replica each replica sees only
its own connection sessions and enforces `maxSessions` on its own — which is
honest, since another replica's handles aren't ours to count or close. The store
contract (`put/get/touch/del/list/count/clear`) is still the seam, so a shared
cache would be one file plus one line in `sessions/index.js` if that trade ever
stops being the right one.

Rules that keep the durable layer honest:

- the DB is written **before** the cache;
- `list`/`count` **always read the DB** (the cache is a partial view by design);
- a cached copy is capped at 60s so an out-of-band revocation takes effect;
- the sliding expiry only rewrites the DB once ~10% of the TTL has elapsed —
  otherwise every authenticated request would be a write;
- expired rows are ignored on read and reclaimed by the minutely sweeper (SQLite
  has no TTL).

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
it.** Mail is an instance-level concern — who sends the instance's password resets
isn't a workspace owner's decision — so nothing outside `server/mail.js` +
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
- Mail is optional at both layers: with neither configured, invites still return a
  copyable link.

> Per-workspace SMTP was removed in meta migration v10, which promotes a
> workspace's config to the instance config when nothing else answers (see the step
> for why "nothing else"). `workspaces.settings.smtp` may still exist in old rows —
> **dead data, never read it.**
