---
name: meta-schema
description: Evolving the app's own SQLite metadata schema (server/migrations.js versioned append-only steps, the baseline in meta.js, DEPRECATED_TABLES) and the per-connection schema versioning trail (schema_migrations, schema_version, DDL rollback). Use this skill when adding or changing a table or column in the app's meta DB, when writing a migration step, when a route needs a new metadata table, when touching server/migrations.js or server/meta.js, or when working on the schema designer's commit/rollback flow, schema_version, or POST /api/connections/:id/schema/migrations and .../schema/rollback.
---

# Schema evolution

Two unrelated things both called "migrations" — keep them straight:

1. **Meta DB migrations** — the app's own SQLite schema (`server/migrations.js`).
2. **Connection schema versioning** — the DDL audit trail for a *user's* database
   (`schema_migrations` table, `connections.schema_version`).

---

## 1. Meta DB migrations (the app's own SQLite)

Metadata-schema evolution lives in `server/migrations.js` as a versioned,
append-only `MIGRATIONS` step array. `PRAGMA user_version` records the last applied
step; on boot `migrate()` runs every pending step (oldest first), each in its own
transaction, stamping `user_version` as it goes.

Before the first pending step touches an existing install, the meta DB is
snapshotted to `data/backups/pre-migrate-v{N}-{ts}.db` automatically — no constant
to remember.

### To change the meta schema

- **Append a new step** with the next version (`{ version: N, name, up(db) }`)
  containing plain DDL/DML — the runner guarantees it executes exactly once, so no
  `IF NOT EXISTS`/probe guards are needed from v3 on.
- **Never edit or reorder a shipped step** — users' DBs already ran it.
- **Also add new tables/columns to the baseline** (`ensureBaseSchema`/`ensureColumns`)
  so fresh installs get them — the baseline only applies to new DBs; existing
  installs get them from your step. Forgetting this means fresh installs are missing
  the table.
- **Additive only.** Never `DROP`/rename columns or tables, and never add `NOT NULL`
  columns without a default — an older image must still be able to open a newer DB
  (the update wizard's rollback path depends on this).
- **Deprecating a table:** when a step supersedes a table instead of dropping it,
  register it in `DEPRECATED_TABLES` (in `server/migrations.js`) and remove every
  live-code reference to it — from then on only migration steps may mention it. A
  registered table may finally be `DROP`ped by a later cleanup step once the release
  floor has moved past every image that still used it (i.e. no supported downgrade
  target reads it anymore).
- Steps v1/v2 are intentionally idempotent catch-ups (probe-based `addColumn`,
  guarded backfills): the installs they target predate accurate `user_version`
  stamping. **Don't copy that style for new steps.**

### Testing an upgrade-path change

Test against all three:

1. a **fresh** DB (exercises the baseline),
2. a **copy of an existing** DB (exercises the step),
3. a **re-run** on an already-migrated DB (must be a no-op).

See the commented v3 example in `server/migrations.js` for the step shape.

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
