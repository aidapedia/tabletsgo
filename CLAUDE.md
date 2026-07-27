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
│   │   ├── form/                 #   Form/FormField/Label, Input/Textarea, Select, Checkbox,
│   │   │                         #     CheckboxRow, SearchInput, Toggle, NumberStepper, Segmented
│   │   ├── navigation/           #   NavItem, Tab, MenuItem
│   │   ├── overlay/              #   Popover, Tooltip, ContextMenu
│   │   ├── feedback/             #   Toast, ConfirmDialog, TypeToConfirmDialog, LoadingState, EmptyState, Wizard
│   │   └── (root)                #   Avatar, Badge, PersonRow, RowLabel, SaveQueryPanel, SqlEditor,
│   │                             #     JsonEditor, icons — no group yet
│   ├── hooks/                    # generic hooks (useSlideOver)
│   ├── lib/                      # helpers: recents, schemaDraft, toggleId
│   ├── api/                      # backend client: request.ts (fetch wrapper) + database.ts
│   ├── config/                   # runtime config / env (API_URL from VITE_API_URL)
│   └── types/                    # ambient/shared TS types (globals.d.ts)
│
├── features/                     # self-contained business features (each has index.ts barrel)
│   ├── auth/                     # stores/AuthContext + api (login/setup/invite); session token
│   ├── workspaces/               # org/tenant layer (multi-workspace): WorkspaceContext (current
│   │                             #   workspace + switch), WorkspaceSwitcher, MembersPanel, TeamsPanel,
│   │                             #   SmtpSettings, IntegrationsSettings (SMTP), NotificationSettings;
│   │                             #   api (workspaces/members/teams CRUD)
│   ├── connections/              # stores/ConnectionsContext (scoped to current workspace); components:
│   │                             #   ConnectionForm, ConnectionDetail (Data/Access/Backup tabs),
│   │                             #   ConnectionAccessPanel, DbTypePickerModal (owns DB_CATALOG/TYPE_LABEL);
│   │                             #   api (connection access get/set)
│   ├── settings/                 # stores/SettingsContext
│   ├── table-folders/            # the connected DB's tables grouped by the generic folders tree
│   │                             #   (type='table', 3-level cap, one folder per table), each folder
│   │                             #   carrying an optional color. Replaced the old "domains" feature —
│   │                             #   meta migration v5 folded every domain into the folders tree,
│   │                             #   keeping its id/name/color. Components: TableFolderList (the console
│   │                             #   sidebar's folder view: collapsible color-tinted folders + subfolders,
│   │                             #   drag a table into a folder / a folder into a folder, trailing
│   │                             #   "Ungrouped" drop zone, inline new folder + rename),
│   │                             #   TableFolderQuickMenu (the table context-menu row: hover flyout for
│   │                             #   one-click assign), TableFolderPickerPanel (right-side slide-over
│   │                             #   with inline create/edit/delete), TableFolderEditPanel (name+color),
│   │                             #   FolderDot; lib/api (wraps shared/api/folders with the 'table' type
│   │                             #   bound + set-table-folder), lib/assign, lib/tree (path/tree order).
│   │                             #   Drives the sidebar folder view and the schema-designer's
│   │                             #   draggable/editable folder regions.
│   ├── keymap/                   # stores/KeymapContext (useKeymap/useShortcut) + KeymapSetting
│   ├── workspace/                # the DB console (one connection): data browsing + querying
│   │   ├── components/           #   DataGrid (drag / Shift+click selects a rectangular cell range —
│   │   │                         #     ⌘/Ctrl+C copies it as TSV, Esc clears; the range rides along in
│   │   │                         #     onCellContextMenu's payload as `selection`), TableView (its cell
│   │   │                         #     context menu acts on that selection: copy as TSV/CSV/JSON, set
│   │   │                         #     NULL/EMPTY/DEFAULT, duplicate/delete the spanned rows),
│   │   │                         #   SchemaView, QueryEditor, FunctionView,
│   │   │                         #   QueryHistoryView, InsertRowPanel, ChangesPanel, SavedQueriesPanel, IconRail,
│   │   │                         #   TabBar (the open-tab strip: drag a tab left/right to reorder — insertion
│   │   │                         #   caret on drag-over, committed on drop; right-click closes this/others/
│   │   │                         #   to-the-right/all)
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
    ├── console/                  # WorkspacePage — the per-connection DB console (route /connection/:id)
    └── home/                     # the authenticated home shell — one file per sidebar section
        ├── HomeLayout            #   sidebar + <Outlet/>; every section route renders inside it
        ├── ui                    #   shared page primitives: PageHeader, Section, TabbedSection, SubHead, ComingSoon
        ├── DashboardPage (/)     #   connection + member counts
        ├── ConnectionsPage       #   connection list (cards + filters); detail/picker/form come
        │                         #   from features/connections
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
- Future decomposition candidates (out of scope so far): `pages/console/WorkspacePage.tsx` (~1460 lines), `schema-designer/SchemaEditor.tsx` (~1470), `workspace/TableView.tsx` (~760), and `server.js` (~4200 — split into route/lib modules; first extraction done: `server/migrations.js`, the meta-DB migration steps).

## CONFIGURATION (env / Docker)
Configurable values live in env vars, wired through `docker-compose.yml` (see `.env.example`); don't hardcode them:
- `PORT` (server), `META_DB` (metadata SQLite path), `NODE_ENV` — server runtime.
- `ENCRYPTION_KEY` — **required**. Encrypts connection credentials (host/port/username/password/…) at rest (AES-256-GCM); the server refuses to boot without it.
- `ADMIN_USERNAME` (email) / `ADMIN_PASSWORD` / `WORKSPACE_NAME` — **optional** pre-seed of the admin + first workspace. Unset ⇒ the in-browser first-run setup wizard runs (default). Don't bake defaults into the Dockerfile.
- `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` / `SMTP_SECURE` — **optional** fallback SMTP for member-invite emails (per-workspace UI settings override these). Invites always return a copyable link even without SMTP.
- `VITE_API_URL` — frontend API base, **baked at build time** via Dockerfile `ARG` (not runtime). Default `/api`.
- `TABLETSGO_TAG` — **optional**. Published image tag `docker compose` runs (and pulls on self-update). Default `latest`; one-click self-update works best on a moving tag.
- `UPDATE_AUTO_CHECK` — **optional**. Instance-wide default (truthy `1/true/yes/on`; default off) for the per-user "auto-check for updates" toggle in Settings > Updates, surfaced via `/api/system/version`'s `autoCheckUpdates`. Leave off when an orchestrator (e.g. Coolify) manages updates; users can still override per browser.
- `UPDATE_IMAGE` / `UPDATE_REPO` / `UPDATE_HELPER_IMAGE` — **optional** in-app update checker tuning (default to the official image/repo; override only for a fork). The checker compares the running `(version, sha)` against the latest GitHub Release + its `release.json` contract. Apply method is auto-detected: Docker socket mounted ⇒ one-click self-update via `UPDATE_HELPER_IMAGE` (default `docker:cli`); otherwise the wizard shows a manual `docker compose pull` command. `APP_VERSION` / `GIT_SHA` are baked into the image at build time and reported by `/api/system/version`.
When you add a new tunable, thread it through server.js env, the Dockerfile/compose, and `.env.example`.

## AUTH MODEL
Login/setup/accept-invite return `{ user, token }`; the token is stored in localStorage (`dbm.token`) and attached as `Authorization: Bearer` by `shared/api/request.ts`. Workspace/member and per-connection routes require it (server `requireAuth` / the `/api/connections/:id` membership middleware). Roles are **per workspace** (`admin` | `member`) via `workspace_members`. Connections carry a `workspace_id` column and are filtered by the caller's current workspace.

## CONNECTIONS & SCHEMA VERSIONING
The `connections` table stores dialect-agnostic fields (`type`, `name`, `workspace_id`, `environment`, `folder`, `tags`, `schema_version`) as plain columns and everything else (host/port/username/password/filepath/database/uri/sslmode/auth/keychain) as one AES-256-GCM-encrypted JSON blob in `credentials`. `server.js`'s `rowToConnection`/`connectionToRow` reassemble/split the flat connection shape the frontend has always used — the API contract for `/api/connections*` didn't change, only storage.

Every connection has a `schemaVersion` starting at 1. DDL staged from the schema designer / create-table panel / drop-table / empty-table actions is tagged `ddl: true` with a computed `rollbackSql` (see `src/features/schema-designer/lib/rollback.ts`) when staged. After `commitChanges` in `WorkspacePage.tsx` successfully executes a batch containing DDL, it calls `POST /api/connections/:id/schema/migrations` once, which records the batch (forward + rollback SQL) in `schema_migrations` and bumps `schema_version` — one version per successful commit, not per statement. Each migration carries a `status` (`active` | `rollbacked`; NULL on legacy rows = active). `GET .../schema/migrations` lists the trail; `POST .../schema/rollback { toVersion }` undoes every still-active migration newer than the target (newest first), refuses to cross an irreversible one (`reversible = 0`), marks the undone rows `rollbacked`, and resets `schema_version` to the target. Version numbers are reused after a rollback (roll 3→1, commit again ⇒ a new v2), so they're only unique among `active` rows. Plain row-level data edits (insert/update/delete via `TableView`) are never tagged `ddl` and never affect `schemaVersion`.

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
- Update C