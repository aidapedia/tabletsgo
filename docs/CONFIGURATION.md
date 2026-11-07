# Configuration

All configuration is via environment variables (see [`.env.example`](../.env.example)):

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT`    | `3000`             | HTTP listen port.                        |
| `META_DB` | `./data/app.db`    | SQLite file storing app metadata when `META_DB_TYPE=sqlite`. |
| `META_DB_TYPE` | `sqlite` | App metadata engine: `sqlite` or `postgresql`. |
| `META_DATABASE_URL` | | PostgreSQL URL required when `META_DB_TYPE=postgresql`. |
| `ENCRYPTION_KEY` | *(required)* | AES-256-GCM key encrypting connection credentials at rest — server refuses to start without it. Also derives (with a distinct salt) the key used for storage-destination credentials. |
| `WORKFLOW_SCHEDULER_ENABLED` | `true` | Set to `false` to disable the minutely cron tick that fires workflows with an active hourly/daily schedule (including backups). Useful for local dev/CI. |
| `LOGIN_MAX_ATTEMPTS` | `5` | Consecutive failed sign-ins that block an account. `0` disables blocking. |
| `LOGIN_ATTEMPT_WINDOW_MS` | `900000` (15 min) | How close together those failures must be — an older failure restarts the counter. |
| `LOGIN_LOCKOUT_MS` | `0` | How long a block lasts. `0` = until an instance admin unblocks the account. |
| `LOGIN_ADMIN_COOLDOWN_MS` | `900000` (15 min) | An instance admin is never blocked indefinitely — they get this cooldown instead. `0` leaves admin sign-ins unthrottled. |

**System requirement:** PostgreSQL backup/restore shells out to `pg_dump`/`pg_restore`, so the `postgresql-client` package must be installed on the host/image running `server.js` (already added to the provided `Dockerfile`).

## PostgreSQL for app metadata

To store accounts, workspaces, saved connections, and login sessions in PostgreSQL, set these in `.env` and start the optional database service:

```dotenv
META_DB_TYPE=postgresql
META_POSTGRES_PASSWORD=choose-a-strong-password
META_DATABASE_URL=postgresql://tabletsgo:choose-a-strong-password@metadata-postgres:5432/tabletsgo
```

```bash
docker compose --profile postgresql up -d
```

For an external PostgreSQL server, set `META_DATABASE_URL` to its connection URL and run `docker compose up -d` without the profile. Use a dedicated, empty database or schema for a new PostgreSQL deployment. Switching `META_DB_TYPE` selects a different store; it does **not** copy data from an existing SQLite file. Keep the same `ENCRYPTION_KEY` if you move encrypted connection records between installations. Metadata snapshots from PostgreSQL are `pg_dump` custom-format `.dump` files in the app's backup directory. Source installations using PostgreSQL need `libpq` development files (`pg_config`) when installing packages and `pg_dump` on `PATH`; the Docker image includes both.

Run one Tabletsgo app instance for either metadata store. The permission cache and workflow scheduler are process-local. The app queries its metadata through Prisma Client over a connection pool; keep PostgreSQL close to the app, since every permission check reads it.

## Schema migrations

The app migrates the metadata schema (Prisma Migrate) **on startup**, before it serves anything, so a new image upgrades the store the first time it starts — whether it was pulled by `docker compose`, the in‑app updater, an orchestrator or `docker run`. With nothing pending it is a no-op, and existing installs are upgraded in place (a snapshot is written to `data/backups/` first). If a migration fails, the app logs the error and exits.

- **To look without changing anything**, `npm run migrate -- --status` (or `docker run --rm --env-file .env -v tabletsgo-data:/app/data ghcr.io/aidapedia/tabletsgo node scripts/migrate.js --status`) shows what is applied and pending.
- **One‑click in‑app updates** run the new image's migrator before switching over, and keep the old version running if it fails.
