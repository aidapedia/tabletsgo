---
name: connection-transfer
description: The portable whole-connection JSON bundle — GET /api/connections/:id/export, POST /api/connections/import, server/connection-transfer.js, what is and isn't in the bundle, secret handling, id remapping, and the backup schedule's include_config option. Use this skill when adding a new per-connection resource (saved queries, workflows, dashboards, folders, backup schedules and anything new alongside them), when touching server/connection-transfer.js or the DELETE /api/connections/:id cascade, when working on ConnectionExportModal/ConnectionImportModal, or when a workflow/dashboard/template needs its ids remapped on import.
---

# Connection export / import

A connection moves between instances as one JSON document (`kind: 'connection'`,
versioned by `CONNECTION_EXPORT_VERSION` in `server/connection-transfer.js`).

- `GET /api/connections/:id/export` builds it.
- `POST /api/connections/import` creates a **new** connection from it, in one
  `meta.transaction` — a rejected document leaves nothing behind.

> The import route is mounted **above** the `/api/connections/:id` guard so
> `import` isn't read as an id. Keep that ordering if you add routes near it.

## What's in the bundle

Connection settings (as an opaque, dialect-agnostic `connection.settings` object),
folders of all four types with their tree + colors, table→folder assignments, saved
queries (with `layout` — a schema draft's diagram design: table/group/note
positions; see `features/schema-designer/lib/design.ts`), workflows, dashboards,
backup schedule.

## What's deliberately not

History/audit rows (`query_history`, `workflow_runs`, `backup_runs`,
`schema_migrations`) and `connection_access` — they describe one instance, and their
principals don't exist in the importing workspace.

Storage destinations are workspace-scoped too: references the target workspace
lacks are **dropped (with a warning), never invented**.

## Secrets

- The password is omitted unless `?secrets=1` (a password embedded in a `uri` is
  blanked as well); the import dialog can supply one via the body's `settings`
  override.
- Webhook tokens are **stripped on export and re-minted on import** — same rule as
  the per-workflow export (`features/workflow/lib/exportImport.ts`).

## Ids

Everything is re-idded on import:

- Folders are re-parented onto the new ids (a cycle or an over-deep branch lands at
  the root).
- An item keeps its folder **only when that folder groups its kind**.
- Dashboard row actions are re-pointed at the new workflow ids (`remapIdsDeep`) —
  the same problem `features/templates/lib/apply.ts` solves for templates.

## Schedules arrive paused

Workflow `schedule_enabled = 0`, backup `enabled = 0`: an import must not start
firing jobs at a database nobody has verified yet. The response's `warnings[]` says
so, and the UI toasts them.

## The rule when you add a per-connection resource

Add it to the bundle (`buildConnectionExport` + `importConnectionDoc`) **alongside
the `DELETE /api/connections/:id` cascade — the two lists should stay in sync.** If
a resource is deleted with the connection, it belongs in the bundle; if it isn't,
say why in a comment.

## Shipping the config with a backup

The backup schedule can ship the same document on a schedule:
`backup_schedules.include_config` (meta migration v6) makes each run upload
`<uuid>.connection.json` beside the dump via `exportConnectionConfigToFile` → the
existing `storeFile`.

It's recorded **on** the destination's upload entry
(`configKey`/`configSizeBytes`/`configEncrypted`/`configError`), **never as its own
entry**, so every `uploads.find(u => u.destinationId === …)` lookup
(download/delete/restore) still resolves the dump.

- Downloads take `?artifact=config`.
- Deleting an upload deletes both objects.
- Retention is left to the dump's prune pass (it sweeps the folder by date).
- **A failed config upload does not fail the run** — the dump succeeded, and
  failing would re-dump the database on every retry.
