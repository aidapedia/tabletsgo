---
name: meta-schema
description: Evolving the app's own metadata schema (SQLite or PostgreSQL) with Prisma Migrate — prisma/<engine>/schema.prisma + migrations, the migrator in server/migrator/ (run on boot by boot.js, npm run migrate, the frozen legacy v1–v22 steps, DEPRECATED_TABLES) — and the per-connection schema versioning trail (schema_migrations, schema_version, DDL rollback). Use this skill when adding or changing a table or column in the app's meta DB, when writing a migration, when a route needs a new metadata table, when touching prisma/, prisma.config.mjs, server/migrator/*, server/meta.js or server/meta-connection.js, when a migration fails on boot, or when working on the schema designer's commit/rollback flow, schema_version, or POST /api/connections/:id/schema/migrations and .../schema/rollback.
---

# Schema evolution

Two unrelated things both called "migrations" — keep them straight:

1. **Meta DB migrations** — the app's own metadata schema (Prisma Migrate, `server/migrator/`).
2. **Connection schema versioning** — the DDL audit trail for a *user's* database
   (`schema_migrations` table, `connections.schema_version`).

---

## 1. Meta DB migrations (the app's own database)

### Who runs them

**The app migrates on boot.** `server/migrator/boot.js` is the *first* import
of `server.js` and calls `runMigrations()` synchronously (`prisma migrate deploy`
in a child process), so a new image upgrades the store the first time it starts.
A failed run logs the Prisma error and exits; nothing is served.

**It must stay the first import.** ES modules evaluate imports in order, and
`server/meta.js` opens its Prisma Client the moment it is evaluated. On SQLite
Prisma's schema engine needs the file to itself (`database is locked`
otherwise), so migrating from anywhere that runs after `meta.js` is loaded — the
body of `server.js`, a route, a scheduler — cannot work. Same reason the
migrator opens short-lived handles via `meta-connection.js` and never imports
`meta.js`.

The same `runMigrations()` also runs:

- `npm run migrate` — by hand (`-- --status` to look without changing anything);
- the one-shot container the in-app Docker updater runs between stopping the old
  container and starting the new one. The new app would migrate on boot anyway,
  but by then the old container is gone; running it first is what lets a failed
  run restart the old one. With nothing pending, the new app's boot run is a no-op.

`npm run migrate -- --status` prints engine/state/applied/pending (exit 2 when
something is pending).

### Where the history lives

```
prisma.config.mjs                  # META_DB_TYPE picks prisma/<engine>/; paths from server/config.js
prisma/sqlite/schema.prisma        # the models — identical in both files except the provider
prisma/sqlite/migrations/          # 0_baseline/, then one folder per change
prisma/postgresql/schema.prisma
prisma/postgresql/migrations/
server/migrator/index.js           # runMigrations(), metaSchemaStatus()
server/migrator/boot.js            # runs runMigrations() on boot — server.js's first import
server/migrator/legacy/            # FROZEN pre-Prisma steps v1–v22 (sqlite.js, postgresql.js + v20 SQL)
```

A Prisma migrations folder is locked to one provider, so each engine keeps its
own history. `tests/migrator.test.js` fails if the two schema files' models drift.

### What runMigrations() does

- **empty** DB → `prisma migrate deploy` (builds from `0_baseline`), then `seed()`:
  the built-in roles from `BUILTIN_ROLES`, the `root` resource node, and the
  legacy marker stamped at v22 (`user_version` / `metadata_schema_version`) so a
  pre-Prisma image opening it doesn't replay v1. Seed is insert-if-missing.
- **legacy** DB (has `users`, no `_prisma_migrations`) → snapshot, the frozen
  legacy steps bring it to v22, `prisma migrate resolve --applied 0_baseline`
  (the baseline *is* v22 — running it would collide), then deploy.
- **prisma** DB → snapshot if anything is pending, then deploy.

Snapshots land in `data/backups/pre-migrate-{label}-{ts}.db` (SQLite copy or
`pg_dump` archive). A failed snapshot is logged and never blocks the run.

Legacy SQLite installs keep SQLite's nullable `TEXT PRIMARY KEY` and `INTEGER`
columns, where the Prisma schema says `String @id` / `BigInt`. That is expected
drift: production only ever runs `migrate deploy`, which doesn't check drift.

### Querying the store (Prisma Client)

`server/meta.js` is the only way in. Two clients are generated, one per engine,
into `server/generated/prisma-<engine>` (`npm run prisma:generate`; gitignored,
built into the image), and META_DB_TYPE picks one at boot.

- **Always `db()`**, never a client held in a variable: inside `transaction(fn)`
  it returns that transaction's client, which is how a helper several modules
  down joins its caller's transaction. Nested `transaction()` calls join the
  outer one. In `server.js` it is imported as `meta()` (`db` is the database layer there).
- **Integers are BIGINT** (ms timestamps), and the client converts every
  `bigint` back to a number, raw queries included. Pass numbers in.
- **Prefer the model API.** Use `$queryRaw` (tagged template) only for joins; the
  schema declares no relations. Alias raw columns in **snake_case**, because
  PostgreSQL folds unquoted aliases to lower case (the old raw SQL returned
  `createdat` on Postgres for exactly this reason).
- **`INSERT OR IGNORE`** becomes `upsert(..., update: {})`. `createMany` takes no
  `skipDuplicates` on SQLite.
- **SQLite runs on one connection.** `transaction()` holds a gate so other
  requests' queries wait instead of landing inside it (tests/meta.test.js).
  Keep transactions short, and never await anything slow (HTTP, a user
  database) inside one.
- **The model names are the table names** (`db().resource_nodes`), so a
  table chosen from an allowlist can be addressed as `db()[table]`.

### To change the meta schema

1. Edit **both** `prisma/sqlite/schema.prisma` and `prisma/postgresql/schema.prisma`
   with the same model change.
2. Create the migration for each engine against a dev DB of that engine:
   ```
   npm run prisma -- migrate dev --create-only --name add_thing          # sqlite (.env default)
   META_DB_TYPE=postgresql META_DATABASE_URL=postgresql://… \
     npm run prisma -- migrate dev --create-only --name add_thing        # postgresql
   ```
   (`npm run prisma` loads `.env`, which `prisma.config.mjs` needs — it imports
   `server/config.js`, which refuses to load without `ENCRYPTION_KEY`.)
3. **Read the generated `migration.sql`.** Prisma will happily emit `DROP`,
   rename-as-drop-and-add, or a SQLite "RedefineTables" — rewrite it to stay
   additive. Data changes (backfills, granting a new permission key to the
   built-in owner) are plain SQL in the same file, written per engine
   (`INSERT OR IGNORE` on SQLite, `ON CONFLICT DO NOTHING` on PostgreSQL).
4. `npm run migrate`, then `npm test`.

Rules:

- **Never edit a shipped migration folder**, and never touch `0_baseline` or
  `server/migrator/legacy/` — users' DBs already ran them. Prisma checksums
  applied migrations and refuses to deploy over an edited one.
- **Additive only.** Never `DROP`/rename columns or tables, and never add `NOT NULL`
  columns without a default — an older image must still be able to open a newer
  DB (the update wizard's rollback restarts the old image on it).
- **A new permission key the built-in owner should hold** ships as data in the
  migration (like legacy v17/v21 did); `seed()` covers fresh installs from the
  catalog, but existing installs only get it from the migration.
- **Deprecating a table:** keep it declared in both schema files (removing a
  model makes the next migration `DROP` it), register it in `DEPRECATED_TABLES`
  (`server/migrator/legacy/sqlite.js`), and remove every live-code reference.
  A later migration may finally drop it once the release floor has moved past
  every image that still used it.

### Testing an upgrade-path change

`tests/migrator.test.js` runs the real CLI on a fresh DB, a pre-Prisma v20 DB
and a re-run. For PostgreSQL, run the same against a scratch database
(`META_DB_TYPE=postgresql META_DATABASE_URL=… npm run migrate`), and
`PG_META_TEST_URL=… npm test` for the legacy PostgreSQL parity test.

---

## 2. Connection schema versioning

Every connection has a `schemaVersion` starting at 1.

DDL staged from the schema designer / create-table panel / drop-table / empty-table
actions is tagged `ddl: true` with a computed `rollbackSql` (see
`src/features/schema-designer/lib/rollback.ts`) **when staged**.

After `commitChanges` in `WorkspacePage.tsx` successfully executes a batch
containing DDL, it calls `POST /api/connections/:id/schema/migrations` **once**,
which records the batch (forward + rollback SQL) in `schema_migrations` and bumps
`schema_version` — **one version per successful commit, not per statement**.

Each migration carries a `status` (`active` | `rollbacked`; NULL on legacy rows =
active).

- `GET .../schema/migrations` lists the trail.
- `POST .../schema/rollback { toVersion }` undoes every still-active migration
  newer than the target (newest first), refuses to cross an irreversible one
  (`reversible = 0`), marks the undone rows `rollbacked`, and resets
  `schema_version` to the target.

**Version numbers are reused after a rollback** (roll 3→1, commit again ⇒ a new
v2), so they're only unique among `active` rows. Don't treat the version as a
globally unique key.

Plain row-level data edits (insert/update/delete via `TableView`) are never tagged
`ddl` and never affect `schemaVersion`.

Redis has no DDL, so `schemaVersion` never moves for a Redis connection and the
status bar shows the namespace instead.
