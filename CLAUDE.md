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

## PROJECT STRUCTURE
Feature-sliced React + TypeScript. Imports use the `@/` alias (→ `src/`). Each
feature exposes a public API through its `index.ts` barrel; reach into another
feature via that barrel, not its internal files. Keep this map in sync whenever
you add, remove, or rename a folder.

```
src/
├── app/                          # app wiring (no business logic)
│   ├── main.tsx                  # entry: mounts <AppProviders><App/>
│   ├── App.tsx                   # renders <AppRoutes/>
│   ├── providers/                # ThemeContext + AppProviders (composes every provider)
│   └── routes/                   # AppRoutes (route table + RequireAuth guard)
│
├── shared/                       # reusable, feature-agnostic code
│   ├── ui/                       # presentational components, grouped by kind:
│   │   ├── buttons/              #   Button, IconButton, TextButton
│   │   ├── form/                 #   Form/FormField/Label, Input/Textarea, PasswordInput, Select, Checkbox,
│   │   │                         #     CheckboxRow, SearchInput, Toggle, NumberStepper, Segmented
│   │   ├── navigation/           #   NavItem, Tab, MenuItem
│   │   ├── overlay/              #   Popover, Tooltip, ContextMenu
│   │   ├── feedback/             #   Toast, ConfirmDialog, TypeToConfirmDialog, LoadingState, EmptyState, Wizard
│   │   ├── table/                #   DataTable (the shared list-as-table: sortable columns, row click,
│   │   │                         #     pagination footer), Pagination, useDataTable (client-side
│   │   │                         #     sort/paging state — spread its result into DataTable; pass the
│   │   │                         #     props yourself for server-side paging)
│   │   └── (root)                #   Avatar, Badge, PersonRow, RowLabel, SaveQueryPanel, SqlEditor,
│   │                             #     JsonEditor, icons — no group yet
│   ├── hooks/                    # generic hooks (useSlideOver)
│   ├── lib/                      # helpers: recents, schemaDraft, toggleId
│   ├── api/                      # backend client: request.ts (fetch wrapper) + database.ts
│   ├── config/                   # runtime config / env (API_URL from VITE_API_URL)
│   └── types/                    # ambient/shared TS types (globals.d.ts)
│
├── features/                     # self-contained business features (each has index.ts barrel)
│   ├── auth/                     # stores/AuthContext + api (login/setup/invite); session token.
│   │                             #   `user.role` is the SYSTEM role ('admin' | 'user') — see AUTH MODEL
│   ├── admin/                    # the instance-admin area (system role 'admin' only): AdminWorkspacesPanel
│   │                             #   (every workspace + who owns it; create/rename/delete, grant ownership)
│   │                             #   AdminUsersPanel (accounts, system role, invites, password reset)
│   │                             #   and AdminSmtpPanel + SmtpForm (the instance's one mail server —
│   │                             #     the only place SMTP is configurable; see EMAIL / SMTP).
│   │                             #   Reaches nothing inside a workspace — an admin has no membership
│   ├── workspaces/               # org/tenant layer (multi-workspace): WorkspaceContext (current
│   │                             #   workspace + switch), WorkspaceSwitcher, MembersPanel, TeamsPanel,
│   │                             #   NotificationSettings (backup-failure emails — the mail server
│   │                             #     itself is instance-level, see EMAIL / SMTP),
│   │                             #   WorkspaceGeneral (rename + the default "max sessions per
│   │                             #     connection" every connection inherits — see SESSIONS);
│   │                             #   api (workspaces/members/teams CRUD)
│   ├── connections/              # stores/ConnectionsContext (scoped to current workspace); components:
│   │                             #   ConnectionForm, ConnectionDetail (Data/Access/Backup tabs),
│   │                             #   ConnectionAccessPanel, DbTypePickerModal (owns DB_CATALOG/TYPE_LABEL),
│   │                             #   ConnectionSwitcherModal (the console's "switch connection" overlay:
│   │                             #     search + database-type filter chips + a collapsible folder tree —
│   │                             #     a connection's `folder` string nests on "/"; ↑/↓/Enter/Esc),
│   │                             #   ConnectionExportModal + ConnectionImportModal (whole-connection JSON
│   │                             #   bundle — see "CONNECTION EXPORT / IMPORT" below),
│   │                             #   ConnectHandshakeDialog (root cause + retry/edit/open-anyway when the
│   │                             #     pre-flight handshake fails); hooks/useConnectHandshake ("Connect"
│   │                             #     probes /handshake and only then routes to the console — see
│   │                             #     "The connection handshake" under THE DB LAYER); api (connection
│   │                             #   access get/set, export/import client + file read/download helpers).
│   │                             #   ConnectionForm carries "Max concurrent sessions" (0 = inherit the
│   │                             #     workspace default) and ConnectionDetail shows the live count
│   ├── settings/                 # stores/SettingsContext
│   ├── redis/                    # everything Redis-shaped in the console. Redis has no tables and
│   │   │                         #   no SQL, so it replaces two pieces of the console rather than
│   │   │                         #   extending them: the browser sidebar and the query tab.
│   │   ├── components/           #   RedisKeyTree (sidebar: the keyspace as a tree, SCAN-paged with a
│   │   │                         #     MATCH pattern box, type/TTL badges, delete + "load more"),
│   │   │                         #     RedisKeyView (main-area tab for one key: metadata + value in
│   │   │                         #     the shared DataGrid, paged; TTL edit + delete. Read-only —
│   │   │                         #     writes go through the console so the command is visible),
│   │   │                         #     RedisConsole (the query tab: one command per line, runs the
│   │   │                         #     whole buffer; lazy-imported, NOT in the barrel — it pulls in
│   │   │                         #     CodeMirror), RedisEditor (CodeMirror with a Redis StreamLanguage
│   │   │                         #     + command autocomplete; reuses SqlEditor's exported theme)
│   │   └── lib/                  #   api (/redis/* client), commands (command catalog for autocomplete
│   │                             #     + argument hints), tree (buildKeyTree: split keys on ':' — one
│   │                             #     folder level per segment, no chain folding; TTL/type formatting)
│   ├── table-folders/            # the connected DB's tables grouped by the generic folders tree
│   │                             #   (type='table', 3-level cap, one folder per table), each folder
│   │                             #   carrying an optional color. Replaced the old "domains" feature —
│   │                             #   meta migration v5 folded every domain into the folders tree,
│   │                             #   keeping its id/name/color. Components: TableFolderList (the console
│   │                             #   Tables sidebar — always folder-grouped, like the dashboards/workflows
│   │                             #   panels: collapsible color-tinted folders + subfolders, drag a table
│   │                             #   into a folder / a folder into a folder, un-foldered tables listed
│   │                             #   plainly beneath as the root drop zone, inline new folder (name only —
│   │                             #   the row is controlled via `creating`/`onCreatingChange` so the panel
│   │                             #   header's folder+ button starts it) + rename, and a swatch picker
│   │                             #   under ⋮ > "Change color" (a ContextMenuSub flyout); the folder icon
│   │                             #   itself is plain, clicking it just expands/collapses the folder),
│   │                             #   TableFolderPickerPanel + TableFolderEditPanel (right-side
│   │                             #   slide-overs, now only reached from the schema diagram's node menu /
│   │                             #   region label), FolderDot; lib/api (wraps shared/api/folders with the
│   │                             #   'table' type bound + set-table-folder), lib/assign, lib/tree
│   │                             #   (path/tree order). Drives the sidebar folder view and the
│   │                             #   schema-designer's draggable/editable folder regions.
│   ├── keymap/                   # stores/KeymapContext (useKeymap/useShortcut) + KeymapSetting
│   ├── workspace/                # the DB console (one connection): data browsing + querying
│   │   ├── components/           #   DataGrid (drag / Shift+click selects a rectangular cell range —
│   │   │                         #     ⌘/Ctrl+C copies it as TSV, Esc clears; the range rides along in
│   │   │                         #     onCellContextMenu's payload as `selection`), TableView (its cell
│   │   │                         #     context menu acts on that selection: copy as TSV/CSV/JSON, set
│   │   │                         #     NULL/EMPTY/DEFAULT, duplicate/delete the spanned rows),
│   │   │                         #   SchemaView, QueryEditor, FunctionView,
│   │   │                         #   QueryHistoryView, InsertRowPanel, ChangesPanel, SavedQueriesPanel,
│   │   │                         #   IconRail (its DB logo at the top opens the ConnectionSwitcherModal via
│   │   │                         #     onBrowseConnections — no inline connection popover anymore),
│   │   │                         #   TabBar (the open-tab strip: drag a tab left/right to reorder — insertion
│   │   │                         #   caret on drag-over, committed on drop; right-click closes this/others/
│   │   │                         #   to-the-right/all),
│   │   │                         #   StatusBar (bottom bar of the main area only — the icon rail and Tables
│   │   │                         #   sidebar keep their full height. DB type + logo,
│   │   │                         #   connection name, environment pill, current database/schema, and the
│   │   │                         #   schema version on the right — clicking it opens the schema history tab.
│   │   │                         #   Env + version live here only; the top toolbar no longer shows them)
│   │   └── lib/                  #   savedQueries, queryHistory (backend calls)
│   ├── schema-designer/          # visual schema design (React Flow ERD + table/column editors; tables
│   │   │                         #   sharing a folder are clustered into a draggable, editable region)
│   │   ├── components/           #   SchemaEditor, SchemaSidebar (accordion: Draft Schema / Table List /
│   │   │                         #     References / Table Folders — click to focus/edit), CreateTablePanel,
│   │   │                         #     TableEditPanel, columnFields, SchemaHistoryPanel (schema-version audit trail)
│   │   └── lib/                  #   rollback (best-effort rollback SQL for staged DDL)
│   ├── workflow/                 # workflow automations (React Flow builder + server-side runner, incl.
│   │   │                         #   real hourly/daily scheduling via the Schedule trigger node's Active toggle;
│   │   │                         #   JSON export/import of a workflow's graph; folders — grouped via the generic
│   │   │                         #   folders tree (type='workflow'), 3-level cap — mirroring the dashboard feature)
│   │   ├── components/           #   WorkflowEditor (export/import toolbar buttons), WorkflowsPanel (folder
│   │   │                         #     tree: create/rename/delete/drag into folders + "Import from JSON…"),
│   │   │                         #     NodePalette, NodeConfigPanel, RunLogPanel, nodes/WorkflowNode (spec card)
│   │   └── lib/                  #   api (per-connection CRUD + run + folder CRUD via shared/api/folders),
│   │                             #     nodeSpec (node catalog: manual, schedule, query, http, js, switch, loop,
│   │                             #     export "Export SQL", storage "Store to Storage"), exportImport
│   │                             #     (WorkflowExport type + sanitizeGraph/stripSecrets — webhook tokens
│   │                             #     never round-trip a file)
│   ├── dashboard/                # per-connection query dashboards (New Relic style): dynamic variables
│   │   │                         #   ({{name}} in widget SQL, query-backed or static lists), free-placement
│   │   │                         #   12-col drag/resize grid (hard collision blocking), fullscreen, JSON
│   │   │                         #   export/import. Charts are hand-rolled SVG (no chart/grid deps).
│   │   │                         #   Table widgets: optional server-side pagination (LIMIT/OFFSET wrap,
│   │   │                         #   N+1 has-more probe) + per-row action buttons (up to 3, styled via
│   │   │                         #   variant/icon, optional per-row condition that disables/hides by a
│   │   │                         #   column value) that run a workflow with the clicked row as its trigger
│   │   │                         #   input (Widget.pageSize/rowActions; icons in lib/rowActionIcons).
│   │   ├── components/           #   DashboardView (tab content: toolbar + VariableBar + WidgetGrid),
│   │   │                         #     DashboardsPanel (rail list), WidgetCard (runs its query), WidgetChart,
│   │   │                         #     WidgetEditor + DashboardSettings (modals), MarkdownText,
│   │   │                         #     charts/ (XYChart area|line|bar, PieDonut, SankeyChart, chrome)
│   │   └── lib/                  #   api (per-connection CRUD), variables ({{}} substitution + option
│   │                             #     resolution), queryData (result → chart shapes), palette (validated
│   │                             #     CVD-safe series colors), grid (collision math), scale, useSize
│   ├── backup/                   # S3-compatible storage destinations (workspace-scoped) + the
│   │   │                         #   per-connection backup schedule built from generic workflow nodes
│   │   │                         #   (Schedule → Export SQL → Store to Storage)
│   │   ├── components/           #   StorageList, StorageModal, BackupPanel, BackupConfigForm,
│   │   │                         #     BackupCalendarHeatmap, BackupVersionList (run-based restore),
│   │   │                         #     RestorePanel (restore from uploaded file or browsed storage object)
│   │   └── lib/                  #   api (storages CRUD, backup schedule/runs/calendar/restore), types
│   ├── templates/                # built-in, read-only template catalog (browse + apply only — no
│   │   │                         #   authoring). A template bundles workflows + dashboards; applying
│   │   │                         #   creates the workflows first, resolves `{{workflow:<key>}}`
│   │   │                         #   placeholders in dashboard row-action `workflowId`s against the
│   │   │                         #   newly created ids, then creates the dashboards. Filterable by
│   │   │                         #   DB type ("postgresql" | "sqlite") against Template.databases.
│   │   │                         #   VSCode-style entry: a Templates icon in the console IconRail opens
│   │   │                         #   TemplatesPanel in the sidebar; picking a template opens its detail
│   │   │                         #   in a main-area tab (kind: 'template').
│   │   ├── catalog/               #   TEMPLATES: Template[] — the shipped templates (plain TS objects)
│   │   ├── components/            #   TemplatesPanel (sidebar list + DB-type filter chips),
│   │   │                         #     TemplateDetailView (main-area tab: contents + Apply button)
│   │   └── lib/                   #   apply (applyTemplate: create workflows → resolve refs → create dashboards)
│   └── system-update/            # in-app update checking + guided update wizard (backup → pre-flight →
│       │                         #   apply → verify). Compares running (version, sha) to the latest GitHub
│       │                         #   Release; docker-socket-mounted ⇒ one-click self-update, else a manual
│       │                         #   `docker compose pull` command. Admin-only apply.
│       ├── components/           #   UpdateBanner (dismissible home-shell banner), UpdatePanel (Settings >
│       │                         #     Updates: version + changelog + re-check), UpdateWizard (guided flow)
│       ├── stores/               #   UpdateContext (useUpdate: info + check + per-version dismiss)
│       └── lib/                  #   api (/api/system/* client + version polling), types
│
└── pages/                        # route-level composition (thin — just assemble features), grouped by area
    ├── auth/                     # unauthenticated flows: LoginPage, SetupPage, AcceptInvitePage,
    │                             #   ForgotPasswordPage, ResetPasswordPage
    ├── admin/                    # the instance-admin area, one file per sidebar section (same rule
    │                             #   as home/): AdminWorkspacesPage (/admin), AdminUsersPage
    │                             #   (/admin/users) + AdminEmailPage (/admin/email — the instance-wide
    │                             #   SMTP config) — no tabs, the sidebar switches. Only reachable
    │                             #   with the system role 'admin'; AppRoutes' RequireSystemAdmin /
    │                             #   RequireWorkspaceUser send each audience to the other's home
    ├── console/                  # WorkspacePage — the per-connection DB console (route /connection/:id)
    └── home/                     # the authenticated home shell — one file per sidebar section
        ├── HomeLayout            #   sidebar + <Outlet/>; every section route renders inside it
        ├── ui                    #   shared page primitives: PageHeader, Section, TabbedSection, SubHead, ComingSoon
        ├── DashboardPage (/)     #   connection + member counts
        ├── ConnectionsPage       #   stat cards + filter bar (search / env / folder / type / status)
        │                         #   over the connection list, rendered with shared/ui/table's DataTable
        │                         #   (sortable columns, 10/page, row click → detail); detail/picker/form
        │                         #   come from features/connections
        ├── StoragePage           # /storage → S3 storage destinations (StorageList), top-level sidebar item
        ├── WorkspaceSettingsPage # /workspace → General / Member / Integrations / Notification tabs
        └── SettingsPage          # /settings → Theme / Data / Updates tabs (Updates renders UpdatePanel)
```

Note: `features/workspaces` (plural) is the org/tenant layer (workspaces, members, invites); `features/workspace` (singular) is the per-connection DB console. Don't conflate them.

Conventions:
- A feature folder gets `components/`, `stores/`, `lib/`, `hooks/`, `types.ts` only as needed — don't create empty buckets.
- Cross-feature use goes through the barrel (`@/features/x`); intra-feature files import each other directly to avoid barrel import cycles.
- Name folders/files for what they do (e.g. `schema-designer`, not `erd-viewer`; `database.ts`, not `sqlite.ts`).
- All backend calls go through `shared/api/request.ts`: use `request()` for mutations (throws on failure — caller `try/catch`es and toasts) and `safeRequest(path, fallback)` for reads that should degrade quietly. Don't call `fetch` directly or re-declare `API_URL`.
- UI styling lives in `shared/ui` components — `Button`, `IconButton`, `Input`/`Textarea`, `Form`/`FormField`/`Label`. Use those instead of shared class-string helpers (the old `shared/lib/styles.ts` is gone). `controlClass` (exported from `shared/ui/form/Input`) is **only** for non-`<input>` controls that need the field look (e.g. `Select`) — never put it on a raw `<input>`/`<textarea>`; use `Input`/`Textarea`.
- Reuse the shared micro-components instead of re-styling inline: `Avatar` (initial bubble), `Badge` (uppercase pill), `PersonRow` (avatar+name+email), `CheckboxRow` (bordered selectable row), `SearchInput` (input with search icon), `LoadingState`/`EmptyState` (faint placeholders), `ConfirmDialog` (never `window.confirm`), `toggleId` (selection-list toggle).
- Future decomposition candidates (out of scope so far): `pages/console/WorkspacePage.tsx` (~2200 lines), `schema-designer/SchemaEditor.tsx` (~1470), `workspace/TableView.tsx` (~900), and `server.js` (~2900 — the remaining step is moving route handlers into `server/routes/*.js` express routers).

## BACKEND STRUCTURE
`server.js` is routes and wiring only; everything a route needs lives in a module
under `server/`. A route should read as: **authorize → validate → call a module →
respond**, and **no route branches on `conn.type`** — the db layer answers for
every engine.

```
server.js                 # express app: 108 routes, static frontend, schedulers, shutdown
server/
├── config.js             # every env var + filesystem path, resolved once (imports nothing app-level)
├── util.js               # safeJson, jsonPreview, describeError, sleep, sanitizeForKey, computeNextRun
├── crypto.js             # AES-256-GCM: encryptSecret/decryptSecret + streamed file encryption.
│                         #   One scrypt-derived key per namespace (connections | storage | backup files)
├── meta.js               # the app's own SQLite handle, initMetaDb(), snapshotMetaSync()
├── migrations.js         # versioned, append-only meta-schema steps (see META DB MIGRATIONS below)
├── auth.js               # the guards — requireAuth, requireSystemAdmin (system role),
│                         #   requireOwner/requireMember (workspace role) — plus the team /
│                         #   connection-access rules. `sessionMiddleware` resolves the bearer
│                         #   token once per request so the ~100 sync guards stay sync
├── workspaces.js         # workspaces + workspace_members + teams: the admin listing, ownership
│                         #   changes, and the one delete cascade both delete routes share
├── users.js              # the instance user directory (`users`): system roles, invites,
│                         #   promote/demote (promoting to admin strips every membership)
├── app-settings.js       # instance-wide settings (`app_settings`, key → JSON): the admin-owned
│                         #   counterpart of workspaces.settings. Today one key, 'smtp' — the global
│                         #   mail server, its password sealed under its own scrypt namespace
├── sessions/             # ★ the session store — logins + open-connection sessions (see SESSIONS)
│   ├── index.js          #   the registry: auth tokens, connection sessions, the limit, the sweeper
│   ├── db.js             #   durable backend: the meta DB's `sessions` table — the source of
│   │                     #     truth for logins (survives a restart / a flushed cache)
│   ├── hybrid.js         #   composes cache + source; decides which namespaces are durable
│   ├── memory.js         #   the cache: in-process, the only one (no external store)
│   └── limits.js         #   resolveMaxSessions: connection → workspace → instance → unlimited
├── mail.js               # SMTP resolution (workspace settings → global app-settings → env) +
│                         #   the transactional emails. See EMAIL / SMTP below
├── connections.js        # connection records: rowToConnection/connectionToRow + CRUD + schemaVersion
├── folders.js            # FOLDER_TYPES + the polymorphic folder tree (depth/height/ancestor checks)
├── storage.js            # storage destinations (S3-compatible + built-in local disk) and object ops:
│                         #   store/fetch/list/delete/prune. Every step branches on `dest.local`, not a caller
├── db/                   # ★ the engine-agnostic database layer — see "THE DB LAYER" below
│   ├── index.js          #   the driver contract + generic dispatch (the only file routes import)
│   ├── diagnose.js       #   why a connection attempt failed: engine-agnostic transport
│   │                     #     classification + the driver's own `explainError` (see HANDSHAKE)
│   ├── sql.js            #   dialect-agnostic SQL text utils shared by the SQL drivers
│   ├── sqlite.js         #   one file per engine; each adapts itself to the contract
│   ├── postgres.js
│   └── redis.js
├── workflow.js           # the node-graph executor (vm sandbox, {{input.x}} substitution),
│                         #   executeAndRecord, nextRunForGraph, runDueWorkflows
├── connection-transfer.js  # the portable connection export/import bundle (see CONNECTION EXPORT / IMPORT)
├── backup/
│   ├── index.js          #   barrel — what the routes import
│   ├── schedule.js       #   the backup_schedules row store, clamps and validation
│   ├── runner.js         #   export → store, retries, run history, failure notification
│   └── restore.js        #   fetch artifact → decrypt → hand to the driver
└── system-update.js      # GitHub release checking (cached) + Docker-socket self-update
```

Conventions:
- **`config.js` is the only place that reads `process.env`** for tunables (the
  SMTP/admin-seed fallbacks are the exception, read where they're used).
- A module owns its table(s): if a route is writing raw SQL against
  `backup_schedules` or `storage_destinations`, that belongs in the module.
- Dependencies point one way: `config → crypto → meta → sessions → {auth, app-settings,
  connections, folders, storage} → mail → db → workflow/backup/transfer → server.js`. No cycles —
  `sessions` never imports `db`; the db layer hands it a release callback instead
  (`setReleaseHandler`), which is what lets the sweeper close idle handles. Also
  `backup/schedule.js` is split out from the runner precisely so
  `connection-transfer.js` can read a schedule without importing the pipeline.

## THE DB LAYER
`server/db/index.js` defines one vocabulary; `sqlite.js` / `postgres.js` /
`redis.js` each adapt a single engine to it. **Adding an engine is one driver
file plus one entry in `DRIVERS`** — no caller changes.

A driver is a plain object whose methods take `(conn, ctx, …)`, where `ctx` is
`{ database, schema }` and each engine reads only what it understands (SQLite
ignores both; Postgres pools per database and defaults `schema` to `'public'`;
Redis reads `database` as its numbered db). The full method list is documented at
the top of `server/db/index.js` — keep it accurate, it's the contract.

A driver **omits** what its engine doesn't have, and the generic layer decides
what that means at the API edge:
- **optional** ops answer with the empty result (`listTables` → `[]`,
  `getDiagram` → `{tables:[],foreignKeys:[]}`), so Redis just shows nothing.
- **required** ops throw `UnsupportedError` (status 400) naming the type —
  `insertRow`, `analyze`, `runQuery`, `dump`, `restore`. Use
  `db.requireCapability(conn, op)` to fail *before* unrelated work (that's how
  `/analyze` tells a Redis user about Redis instead of about SQL syntax), and
  `db.supports(conn, 'dump')` to gate a feature without naming an engine.

### The connection handshake
`GET /api/connections/:id/handshake` (→ `db.handshake`) is the pre-flight the
console runs **before** routing into a connection: `ping` says yes/no, the
handshake says *why not*. It never throws — a failure is a normal 200
`{ ok:false, reason, cause, hint, code?, detail }`, timed out after
`HANDSHAKE_TIMEOUT_MS`. The diagnosis follows the same edge rule as everything
else: `server/db/diagnose.js` classifies what's engine-agnostic (refused, DNS,
timeout, TLS, unreachable), and a driver adds only what its engine alone can
explain through the optional `explainError(error, conn)` — Postgres SQLSTATEs,
Redis error replies, SQLite file errors. `reason` is a stable code the UI maps
to a headline; `cause`/`hint` are prose it renders as-is, so a new reason never
breaks an older client. Frontend side: `useConnectHandshake` +
`ConnectHandshakeDialog` in `features/connections`.

Never leave a route without an answer for an engine — a missing branch used to
mean `res.json(undefined)` and a hung request; the generic layer is what makes
that impossible now.

## CONFIGURATION (env / Docker)
Configurable values live in env vars, wired through `docker-compose.yml` (see `.env.example`); don't hardcode them:
- `PORT` (server), `META_DB` (metadata SQLite path), `NODE_ENV` — server runtime.
- `ENCRYPTION_KEY` — **required**. Encrypts connection credentials (host/port/username/password/…) at rest (AES-256-GCM); the server refuses to boot without it.
- `ADMIN_USERNAME` (email) / `ADMIN_PASSWORD` / `WORKSPACE_NAME` — **optional** pre-seed of the admin + first workspace. Unset ⇒ the in-browser first-run setup wizard runs (default). Don't bake defaults into the Dockerfile.
- `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` / `SMTP_SECURE` — **optional** SMTP, and the *fallback* under the admin's config (`/api/admin/smtp`, stored in `app_settings`), which is where SMTP is meant to be set — it changes without a redeploy. The env vars stay supported so existing deployments keep working. Invites always return a copyable link even without SMTP. See EMAIL / SMTP.
- `VITE_API_URL` — frontend API base, **baked at build time** via Dockerfile `ARG` (not runtime). Default `/api`.
- `TABLETSGO_TAG` — **optional**. Published image tag `docker compose` runs (and pulls on self-update). Default `latest`; one-click self-update works best on a moving tag.
- `SESSION_TTL_MS` / `SESSION_IDLE_TTL_MS` — **optional**. Sliding login lifetime (default 30 days) and how long an idle connection session keeps its database handle open (default 15 min).
- `MAX_SESSIONS_PER_CONNECTION` — **optional**. Instance-wide default cap on concurrent sessions per connection (0 = unlimited, the default). A workspace or an individual connection overrides it. Connection sessions are per-process, so with more than one replica this applies per replica.
- **The app runs no Redis of its own** — the meta DB plus an in-process cache is the whole session layer, and there is nothing to point at (`REDIS_URL`/`SESSION_REDIS_URL` were removed in 0.21). Don't reintroduce an external store for state the meta DB can hold; the one thing it deliberately does *not* hold is a connection session, because that describes a live socket in one process. See SESSIONS.
- `HANDSHAKE_TIMEOUT_MS` — **optional**. How long the pre-flight connection handshake (`GET /api/connections/:id/handshake`) waits for a database before reporting a timeout. Default `8000`; it runs while the user waits on the "Connect" button, so keep it short.
- `UPDATE_AUTO_CHECK` — **optional**. Instance-wide default (truthy `1/true/yes/on`; default off) for the per-user "auto-check for updates" toggle in Settings > Updates, surfaced via `/api/system/version`'s `autoCheckUpdates`. Leave off when an orchestrator (e.g. Coolify) manages updates; users can still override per browser.
- `UPDATE_IMAGE` / `UPDATE_REPO` / `UPDATE_HELPER_IMAGE` — **optional** in-app update checker tuning (default to the official image/repo; override only for a fork). The checker compares the running `(version, sha)` against the latest GitHub Release + its `release.json` contract. Apply method is auto-detected: Docker socket mounted ⇒ one-click self-update via `UPDATE_HELPER_IMAGE` (default `docker:cli`); otherwise the wizard shows a manual `docker compose pull` command. `APP_VERSION` / `GIT_SHA` are baked into the image at build time and reported by `/api/system/version`.
When you add a new tunable, thread it through `server/config.js`, the Dockerfile/compose, and `.env.example`.

## AUTH MODEL
Login/setup/accept-invite return `{ user, token }`; the token is stored in localStorage (`dbm.token`) and attached as `Authorization: Bearer` by `shared/api/request.ts`. Server-side the token's source of truth is the meta DB's `sessions` table, read through a cache (see SESSIONS). The store is async while `requireAuth` is called synchronously by ~100 routes, so `sessionMiddleware` resolves the token once per request onto `req.authUser`; **never make `requireAuth` async** — resolve in middleware and keep the guards sync.

**Roles are two independent tiers. Don't collapse them.**

| Tier | Column | Values | Scope |
| --- | --- | --- | --- |
| System | `users.role` (surfaced as `user.role`) | `admin` \| `user` | The instance. An `admin` manages workspaces and accounts through `/api/admin/*` and **holds no workspace membership at all** — `memberRole()` returns null for them, so every workspace-scoped guard denies them. Instance administration deliberately carries no data access. |
| Workspace | `workspace_members.role` | `owner` \| `member` | One workspace. `owner` manages it (members, teams, settings, connections, storage destinations); a workspace may have **any number of owners but never zero**. `member` uses the connections they've been granted: full database access (query, row edits, workflows, dashboards, schema changes) but no create/edit/delete of the connection *record*. |

The guards live in `server/auth.js`: `requireSystemAdmin` (system), `requireOwner`/`requireMember` (workspace), plus `requireConnectionOwner` in `server.js` for the routes that change a connection record. **A route should use a guard, not compare role strings** — the one place a literal is still read is `memberRole`, which normalizes the pre-v8 spelling `admin` → `owner`.

Two invariants the routes enforce, both of which are easy to break from a new code path: an instance admin can never be added to a workspace (invite, role change, and workspace creation all refuse), and a workspace can never lose its last owner (demote, remove, delete-user and promote-to-admin all refuse, the last two with `409` + the affected workspaces).

Connections carry a `workspace_id` column and are filtered by the caller's current workspace.

## EMAIL / SMTP
**There is exactly one mail server per instance, and only an instance admin sets it.** Mail is an instance-level concern — who sends the instance's password resets isn't a workspace owner's decision — so nothing outside `server/mail.js` + `server/app-settings.js` knows how it's configured, and **no caller passes a workspace**.

| Layer | Where it lives | Who edits it |
| --- | --- | --- |
| Admin config | `app_settings` key `'smtp'` (`server/app-settings.js`) | an instance admin (`/api/admin/smtp`, Administration → Email) |
| Env | `SMTP_*` | whoever deploys the container |

`smtpConfig()` in `server/mail.js` is the only resolver: the admin config if it names a host, else the env vars, else `null`. It tags the result with `source` (`'global' | 'env'`) purely so the UI can say where the settings came from — never branch on it. `publicSmtpConfig()` is the password-stripped form routes hand a client (a workspace owner sees it read-only on the Notification page, so "no mail server configured" is visible where it matters).

Rules: the saved password is AES-256-GCM sealed under its own scrypt namespace (`APP_SETTINGS_KEY`) and **never** leaves the server — reads report `hasPassword`, and a save that omits `pass` keeps the stored one. The env layer stays supported forever (an existing deployment must keep sending mail after an upgrade); it's the *fallback*, not the source of truth, so anything an operator might want to change belongs in the admin config, where it changes without a redeploy. Mail is optional at both layers: with neither configured, invites still return a copyable link.

Per-workspace SMTP was removed in meta migration v10, which promotes a workspace's config to the instance config when nothing else answers (see the step for why "nothing else"). `workspaces.settings.smtp` may still exist in old rows — **dead data, never read it.**

## SESSIONS
Two things share one store (`server/sessions`) but are **stored differently, on purpose**:

- **Logins** (bearer tokens) are *durable*: the meta DB's `sessions` table is the source of truth (`sessions/db.js`), read through a cache (`sessions/hybrid.js`). A login survives a restart and a dropped cache — a cache failure degrades to a slower DB read and warns once; it never signs anyone out.
- **Connection sessions** are *cache-only*: one describes a live driver handle in one process, so persisting it would let a restart resurrect sessions whose sockets are gone, and the limit count phantoms. Losing them on restart is correct.

**There is no external session store, and adding one is not the answer to a new requirement.** The cache is in-process (`sessions/memory.js`); the meta DB underneath it is what makes logins durable, so the app needs no infrastructure beyond its own SQLite file. The consequence is deliberate: with more than one replica each replica sees only its own connection sessions and enforces `maxSessions` on its own — which is honest, since another replica's handles aren't ours to count or close. The store contract (`put/get/touch/del/list/count/clear`) is still the seam, so a shared cache would be one file plus one line in `sessions/index.js` if that trade ever stops being the right one.

Rules that keep the durable layer honest: the DB is written before the cache, `list`/`count` always read the DB (the cache is a partial view by design), a cached copy is capped at 60s so an out-of-band revocation takes effect, and the sliding expiry only rewrites the DB once ~10% of the TTL has elapsed — otherwise every authenticated request would be a write. Expired rows are ignored on read and reclaimed by the minutely sweeper (SQLite has no TTL).

**A session is one open connection to a database — not a browser tab.** It maps to
the driver handle: the Postgres pool for a database, the ioredis client for a db
index, the SQLite file handle. Five people browsing the same database share one
session and appear as its `participants`. The db layer registers them itself:
`gatedRequired`/`gatedOptional` call `enterSession` before the driver opens
anything, so a session exists exactly as long as the app really uses the
connection. There is deliberately **no "open session" endpoint** — an explicit
lifecycle would drift out of sync with the actual sockets. An idle session expires
after `SESSION_IDLE_TTL_MS` and the minutely sweeper releases its handle; the next
query transparently opens a new one.

**The limit** (`maxSessions`) resolves most-specific-first: connection →
workspace (`settings.sessions.maxPerConnection`) → `MAX_SESSIONS_PER_CONNECTION` →
unlimited. 0 at every level = unlimited, which is the shipped default. Exceeding it
throws `SessionLimitError` (429); the handshake reports it as `reason:'at_capacity'`
with the session list, so the connect dialog can name who's holding them. Backup and
restore are **not** gated — a scheduled dump must not fail because people are
browsing. The limit counts what *this* process holds, so across replicas it applies
per replica.

Rules of thumb: sessions must never depend on the db layer (it hands them a release
callback instead); a store write on the hot path is skipped for `TOUCH_INTERVAL_MS`,
which is clamped to a third of the idle TTL so a live session can't expire underneath
the process holding it.

## CONNECTIONS & SCHEMA VERSIONING
The `connections` table stores dialect-agnostic fields (`type`, `name`, `workspace_id`, `environment`, `folder`, `tags`, `schema_version`) as plain columns and everything else (host/port/username/password/filepath/database/uri/sslmode/tls/auth/keychain) as one AES-256-GCM-encrypted JSON blob in `credentials`. `server/connections.js`'s `rowToConnection`/`connectionToRow` reassemble/split the flat connection shape the frontend has always used — the API contract for `/api/connections*` didn't change, only storage. Redis deliberately **reuses the same field names** as PostgreSQL (host/port/username/password/database/uri) so nothing downstream needs a Redis branch; only `tls` (`'' | 'require' | 'insecure'`) is its own, standing in for `sslmode`.

Every connection has a `schemaVersion` starting at 1. DDL staged from the schema designer / create-table panel / drop-table / empty-table actions is tagged `ddl: true` with a computed `rollbackSql` (see `src/features/schema-designer/lib/rollback.ts`) when staged. After `commitChanges` in `WorkspacePage.tsx` successfully executes a batch containing DDL, it calls `POST /api/connections/:id/schema/migrations` once, which records the batch (forward + rollback SQL) in `schema_migrations` and bumps `schema_version` — one version per successful commit, not per statement. Each migration carries a `status` (`active` | `rollbacked`; NULL on legacy rows = active). `GET .../schema/migrations` lists the trail; `POST .../schema/rollback { toVersion }` undoes every still-active migration newer than the target (newest first), refuses to cross an irreversible one (`reversible = 0`), marks the undone rows `rollbacked`, and resets `schema_version` to the target. Version numbers are reused after a rollback (roll 3→1, commit again ⇒ a new v2), so they're only unique among `active` rows. Plain row-level data edits (insert/update/delete via `TableView`) are never tagged `ddl` and never affect `schemaVersion`.

## REDIS (the non-relational engine)
Redis is the first supported engine with no tables and no SQL, so it's the shape every future non-relational engine should follow. **The rule: adapt at the edges, never fork the contract.** `server/db/redis.js` owns everything Redis-specific and returns the *same* generic result shape the SQL engines do (`{ type: 'rows', columns, rows }` | `{ type: 'message', message }` | `{ error }`) — which is exactly why the `/query` route, workflow query nodes and dashboard widgets work against Redis with no Redis-aware code in them.

- **Commands ride the SQL route.** `POST /api/connections/:id/query` takes command text in `sql` for a Redis connection; it reaches the driver through the same `db.runQuery(conn, ctx, sql)` the SQL engines use, so the route has no Redis branch at all. One command per line (`#` comments dropped); a multi-command buffer returns one summary row per command (`#`/`command`/`status`/`reply`) so a mid-batch failure is visible rather than aborting. Blocking/connection-mode commands (`SUBSCRIBE`, `MONITOR`, `BLPOP`, `WAIT`, …) are rejected — they'd hold the pooled client open forever.
- **Browsing gets its own routes**, not overloaded table ones: `GET/DELETE .../redis/keys`, `.../redis/key`, `.../redis/overview`, `PUT .../redis/ttl`. The relational routes answer for Redis too, via the generic layer's optional/required split (see THE DB LAYER): `/tables`, `/objects`, `/columns`, `/indexes` and `/diagram` return the empty result, while `/insert`, `/analyze` and the backup schedule `400` naming the type. The keyspace routes reach the driver's Redis-only ops (`scanKeys`/`readKey`/`overview`/`deleteKeys`/`setTtl`) through `db.drivers.redis`, guarded by `requireRedis`.
- **Always `SCAN`, never `KEYS`.** `KEYS` blocks the server on a large keyspace. The key list is cursor-paged; the frontend keeps pulling pages until it has a screenful because a `SCAN` page can legitimately come back empty before the cursor wraps.
- **`database` is the numbered db.** Clients are pooled per `(connection, resolved db)`. A `redis://…/N` URI's path is only the *default* — `redisConfig` strips it and passes `db` explicitly, because ioredis otherwise lets the URI override the option and pins the connection to one database, silently breaking the console's db picker. The pool key uses the resolved db so a client is never handed back for a database it isn't on.
- **Frontend:** `src/features/redis` swaps two console pieces on `conn.type === 'redis'` — `RedisKeyTree` for the tables sidebar and `RedisConsole` for the query tab (plus a `redisKey` tab kind). The schema designer, table folders, create-table and query analysis are hidden rather than stubbed, since Redis has no equivalent. `RedisConsole`/`RedisEditor` stay **out of the feature barrel** (they pull in CodeMirror) — same code-split rule as `WorkflowEditor` and `DashboardView`.
- **Not supported, on purpose:** schema migrations (no DDL, so `schemaVersion` never moves and the status bar shows the namespace instead), `EXPLAIN`-style analysis, row-grid editing, and the S3 backup schedule (the driver has no `dump`, so `db.supports(conn, 'dump')` is false).

## CONNECTION EXPORT / IMPORT
A connection moves between instances as one JSON document (`kind: 'connection'`, versioned by `CONNECTION_EXPORT_VERSION` in `server/connection-transfer.js`). `GET /api/connections/:id/export` builds it; `POST /api/connections/import` creates a **new** connection from it, in one `meta.transaction` — a rejected document leaves nothing behind. The import route is mounted **above** the `/api/connections/:id` guard so `import` isn't read as an id.

- **In the bundle:** connection settings (as an opaque, dialect-agnostic `connection.settings` object), folders of all four types with their tree + colors, table→folder assignments, saved queries, workflows, dashboards, backup schedule.
- **Not in the bundle:** history/audit rows (`query_history`, `workflow_runs`, `backup_runs`, `schema_migrations`) and `connection_access` — they describe one instance, and their principals don't exist in the importing workspace. Storage destinations are workspace-scoped too: references the target workspace lacks are dropped (with a warning), never invented.
- **Secrets:** the password is omitted unless `?secrets=1` (a password embedded in a `uri` is blanked as well); the import dialog can supply one via the body's `settings` override. Webhook tokens are stripped on export and re-minted on import — same rule as the per-workflow export (`features/workflow/lib/exportImport.ts`).
- **Ids:** everything is re-idded on import. Folders are re-parented onto the new ids (a cycle or an over-deep branch lands at the root), an item keeps its folder only when that folder groups its kind, and dashboard row actions are re-pointed at the new workflow ids (`remapIdsDeep`) — the same problem `features/templates/lib/apply.ts` solves for templates.
- **Schedules arrive paused** (workflow `schedule_enabled = 0`, backup `enabled = 0`): an import must not start firing jobs at a database nobody has verified yet. The response's `warnings[]` says so, and the UI toasts them.

When you add a new per-connection resource, add it to the bundle (`buildConnectionExport` + `importConnectionDoc`) alongside the `DELETE /api/connections/:id` cascade — the two lists should stay in sync.

The backup schedule can ship the same document on a schedule: `backup_schedules.include_config` (meta migration v6) makes each run upload `<uuid>.connection.json` beside the dump via `exportConnectionConfigToFile` → the existing `storeFile`. It's recorded **on** the destination's upload entry (`configKey`/`configSizeBytes`/`configEncrypted`/`configError`), never as its own entry, so every `uploads.find(u => u.destinationId === …)` lookup (download/delete/restore) still resolves the dump. Downloads take `?artifact=config`; deleting an upload deletes both objects; retention is left to the dump's prune pass (it sweeps the folder by date). A failed config upload does not fail the run — the dump succeeded, and failing would re-dump the database on every retry.

## META DB MIGRATIONS (app's own SQLite)
Metadata-schema evolution lives in `server/migrations.js` as a versioned, append-only `MIGRATIONS` step array. `PRAGMA user_version` records the last applied step; on boot `migrate()` runs every pending step (oldest first), each in its own transaction, stamping `user_version` as it goes. Before the first pending step touches an existing install, the meta DB is snapshotted to `data/backups/pre-migrate-v{N}-{ts}.db` automatically — no constant to remember. To change the meta schema:

- **Append a new step** with the next version (`{ version: N, name, up(db) }`) containing plain DDL/DML — the runner guarantees it executes exactly once, so no `IF NOT EXISTS`/probe guards are needed from v3 on. **Never edit or reorder a shipped step** — users' DBs already ran it.
- Also add new tables/columns to the **baseline** (`ensureBaseSchema`/`ensureColumns`) so fresh installs get them — the baseline only applies to new DBs; existing installs get them from your step.
- **Additive only.** Never `DROP`/rename columns or tables, and never add `NOT NULL` columns without a default — an older image must still be able to open a newer DB (the update wizard's rollback path depends on this).
- **Deprecating a table:** when a step supersedes a table instead of dropping it, register it in `DEPRECATED_TABLES` (in `server/migrations.js`) and remove every live-code reference to it — from then on only migration steps may mention it. A registered table may finally be `DROP`ped by a later cleanup step once the release floor has moved past every image that still used it (i.e. no supported downgrade target reads it anymore).
- Steps v1/v2 are intentionally idempotent catch-ups (probe-based `addColumn`, guarded backfills): the installs they target predate accurate `user_version` stamping. Don't copy that style for new steps.
- Upgrade-path changes should be tested against a fresh DB, a copy of an existing DB, and a re-run (must be a no-op) — see the commented v3 example in `server/migrations.js` for the step shape.

## EXTRA ACTION
- Every time you add endpoint on server, create a structure of request response and sample url on BACKEND_DOCUMENTATION.MD
- Update README.MD if you have any changes about features, instalation etc.