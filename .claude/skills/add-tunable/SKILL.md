---
name: add-tunable
description: The full env-var / Docker configuration reference and the checklist for threading a new tunable through server/config.js, the Dockerfile, docker-compose.yml and .env.example. Use this skill when adding, renaming or removing an environment variable or configurable value, when touching server/config.js, the Dockerfile, docker-compose.yml or .env.example, when a value is about to be hardcoded that an operator might want to change, or when you need to know what an existing env var does or what its default is.
---

# Configuration (env / Docker)

Configurable values live in env vars, wired through `docker-compose.yml` (see
`.env.example`); **don't hardcode them**.

**`server/config.js` is the only place that reads `process.env`** for tunables (the
SMTP/admin-seed fallbacks are the exception, read where they're used).

## The checklist for a new tunable

1. Add it to `server/config.js` — one resolved value, exported.
2. Thread it through the `Dockerfile` (build-time `ARG`) and/or
   `docker-compose.yml` (runtime `environment:`).
3. Document it in `.env.example` with its default and whether it's required.
4. Add it to the reference below **and** to `README.md`'s Configuration section.
5. If it can legitimately be `0`, parse with `envInt` — see the gotcha below.

> **The `0` gotcha.** Compose passes an unset variable as an **empty string**, and
> `parseInt('') || default` silently returns the default. Any tunable where `0`
> means something real ("disabled", "unlimited") must be parsed with `envInt`, not
> the `parseInt(…) || default` shorthand. This bit the `LOGIN_*` vars.

## Reference

### Runtime
- `PORT` (server), `META_DB` (metadata SQLite path), `NODE_ENV`.

### Required
- `ENCRYPTION_KEY` — **required**. Encrypts connection credentials
  (host/port/username/password/…) at rest (AES-256-GCM); the server refuses to boot
  without it.

### First-run seeding
- `ADMIN_USERNAME` (email) / `ADMIN_PASSWORD` — **optional** pre-seed of the
  instance admin, and **only** that: neither this nor the wizard creates a
  workspace, because an admin can't belong to one. Unset ⇒ the in-browser
  first-run setup wizard runs (default). **Don't bake defaults into the
  Dockerfile.** (`WORKSPACE_NAME` was removed in 0.21.3 along with the ownerless
  seeded workspace.)

### Mail
- `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` /
  `SMTP_SECURE` — **optional** SMTP, and the *fallback* under the admin's config
  (`/api/admin/smtp`, stored in `app_settings`), which is where SMTP is meant to be
  set — it changes without a redeploy. The env vars stay supported so existing
  deployments keep working. Invites always return a copyable link even without
  SMTP. See the `auth-sessions` skill.

### Frontend
- `VITE_API_URL` — frontend API base, **baked at build time** via Dockerfile `ARG`
  (not runtime). Default `/api`.

### Sessions
- `SESSION_TTL_MS` / `SESSION_IDLE_TTL_MS` — **optional**. Sliding login lifetime
  (default 30 days) and how long an idle connection session keeps its database
  handle open (default 15 min).
- `MAX_SESSIONS_PER_CONNECTION` — **optional**. Instance-wide default cap on
  concurrent sessions per connection (0 = unlimited, the default). A workspace
  overrides it. Connection sessions are per-process, so with more than one replica
  this applies per replica.

> **The app runs no Redis of its own** — the meta DB plus an in-process cache is the
> whole session layer, and there is nothing to point at (`REDIS_URL` /
> `SESSION_REDIS_URL` were removed in 0.21). Don't reintroduce an external store for
> state the meta DB can hold; the one thing it deliberately does *not* hold is a
> connection session, because that describes a live socket in one process. See the
> `auth-sessions` skill.

### Login protection
- `LOGIN_MAX_ATTEMPTS` / `LOGIN_ATTEMPT_WINDOW_MS` / `LOGIN_LOCKOUT_MS` /
  `LOGIN_ADMIN_COOLDOWN_MS` — **optional** brute-force protection (defaults: 5
  failures within 15 min, blocked until an admin unblocks, admins get a 15-min
  cooldown instead). These read `0` as a real value ("disabled") — parsed with
  `envInt`. See the `auth-sessions` skill.

### Database connectivity
- `HANDSHAKE_TIMEOUT_MS` — **optional**. How long the pre-flight connection
  handshake (`GET /api/connections/:id/handshake`) waits for a database before
  reporting a timeout. Default `8000`; it runs while the user waits on the "Connect"
  button, so keep it short.

### Updates
- `TABLETSGO_TAG` — **optional**. Published image tag `docker compose` runs (and
  pulls on self-update). Default `latest`; one-click self-update works best on a
  moving tag.
- `UPDATE_AUTO_CHECK` — **optional**. Instance-wide default (truthy
  `1/true/yes/on`; default off) for the per-user "auto-check for updates" toggle in
  Settings > Updates, surfaced via `/api/system/version`'s `autoCheckUpdates`. Leave
  off when an orchestrator (e.g. Coolify) manages updates; users can still override
  per browser.
- `UPDATE_IMAGE` / `UPDATE_REPO` / `UPDATE_HELPER_IMAGE` — **optional** in-app
  update checker tuning (default to the official image/repo; override only for a
  fork). The checker compares the running `(version, sha)` against the latest GitHub
  Release + its `release.json` contract. Apply method is auto-detected: Docker socket
  mounted ⇒ one-click self-update via `UPDATE_HELPER_IMAGE` (default `docker:cli`);
  otherwise the wizard shows a manual `docker compose pull` command. `APP_VERSION` /
  `GIT_SHA` are baked into the image at build time and reported by
  `/api/system/version`.
