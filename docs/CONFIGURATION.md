# Configuration

All configuration is via environment variables (see [`.env.example`](../.env.example)):

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT`    | `3000`             | HTTP listen port.                        |
| `META_DB` | `./data/app.db`    | SQLite file storing app metadata when `META_DB_TYPE=sqlite`. |
| `META_DB_TYPE` | `sqlite` | App metadata engine: `sqlite` or `postgresql`. |
| `META_DATABASE_URL` | | PostgreSQL URL required when `META_DB_TYPE=postgresql`. |
| `ENCRYPTION_KEY` | *(required)* | AES-256-GCM key encrypting connection credentials at rest — server refuses to start without it. Also derives (with a distinct salt) the key used for storage-destination credentials. |
| `HAYAT_ISSUER` | *(required)* | Hayat's auth role (public URL). People sign in there; access tokens are verified against its keys. |
| `HAYAT_API_URL` | *(required)* | Hayat's api role (gRPC/Connect), reachable from the server only. |
| `HAYAT_CLIENT_ID` / `HAYAT_CLIENT_SECRET` | *(required)* | Tabletsgo's service credentials in Hayat (printed by `hayat import`). |
| `HAYAT_WEB_CLIENT_ID` | *(required)* | The public client the browser signs in with; tokens issued to any other client are refused. |
| `HAYAT_CONSOLE_URL` | | Hayat's console, for the "Manage in Hayat" links. |
| `HAYAT_AUTH_URL` | `HAYAT_ISSUER` | Hayat's auth role as the server reaches it, when that isn't the public issuer (inside Docker `localhost` is the container). Discovery, the token endpoint and the keys are fetched there; tokens still name `HAYAT_ISSUER`. |
| `WORKFLOW_SCHEDULER_ENABLED` | `true` | Set to `false` to disable the minutely cron tick that fires workflows with an active hourly/daily schedule (including backups). Useful for local dev/CI. |

Hayat runs on its own; tabletsgo reads only the `HAYAT_*` values above. Its own settings (master key, database, mail) are Hayat's — see Hayat's README. For development against Hayat's source, `npm run dev:hayat` fills these in (README → Development).

**System requirement:** PostgreSQL backup/restore shells out to `pg_dump`/`pg_restore`, so the `postgresql-client` package must be installed on the host/image running `server.js` (already added to the provided `Dockerfile`).

## PostgreSQL for app metadata

To store saved connections, workspace settings and the rest of the app's metadata in PostgreSQL, set these in `.env` and start the optional database service:

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
