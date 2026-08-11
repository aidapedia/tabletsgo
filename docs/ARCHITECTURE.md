# Architecture — annotated file map

The full, annotated version of the map summarized in `CLAUDE.md`. Read this when
you need to know what a specific component or module does before touching it;
`CLAUDE.md` carries only the top-level routing.

Keep this in sync whenever you add, remove, or rename a folder.

## Frontend (`src/`)

Feature-sliced React + TypeScript. Imports use the `@/` alias (→ `src/`). Each
feature exposes a public API through its `index.ts` barrel; reach into another
feature via that barrel, not its internal files.

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
│   │   ├── page/                 #   the page shell every full-page view shares: PageHeader (back link +
│   │   │                         #     media/title/meta + actions), PageTabs (the tab bar AND the active
│   │   │                         #     tab's body, so spacing can't drift), Narrow (a capped content
│   │   │                         #     column — pages never cap themselves, HomeLayout owns the width)
│   │   ├── overlay/              #   Popover, Tooltip, ContextMenu
│   │   ├── feedback/             #   Toast, ConfirmDialog, TypeToConfirmDialog, LoadingState, EmptyState, Wizard
│   │   ├── table/                #   DataTable (the shared list-as-table: sortable columns, row click,
│   │   │                         #     pagination footer), Pagination, useDataTable (client-side
│   │   │                         #     sort/paging state — spread its result into DataTable; pass the
│   │   │                         #     props yourself for server-side paging), RowActions/RowAction/RowMenu
│   │   │                         #     (the action cell — every table's row buttons come from here so they
│   │   │                         #     share one look; the strip stops the click reaching the row)
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
│   │                             #   `user.role` is the SYSTEM role ('admin' | 'user') — see the
│   │                             #   `auth-sessions` skill.
│   │                             #   components/ProfileSetting + PasswordSetting: the caller's own
│   │                             #     account (rename / change password), rendered by Setting > Account.
│   │                             #     Email and system role stay read-only — an admin changes those
│   ├── admin/                    # the instance-admin area (system role 'admin' only): AdminWorkspacesPanel
│   │                             #   (every workspace + who owns it; create/rename/delete, grant ownership)
│   │                             #   AdminUsersPanel (accounts, system role, invites, password reset)
│   │                             #   and AdminSmtpPanel + SmtpForm (the instance's one mail server —
│   │                             #     the only place SMTP is configurable; see `auth-sessions` skill).
│   │                             #   Reaches nothing inside a workspace — an admin has no membership
│   ├── workspaces/               # org/tenant layer (multi-workspace): WorkspaceContext (current
│   │                             #   workspace + switch), WorkspaceSwitcher, MembersPanel,
│   │                             #   NotificationSettings (backup-failure emails — the mail server
│   │                             #     itself is instance-level, see `auth-sessions` skill),
│   │                             #   WorkspaceGeneral (rename + the default "max sessions per
│   │                             #     connection" every connection inherits);
│   │                             #   api (workspaces/members CRUD)
│   ├── connections/              # stores/ConnectionsContext (scoped to current workspace); components:
│   │                             #   ConnectionForm, ConnectionDetail (Data/Access/Backup tabs),
│   │                             #   ConnectionAccessPanel, DbTypePickerModal (owns DB_CATALOG/TYPE_LABEL),
│   │                             #   ConnectionSwitcherModal (the console's "switch connection" overlay:
│   │                             #     search + database-type filter chips + a collapsible folder tree —
│   │                             #     a connection's `folder` string nests on "/"; ↑/↓/Enter/Esc),
│   │                             #   ConnectionExportModal + ConnectionImportModal (whole-connection JSON
│   │                             #   bundle — see the `connection-transfer` skill),
│   │                             #   ConnectHandshakeDialog (root cause + retry/edit/open-anyway when the
│   │                             #     pre-flight handshake fails); hooks/useConnectHandshake ("Connect"
│   │                             #     probes /handshake and only then routes to the console — see the
│   │                             #     `db-engine` skill); api (connection
│   │                             #   access get/set, export/import client + file read/download helpers).
│   │                             #   ConnectionDetail shows the live session count against the
│   │                             #     workspace/instance limit — a connection sets no cap of its own
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
│   ├── resource-tree/            # the instance-wide resource hierarchy and the access granted on it:
│   │   │                         #   application → workspace → group → {connection, storage} →
│   │   │                         #   {dashboard, workflow}. Ownership and grants cascade down it, so this
│   │   │                         #   is where "who can do what, where" is both shown and edited
│   │   ├── components/           #   ResourceTree (the collapsible tree; right-click for "new group"
│   │   │                         #     and "move…", both gated on the node's `canOrganise`), NodeDetail
│   │   │                         #     (owner / breadcrumb / contents / your resolved access, plus group
│   │   │                         #     create-rename-delete and the move button — mirrored nodes rename
│   │   │                         #     with their resource but re-file freely), MoveNodeDialog (the
│   │   │                         #     destination picker: candidates filtered by the catalog's `children`
│   │   │                         #     so the shape is the server's, greyed where `canOrganise` is false,
│   │   │                         #     own subtree excluded), NodeAccessList (the one access panel: owner,
│   │   │                         #     grants made here and everyone who reaches this through an ancestor
│   │   │                         #     or a group, in one list grouped by role — only a row granted *here*
│   │   │                         #     offers a revoke, the rest link to the node where the grant lives, so
│   │   │                         #     a grant still has exactly one place it's edited), GrantForm (the
│   │   │                         #     role list is filtered by `grantableOn` so it can't offer what the
│   │   │                         #     server refuses), NodeMembers (a group's roster — who a grant to that
│   │   │                         #     group reaches; gated on `teams.manage`, not `resources.organise`,
│   │   │                         #     because adding someone to a group grants them access, and kept a
│   │   │                         #     separate panel because a roster is not access to the group itself),
│   │   │                         #     NodeIcon (one icon per node type, in one place — a group draws as
│   │   │                         #     people, since the roster is what a grant to it reaches)
│   │   ├── hooks/                #   useResourceTree (tree + catalog + selection + detail in one place)
│   │   └── lib/                  #   tree (nestNodes — the payload is flat because a member sees a sparse
│   │                             #     slice; ancestorIds from the materialized path; nodeHref),
│   │                             #     access (buildAccessRows: folds owner + grants + resolved people
│   │                             #     into role buckets, one row per *path* not per person, and unions
│   │                             #     `grants` in so a grant reaching nobody stays visible/revocable)
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
│   │                             #   region label — the diagram hosts them from SchemaDraftPage, not the
│   │                             #   console), FolderDot; lib/api (wraps shared/api/folders with the
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
│   │   │                         #     onBrowseConnections — no inline connection popover anymore. Every
│   │   │                         #     entry selects a sidebar panel except Schema, which *leaves* the
│   │   │                         #     console for /schemas/connection/:id — the diagram is not a console
│   │   │                         #     tab — and so has no active state; hidden on Redis),
│   │   │                         #   TabBar (one open-tab strip per editor pane: drag a tab left/right to
│   │   │                         #   reorder — insertion caret on drag-over, committed on drop — or onto the
│   │   │                         #   other pane's strip to move it there (onAdopt); right-click closes this/
│   │   │                         #   others/to-the-right/all *within that pane*, or splits the tab off.
│   │   │                         #   Its `actions` slot holds the split right / split down / unsplit buttons),
│   │   │                         #   StatusBar (bottom bar of the main area only — the icon rail and Tables
│   │   │                         #   sidebar keep their full height. DB type + logo,
│   │   │                         #   connection name, environment pill, current database/schema, and the
│   │   │                         #   schema version on the right — clicking it opens the schema history tab.
│   │   │                         #   Env + version live here only; the top toolbar no longer shows them)
│   │   └── lib/                  #   savedQueries, queryHistory (backend calls)
│   ├── schema-designer/          # visual schema design (React Flow ERD + table/column editors; tables
│   │   │                         #   sharing a folder are clustered into a draggable, editable region;
│   │   │                         #   sticky notes pinned to the canvas, and the whole arrangement —
│   │   │                         #   table/group/note positions — saved with the draft)
│   │   ├── components/           #   SchemaEditor, SchemaSidebar (accordion: Draft Schema / Table List /
│   │   │                         #     References / Table Folders — click to focus/edit), CreateTablePanel,
│   │   │                         #     TableEditPanel, columnFields, SchemaHistoryPanel (schema-version audit
│   │   │                         #     trail), ReleaseDialog (the confirmation in front of Release: every
│   │   │                         #     statement, and the database receiving them), LinkConnectionDialog /
│   │   │                         #     UnlinkConnectionDialog (give a from-scratch design a database — same
│   │   │                         #     engine only — and cut a draft loose from one, carrying its live
│   │   │                         #     tables out as DDL)
│   │   ├── components/           #   …plus WorkspaceSchemaList (the workspace-wide draft table behind
│   │   │                         #     /schemas) and NewSchemaDialog (name + either a connection ⟶ an empty
│   │   │                         #     saved query of kind 'schema' on it, or from scratch ⟶ pick a dialect
│   │   │                         #     ⟶ a workspace draft row; both then open at /schemas/:id).
│   │   │                         #     SchemaEditor stays out of the barrel so React Flow never lands in
│   │   │                         #     the home chunk. **The console hosts no diagram** — SchemaDraftPage is
│   │   │                         #     the only host, so `changes` / `onStageItems` / `onOpenTable` /
│   │   │                         #     `onOpenSchema` (the Changes-queue + data-grid half of the editor's
│   │   │                         #     optional prop contract) currently go unpassed
│   │   └── lib/                  #   rollback (best-effort rollback SQL for staged DDL),
│   │                             #   api (workspace-wide list, one-draft-either-kind read,
│   │                             #   from-scratch draft CRUD), design (the diagram's *design*:
│   │                             #   layout + notes + groups, and the portable .design.json
│   │                             #   export/import document)
│   ├── workflow/                 # workflow automations (React Flow builder + server-side runner, incl.
│   │   │                         #   real hourly/daily scheduling via the Schedule trigger node's Active toggle;
│   │   │                         #   JSON export/import of a workflow's graph; folders — grouped via the generic
│   │   │                         #   folders tree (type='workflow'), 3-level cap — mirroring the dashboard feature)
│   │   ├── components/           #   WorkflowEditor (export/import toolbar buttons), WorkflowsPanel (folder
│   │   │                         #     tree: create/rename/delete/drag into folders + "Import from JSON…"),
│   │   │                         #     NodePalette, NodeConfigPanel, RunLogPanel, nodes/WorkflowNode (spec card),
│   │   │                         #     WorkspaceWorkflowList (the workspace-wide table behind /workflows —
│   │   │                         #     read-only: schedule + last run per workflow, row opens it in its console)
│   │   └── lib/                  #   api (per-connection CRUD + run + folder CRUD via shared/api/folders,
│   │                             #     plus listWorkspaceWorkflows for the workspace-wide list),
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
    ├── console/                  # WorkspacePage — the per-connection DB console (route /connection/:id).
    │                             #   Tabs are one flat list; each carries the editor pane (0 | 1) it shows
    │                             #   in, so a split is just "some tabs live in pane 1". Every open-X helper
    │                             #   funnels through openTab (focus where it already lives, else the focused
    │                             #   pane); settlePanes re-points each pane's active tab after any change and
    │                             #   folds the split away once pane 1 empties. Both panes render through the
    │                             #   same renderTabContent, so a split mounts two tabs at once
    └── home/                     # the authenticated home shell — one file per sidebar section
        ├── HomeLayout            #   sidebar (grouped nav, rows are real <a> so they can be opened in a
        │                         #   new tab) + <Outlet/> inside THE content container: one max-width,
        │                         #   centered, shared by every page — a page never sets its own width
        ├── ui                    #   page composition: Section, TabbedSection, SubHead, ComingSoon, plus
        │                         #   re-exports of shared/ui/page's PageHeader / PageTabs / Narrow
        ├── useTabRoute           #   binds a tab bar to a path segment; the bare section path redirects
        │                         #   to the first tab so every tab has a pasteable address
        ├── HomePage (/)          #   the landing page: connection + member counts
        ├── DashboardsPage        #   /dashboards → every dashboard in the workspace, across its
        │                         #   connections (features/dashboard's WorkspaceDashboardList); a row
        │                         #   navigates to /connection/:id?dashboard=<id>, opened as a console tab
        ├── ConnectionsPage       #   /connections — filter bar (search / env / folder / type / status)
        │                         #   over the connection list, rendered with shared/ui/table's DataTable
        │                         #   (sortable columns, 10/page, row click → detail)
        ├── ConnectionDetailPage  #   /connections/:id/:tab — one connection (features/connections'
        │                         #   ConnectionDetail); the tab lives in the URL
        ├── ConnectionFormPage    #   /connections/new (engine in ?type=) and /connections/:id/edit/:tab —
        │                         #   both modes of features/connections' ConnectionForm
        ├── StoragePage           # /storage → S3 storage destinations (StorageList), top-level sidebar item
        ├── WorkflowsPage         # /workflows → every workflow in the workspace, across its connections
        │                         #   (features/workflow's WorkspaceWorkflowList); a row navigates to
        │                         #   /connection/:id?workflow=<id>, which the console opens as a tab
        ├── SchemasPage           # /schemas → every schema draft in the workspace: the ones designed
        │                         #   against a connection and the from-scratch ones (schema-designer's
        │                         #   WorkspaceSchemaList). "New schema" (NewSchemaDialog) creates either
        │                         #   kind here — on a connection it is createSaved(kind:'schema') with
        │                         #   empty SQL, from scratch a workspace draft row. Every row opens at
        │                         #   /schemas/:id; the console's rail Schema icon goes to that connection's
        │                         #   own editor address instead (see SchemaDraftPage below)
        ├── SchemaDraftPage       # /schemas/:id → the schema editor page, hosting either kind of draft,
        │                         #   and /schemas/connection/:connectionId → "the editor for this
        │                         #   connection", which is what the console's rail Schema icon opens: it
        │                         #   reads that connection's saved queries and redirects (replace) to the
        │                         #   newest kind='schema' one, or — with none — synthesizes an id-less
        │                         #   draft so the canvas draws the live tables and Save creates the first
        │                         #   draft (a falsy `draftId` is what makes SchemaEditor's Save mean that).
        │                         #   The static `connection` segment outranks `:id`, so the two coexist.
        │                         #   Full-screen: routed *outside* HomeLayout (own header strip + h-screen),
        │                         #   so the diagram gets the whole viewport the way the console does.
        │                         #   Loads it via GET /api/workspaces/:id/schemas/:draftId, which resolves
        │                         #   both tables and enforces connection access; a connection-linked draft
        │                         #   draws that live database and saves back to its saved query, a
        │                         #   from-scratch one starts empty and saves to its draft row. It also owns
        │                         #   the connection's table folders (the diagram's regions): fetchTableFolders
        │                         #   on the linked connection, edit/delete from the region menu, and
        │                         #   TableFolderPickerPanel behind the node menu's "Move to folder…".
        │                         #   Submit is hidden either way — there is no Changes queue
        │                         #   here — but **Release** runs the staged DDL against the draft's own
        │                         #   connection after a confirmation listing every statement (ReleaseDialog).
        │                         #   Statements that ran leave the draft, the arrangement stays, and what ran
        │                         #   is recorded as one migration on that connection, so it rolls back from
        │                         #   its schema history. A from-scratch draft has no database: Release is
        │                         #   disabled, and "Link to connection" (LinkConnectionDialog) *moves* the
        │                         #   design onto a connection of the same engine — createSaved(kind:'schema')
        │                         #   then deleteSchemaDraft, so its id changes and the page follows it —
        │                         #   after which it releases like any other. "Unlink" (UnlinkConnectionDialog)
        │                         #   moves it back the other way (createSchemaDraft then deleteSaved), and
        │                         #   offers to carry the connection's live tables out as CREATE TABLE
        │                         #   statements (buildCreateTableSql over getDiagram) — they are drawn by the
        │                         #   connection, not stored in the draft, so without that the canvas would
        │                         #   keep only what is staged. Neither direction touches a database.
        │                         #   Export is the other way the DDL leaves
        ├── ResourceTreePage      # /resource-tree/:nodeId? → the hierarchy on the left, the selected
        │                         #   node's owner / grants / your-access on the right. The selection is
        │                         #   in the URL, so a refresh keeps it and a link lands on it
        ├── WorkspaceSettingsPage # /workspace → General / Config / Member tabs
        └── SettingsPage          # /settings → Account / Theme / Data / Keymap / Updates tabs (Account
                                  #   renders features/auth's ProfileSetting + PasswordSetting; Updates
                                  #   renders UpdatePanel)
```

Note: `features/workspaces` (plural) is the org/tenant layer (workspaces, members,
invites); `features/workspace` (singular) is the per-connection DB console. Don't
conflate them.

### Future decomposition candidates
Out of scope so far: `pages/console/WorkspacePage.tsx` (~2200 lines),
`schema-designer/SchemaEditor.tsx` (~1800), `workspace/TableView.tsx` (~900), and
`server.js` (~2900 — the remaining step is moving route handlers into
`server/routes/*.js` express routers).

## Backend (`server.js` + `server/`)

`server.js` is routes and wiring only; everything a route needs lives in a module
under `server/`.

```
server.js                 # express app: 108 routes, static frontend, schedulers, shutdown
server/
├── config.js             # every env var + filesystem path, resolved once (imports nothing app-level)
├── util.js               # safeJson, jsonPreview, describeError, sleep, sanitizeForKey, computeNextRun
├── crypto.js             # AES-256-GCM: encryptSecret/decryptSecret + streamed file encryption.
│                         #   One scrypt-derived key per namespace (connections | storage | backup files)
├── meta.js               # the app's own SQLite handle, initMetaDb(), snapshotMetaSync()
├── migrations.js         # versioned, append-only meta-schema steps (see the `meta-schema` skill)
├── auth.js               # the guards — requireAuth, requireSystemAdmin (system role),
│                         #   requirePermission/requireMember (workspace role) — plus the
│                         #   connection-access rules. `sessionMiddleware` resolves the bearer
│                         #   token once per request so the ~100 sync guards stay sync.
│                         #   `permissionsIn`/`can` resolve through resource-tree.js; membership
│                         #   is what still gates *opening* a database
├── permissions-catalog.js # leaf: the closed set of permission keys (each with the node type it
│                         #   is meaningful at), the node types the resource tree is built from,
│                         #   and the seeded builtin roles. Imports nothing, so permissions.js,
│                         #   resource-tree.js and migrations.js can all use it
├── permissions.js        # ★ the role catalog: `roles` + `role_permissions`, an in-memory policy
│                         #   cache (the guards are sync), and a role's requirement criteria —
│                         #   `roleGrantableOn(slug, nodeType)`. Roles are instance-wide, admin-defined
├── resource-tree.js      # ★ the hierarchy everything hangs off, and where a role is granted:
│                         #   application → workspace → group → {connection, storage} →
│                         #   {dashboard, workflow}. Owns `resource_nodes` + `resource_grants` and
│                         #   resolves every permission by walking a node's ancestors — ownership
│                         #   short-circuits to everything, `inherit` decides a grant's reach.
│                         #   `path` is materialized so that walk is one query
├── workspaces.js         # workspaces + their roster on the workspace node: the admin listing, ownership
│                         #   changes, and the one delete cascade both delete routes share.
│                         #   "Owner" = holds `workspace.manage`, never a role-name comparison
├── users.js              # the instance user directory (`users`): system roles, invites,
│                         #   promote/demote (promoting to admin strips every membership)
├── login-guard.js        # sign-in brute-force protection: counts consecutive failures on
│                         #   the account and blocks it past the threshold. An instance admin
│                         #   only ever gets a self-expiring cooldown — see the `auth-sessions` skill
├── app-settings.js       # instance-wide settings (`app_settings`, key → JSON): the admin-owned
│                         #   counterpart of workspaces.settings. Today one key, 'smtp' — the global
│                         #   mail server, its password sealed under its own scrypt namespace
├── sessions/             # ★ the session store — logins + open-connection sessions
│   ├── index.js          #   the registry: auth tokens, connection sessions, the limit, the sweeper
│   ├── db.js             #   durable backend: the meta DB's `sessions` table — the source of
│   │                     #     truth for logins (survives a restart / a flushed cache)
│   ├── hybrid.js         #   composes cache + source; decides which namespaces are durable
│   ├── memory.js         #   the cache: in-process, the only one (no external store)
│   └── limits.js         #   resolveMaxSessions: connection → workspace → instance → unlimited
├── mail.js               # SMTP resolution (admin app-settings → env) + the transactional emails
├── connections.js        # connection records: rowToConnection/connectionToRow + CRUD + schemaVersion
├── folders.js            # FOLDER_TYPES + the polymorphic folder tree (depth/height/ancestor checks)
├── schema-drafts.js      # from-scratch schema drafts (schema_drafts): a diagram the *workspace* owns
│                         #   because it has no connection — the row carries the dialect its DDL targets.
│                         #   Drafts designed against a connection stay saved queries (kind = 'schema')
├── storage.js            # storage destinations (S3-compatible + built-in local disk) and object ops:
│                         #   store/fetch/list/delete/prune. Every step branches on `dest.local`, not a caller
├── db/                   # ★ the engine-agnostic database layer — see the `db-engine` skill
│   ├── index.js          #   the driver contract + generic dispatch (the only file routes import)
│   ├── diagnose.js       #   why a connection attempt failed: engine-agnostic transport
│   │                     #     classification + the driver's own `explainError`
│   ├── sql.js            #   dialect-agnostic SQL text utils shared by the SQL drivers
│   ├── sqlite.js         #   one file per engine; each adapts itself to the contract
│   ├── postgres.js
│   └── redis.js
├── workflow.js           # the node-graph executor (vm sandbox, {{input.x}} substitution),
│                         #   executeAndRecord, nextRunForGraph, runDueWorkflows
├── connection-transfer.js  # the portable connection export/import bundle (see that skill)
├── backup/
│   ├── index.js          #   barrel — what the routes import
│   ├── schedule.js       #   the backup_schedules row store, clamps and validation
│   ├── runner.js         #   export → store, retries, run history, failure notification
│   └── restore.js        #   fetch artifact → decrypt → hand to the driver
└── system-update.js      # GitHub release checking (cached) + Docker-socket self-update
```
