# Configuration

All configuration is via environment variables (see [`.env.example`](../.env.example)):

| Variable | Required | Description |
|

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

The metadata schema is migrated by a separate one-shot **migrator** (Prisma Migrate), not by the app. `docker compose up` runs it as the `migrate` service and starts the app only after it succeeds; with nothing pending it is a no-op, and existing installs are upgraded in place (a snapshot is written to `data/backups/` first). The app refuses to start on an out-of-date schema and tells you to run the migrator.

- **Without compose**, run it with the same env and volume before starting the container: `docker run --rm --env-file .env -v tabletsgo-data:/app/data ghcr.io/aidapedia/tabletsgo node scripts/migrate.js`.
- **From source**, `npm run server` runs `npm run migrate` first; `npm run migrate -- --status` shows what is applied and pending.
- **One‑click in‑app updates** run the new image's migrator before switching over, and keep the old version running if it fails.
