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

### Hayat (sign-in and authorization) — required
- `HAYAT_ISSUER` — Hayat's auth role public URL; tokens are verified against its keys.
- `HAYAT_API_URL` — Hayat's api role (gRPC/Connect), reachable from the server only.
- `HAYAT_CLIENT_ID` / `HAYAT_CLIENT_SECRET` — tabletsgo's service credentials
  (printed by `hayat import`, or Hayat console → Services).
- `HAYAT_WEB_CLIENT_ID` — the public client the browser signs in with; a token
  issued to any other client is refused.
- `HAYAT_CONSOLE_URL` — **optional**; where the "Manage in Hayat" links point.
- `HAYAT_AUTH_URL` — **optional**, default `HAYAT_ISSUER`. The auth role as this
  server reaches it (Docker: `http://hayat-auth:8443`, since `localhost` is the
  container). `connect.js` fetches discovery there and rewrites the discovered
  token/JWKS endpoints onto it; the `iss` check stays the published issuer.
- The server refuses to start without the five required ones. There is no first-run
  wizard and no admin seed in tabletsgo: the first admin is whoever Hayat grants
  `tabletsgo.admin` at its root — `hayat import` does it for the bundle's admins,
  which are former admins plus whoever `npm run hayat:bundle -- --admin <email>` names.

### Hayat runs on its own
Tabletsgo supports one setup: a Hayat that runs elsewhere, reached through the
`HAYAT_*` vars above. There is no compose overlay that runs Hayat beside tabletsgo —
Hayat's own settings (`HAYAT_MASTER_KEY`, its database, mail) never belong in this
repo's `.env.example`, `docker-compose.yml` or `server/config.js`. For development,
`scripts/dev/hayat.sh` (`npm run dev:hayat`) runs Hayat from `../hayat`'s source and
writes the `HAYAT_*` values into `.env`.

### Mail
- `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` /
  `SMTP_SECURE` — **optional** SMTP for tabletsgo's own notices, the *fallback* under the admin's config
  (`/api/admin/smtp`, stored in `app_settings`), which is where SMTP is meant to be
  set — it changes without a redeploy. The env vars stay supported so existing
  deployments keep working. See the `auth-sessions` skill.

### Public address
- `PUBLIC_URL` — **optional**. The address people reach the instance at. `baseUrl`
  prefers it over the request, for emailed links. Set it behind a reverse proxy.

### Frontend
- `VITE_API_URL` — frontend API base, **baked at build time** via Dockerfile `ARG`
  (not runtime). Default `/api`.

### Sessions
- `SESSION_IDLE_TTL_MS` — **optional**. How long an idle connection session keeps
  its database handle open (default 15 min). There is no login lifetime here: a
  login is a Hayat token (`SESSION_TTL_MS` was removed with the move to Hayat).
- `MAX_SESSIONS_PER_CONNECTION` — **optional**. Instance-wide default cap on
  concurrent sessions per connection (0 = unlimited, the default). A workspace
  overrides it. Connection sessions are per-process, so with more than one replica
  this applies per replica.

> **The app runs no Redis of its own** — connection sessions are an in-process
> cache and logins are Hayat tokens, so there is nothing to point at (`REDIS_URL` /
> `SESSION_REDIS_URL` were removed in 0.21). Don't reintroduce an external store for
> state the meta DB can hold; the one thing it deliberately does *not* hold is a
> connection session, because that describes a live socket in one process. See the
> `auth-sessions` skill.

### Login protection
- **None here** — sign-in, and its rate limiting, are Hayat's. The `LOGIN_*` vars
  were removed with the move to Hayat; don't reintroduce them.

### Database connectivity
- `HANDSHAKE_TIMEOUT_MS` — **optional**. How long the pre-flight connection
  handshake (`GET /api/connections/:id/handshake`) waits for a database before
  reporting a timeout. Default `8000`; it runs while the user waits on the "Connect"
  button, so keep it short.
- Kafka's read caps are **not** env vars (`KAFKA_READ_*` were removed): an
  instance admin sets them in Admin → Modules → Kafka, as module settings (see
  `server/module-registry.js`). So are each engine's query timeout and table row
  limit. A value an admin should change without a redeploy belongs there, not
  here — add a `settings` entry on its module.

### Updates
- `DOCKER_SOCKET` — **optional**. Path of the Docker socket the self-update
  drives (default `/var/run/docker.sock`). Apply method is auto-detected: socket
  mounted ⇒ one-click self-update; otherwise the wizard shows a manual
  `docker compose pull` command. `APP_VERSION` / `GIT_SHA` are baked into the image
  at build time and reported by `/api/system/version`.
- **Not env vars** (removed): `TABLETSGO_TAG` (compose always runs `:latest`),
  `UPDATE_IMAGE` / `UPDATE_REPO` / `UPDATE_HELPER_IMAGE` (constants in
  `server/system-update.js` — the app only updates to its own official release)
  and `UPDATE_AUTO_CHECK` (auto-check is a per-browser Settings > Updates toggle,
  off by default). Don't reintroduce them.
