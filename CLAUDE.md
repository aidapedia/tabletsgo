# CODING AGENT INSTRUCTIONS

## DEVELOPMENT STANDARDS
When writing code, adhere to these principles:

- Prioritize simplicity and readability over clever solutions ( create a component )
- Start with minimal functionality and verify it works before adding complexity
- Test your code frequently with realistic inputs and validate outputs
- Create testing environments for components that are difficult to validate directly
- Use functional and stateless approaches where they improve clarity
- Keep core logic clean and push implementation details to the edges
- Maintain consistent style (indentation, naming, patterns) throughout the codebase
- Balance file organization with simplicity - use an appropriate number of files for the project scale
- Everytime write a api contract, please make generic and can reusable with other database model current roadmap is SQLLite, PostgreSQL and Redis. But we dont close to support more database type like MariaDB etc

## INVARIANTS
Violating any of these breaks something silently. Load the named skill before
working in that area — it has the reasoning and the full rules.

- **No route branches on `conn.type`** — the db layer answers for every engine. → skill `db-engine`
- **`requireAuth` is sync**, and stays sync — resolve tokens in `sessionMiddleware`. → skill `auth-sessions`
- **A route asks for a permission, never a role name** — `requirePermission(req, res, wsId, 'teams.manage')`. Workspace roles are admin-defined data; only the system tier (`users.role`) is hardcoded. → skill `auth-sessions`
- **A workspace never loses its last owner** — "owner" means *holds `workspace.manage`*; an instance admin never joins a workspace. → skill `auth-sessions`
- **A permission exists because a route enforces it** — add the key to `server/permissions-catalog.js` and use it, or don't add it. → skill `auth-sessions`
- **There is no external session store**, and adding one is not the answer to a new requirement. → skill `auth-sessions`
- **Meta migrations are append-only and additive-only** — never edit a shipped step, never `DROP`/rename, never add `NOT NULL` without a default. → skill `meta-schema`
- **`workspaces.settings.smtp` is dead data** — never read it. SMTP is instance-level. → skill `auth-sessions`
- **`server/config.js` is the only place that reads `process.env`** for tunables. → skill `add-tunable`
- **A new per-connection resource goes in the export bundle** and the `DELETE /api/connections/:id` cascade, together. → skill `connection-transfer`
- **Always `SCAN`, never `KEYS`** on Redis. → skill `db-engine`

## WHERE THINGS ARE
Full annotated file map: **`docs/ARCHITECTURE.md`** — read it when you need to know
what a specific component or module does. Keep both it and this section in sync
whenever you add, remove, or rename a folder.

### Frontend (`src/`)
Feature-sliced React + TypeScript. Imports use the `@/` alias (→ `src/`). Each
feature exposes a public API through its `index.ts` barrel; reach into another
feature via that barrel, not its internal files.

```
src/
├── app/         # wiring only: main.tsx, App.tsx, providers/, routes/ (route table + guards)
├── shared/      # ui/ (buttons, form, navigation, overlay, feedback, table + root micro-components),
│                #   hooks/, lib/, api/ (request.ts + database.ts), config/, types/
├── features/    # self-contained business features (see table below)
└── pages/       # thin route-level composition: auth/, admin/, console/, home/
```

| Feature | What it owns |
| --- | --- |
| `auth` | AuthContext, login/setup/invite, the caller's own account settings |
| `admin` | instance-admin area (system role `admin`): workspaces, users, the one SMTP config |
| `workspaces` | org/tenant layer: current workspace, members, teams, notifications, general settings |
| `workspace` | **the per-connection DB console** — DataGrid, TableView, QueryEditor, tabs, status bar |
| `connections` | connection CRUD, access, type picker, switcher modal, export/import, connect handshake |
| `redis` | the Redis-shaped console pieces: key tree sidebar + command console (swaps in on `type === 'redis'`) |
| `table-folders` | the connected DB's tables grouped by the generic folders tree (`type='table'`) |
| `schema-designer` | React Flow ERD, table/column editors, schema history, DDL rollback |
| `workflow` | node-graph automations: builder, scheduling, folders, JSON export/import |
| `dashboard` | per-connection query dashboards: variables, 12-col grid, hand-rolled SVG charts, row actions |
| `backup` | S3-compatible storage destinations + per-connection backup schedule and restore |
| `templates` | built-in read-only catalog bundling workflows + dashboards (browse + apply) |
| `system-update` | version check against GitHub Releases + guided update wizard |
| `settings`, `keymap` | SettingsContext; KeymapContext (`useKeymap`/`useShortcut`) + its setting UI |

> `features/workspaces` (plural) is the org/tenant layer; `features/workspace`
> (singular) is the per-connection DB console. **Don't conflate them.**

### Backend (`server.js` + `server/`)
`server.js` is routes and wiring only; everything a route needs lives in a module
under `server/`. A route should read as: **authorize → validate → call a module →
respond**.

```
server.js                # express app: 108 routes, static frontend, schedulers, shutdown
server/
├── config.js            # every env var + filesystem path, resolved once      → skill add-tunable
├── util.js  crypto.js   # helpers; AES-256-GCM secret + file encryption
├── meta.js              # the app's own SQLite handle
├── migrations.js        # versioned, append-only meta-schema steps            → skill meta-schema
├── auth.js              # the guards + sessionMiddleware                      → skill auth-sessions
├── permissions-catalog.js  # leaf: the permission keys + seeded builtin roles → skill auth-sessions
├── permissions.js       # ★ workspace RBAC: roles, grants, the sync policy cache → skill auth-sessions
├── sessions/            # ★ logins (durable) + connection sessions (cache)    → skill auth-sessions
├── login-guard.js       # sign-in brute-force blocking                        → skill auth-sessions
├── users.js  workspaces.js  app-settings.js  mail.js                          → skill auth-sessions
├── connections.js       # connection records (encrypted credentials blob)
├── folders.js           # the polymorphic folder tree (4 types, depth caps)
├── storage.js           # storage destinations (S3 + local disk) and object ops
├── db/                  # ★ the engine-agnostic database layer                → skill db-engine
├── workflow.js          # the node-graph executor + scheduler
├── connection-transfer.js  # the portable connection bundle          → skill connection-transfer
├── backup/              # schedule.js / runner.js / restore.js
└── system-update.js     # GitHub release checking + Docker-socket self-update
```

## CONVENTIONS
### Frontend
- A feature folder gets `components/`, `stores/`, `lib/`, `hooks/`, `types.ts` only as needed — don't create empty buckets.
- Cross-feature use goes through the barrel (`@/features/x`); intra-feature files import each other directly to avoid barrel import cycles.
- Name folders/files for what they do (e.g. `schema-designer`, not `erd-viewer`; `database.ts`, not `sqlite.ts`).
- **A page never sets its own width.** `HomeLayout` owns the one content container (max-width, centered); build pages with `shared/ui/page`'s `PageHeader` + `PageTabs`, and wrap only the content that reads badly wide in `<Narrow>`. A page-level `max-w-*` is what made every section a different shape before.
- **Anything a user can be looking at has an address.** A detail view, a create/edit form and a tab are routes (`/connections/:id/:tab`, `/connections/:id/edit/:tab`), not `useState` on the list page — so a refresh keeps you there and a link lands there. Use `useTabRoute` to bind a tab bar to its segment. Transient dialogs (confirm, export, picker) stay local state.
- All backend calls go through `shared/api/request.ts`: use `request()` for mutations (throws on failure — caller `try/catch`es and toasts) and `safeRequest(path, fallback)` for reads that should degrade quietly. Don't call `fetch` directly or re-declare `API_URL`.
- UI styling lives in `shared/ui` components — `Button`, `IconButton`, `Input`/`Textarea`, `Form`/`FormField`/`Label`. Use those instead of shared class-string helpers (the old `shared/lib/styles.ts` is gone). `controlClass` (exported from `shared/ui/form/Input`) is **only** for non-`<input>` controls that need the field look (e.g. `Select`) — never put it on a raw `<input>`/`<textarea>`; use `Input`/`Textarea`.
- Reuse the shared micro-components instead of re-styling inline: `Avatar` (initial bubble), `Badge` (uppercase pill), `PersonRow` (avatar+name+email), `CheckboxRow` (bordered selectable row), `SearchInput` (input with search icon), `LoadingState`/`EmptyState` (faint placeholders), `ConfirmDialog` (never `window.confirm`), `toggleId` (selection-list toggle).
- Heavy editors stay out of feature barrels so they code-split: `WorkflowEditor`, `DashboardView`, `RedisConsole`/`RedisEditor` (they pull in CodeMirror / React Flow).

### Backend
- A module owns its table(s): if a route is writing raw SQL against `backup_schedules` or `storage_destinations`, that belongs in the module.
- Dependencies point one way: `config → crypto → meta → sessions → {auth, app-settings, connections, folders, storage} → mail → db → workflow/backup/transfer → server.js`. No cycles — `sessions` never imports `db`; the db layer hands it a release callback instead (`setReleaseHandler`), which is what lets the sweeper close idle handles. Also `backup/schedule.js` is split out from the runner precisely so `connection-transfer.js` can read a schedule without importing the pipeline.

## EXTRA ACTION
- Every time you add endpoint on server, create a structure of request response and sample url on BACKEND_DOCUMENTATION.MD
- Update README.MD if you have any changes about features, instalation etc.
