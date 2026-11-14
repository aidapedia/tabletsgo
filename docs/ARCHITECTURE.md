# Architecture — annotated file map

The full, annotated version of the map summarized in `CLAUDE.md`. Read this when
you need to know what a specific component or module does before touching it;
`CLAUDE.md` carries only the top-level routing.

Keep this in sync whenever you add, remove, or rename a folder.

## Frontend (`console/`)

The console is its own npm workspace — `console/package.json`, `vite.config.js`,
`tsconfig.json`, `components.json` (shadcn/ui) — beside the server at the repo root,
the way hayat keeps its `console/` beside its Go backend. The root `package.json`
lists it under `workspaces`, so one `npm ci` installs both, and `npm run dev` /
`build` / `typecheck` at the root run the console's. The server serves its build
from `console/dist` (`DIST_DIR`).

Feature-sliced React 19 + TypeScript on shadcn/ui (radix-nova style, Tailwind v4).
Imports use the `@/` alias (→ `console/src/`). Each
feature exposes a public API through its `index.ts` barrel; reach into another
feature via that barrel, not its internal files.

```
console/src/
├── app/                          # app wiring (no business logic)
│   ├── main.tsx                  # entry: mounts <AppProviders><App/>
│   ├── App.tsx                   # renders <AppRoutes/>
│   ├── providers/                # ThemeContext + AppProviders (composes every provider)
│   ├── layouts/                  # route shells rendered around an <Outlet/>: HomeLayout (the
│   │                             #   authenticated shell — grouped sidebar nav, rows are real <a> so
│   │                             #   they can be opened in a new tab, wrapping THE content container:
│   │                             #   one max-width, centered, shared by every page, so a page never
│   │                             #   sets its own width). A layout lives here rather than under the
│   │                             #   section that happens to use it first — HomeLayout is the shell for
│   │                             #   the home, admin and account halves alike
│   └── routes/                   # AppRoutes (route table + RequireAuth guard)
│
├── shared/                       # reusable, feature-agnostic code
│   ├── ui/                       # presentational components:
│   │   ├── *.tsx (kebab-case)    #   shadcn/ui primitives (`components.json` → here): button, badge, input,
│   │   │                         #     textarea, label, select, checkbox, switch, toggle(-group), radio-group,
│   │   │                         #     dialog, alert-dialog, sheet, popover, dropdown-menu, context-menu,
│   │   │                         #     tooltip, command, table, tabs, breadcrumb, pagination, progress,
│   │   │                         #     scroll-area, collapsible, card, alert, separator, skeleton, sonner.
│   │   │                         #     Tuned to tabletsgo's density and palette, otherwise stock: add more
│   │   │                         #     with the shadcn CLI and keep its output. Their svg sizing rule only
│   │   │                         #     touches lucide icons (`svg.lucide`), so the app's own icons keep
│   │   │                         #     their drawn sizes; every portal goes through `portalContainer()` so
│   │   │                         #     overlays still paint over a fullscreened element
│   │   ├── confirm-dialog.tsx    #   ConfirmDialog — AlertDialog for "are you sure"; `typeToConfirm` adds
│   │   │                         #     the type-the-name friction for what can't be undone
│   │   ├── form/                 #   composites on those primitives: FormField (shadcn Label + control +
│   │   │                         #     hint/error), OptionSelect (an `options`-array select: shadcn Select,
│   │   │                         #     or Popover + Command when `searchable`; `variant="ghost"` for a bare
│   │   │                         #     switcher), Segmented (ToggleGroup), PasswordInput, SearchInput,
│   │   │                         #     CheckboxRow, NumberStepper, DatePicker/TimePicker/DateTimeField,
│   │   │                         #     SettingRow
│   │   ├── navigation/           #   NavItem, Tab, MenuItem (a row in a menu panel), Breadcrumb (shadcn
│   │   │                         #     breadcrumb from a `Crumb[]`), RailItem
│   │   ├── page/                 #   the page shell every full-page view shares: PageTrail (how a page adds
│   │   │                         #     to the trail HomeLayout draws), PageHeader (media/title/meta +
│   │   │                         #     actions), PageTabs (the tab bar AND the active
│   │   │                         #     tab's body, so spacing can't drift), Narrow (a capped content
│   │   │                         #     column — pages never cap themselves, HomeLayout owns the width),
│   │   │                         #     Section (a plain header-plus-content page), TabbedSection, SubHead,
│   │   │                         #     ComingSoon
│   │   ├── overlay/              #   composites on shadcn overlays whose callers need more than the
│   │   │                         #     primitive: Popover (render-prop trigger/`close` over shadcn
│   │   │                         #     Popover), ContextMenu + ContextMenuSub (a DropdownMenu at a cursor
│   │   │                         #     point), SlideOverPanel (Sheet, driven by useSlideOver), CommandPalette
│   │   │                         #     (CommandDialog), rowMenu (right-click a row → its kebab menu)
│   │   ├── feedback/             #   LoadingState, EmptyState, ProgressBar (shadcn Progress), Wizard (Dialog)
│   │   ├── table/                #   DataGrid (editable console grid shared with Redis), PagedDataGrid
│   │   │                         #   (DataGrid + pager for a grid handed its whole row set: query results,
│   │   │                         #     Kafka ACLs), usePagination (client-side paging for any list), GridRules
│   │   │                         #   (a DataGrid's client-side Filter/Sort/Columns popovers + matchFilter/
│   │   │                         #     sortRows/cycleSortRules — table tab, histories, Kafka ACLs), DataTable
│   │   │                         #   (the shared list-as-table on shadcn Table: sortable columns, row click,
│   │   │                         #     pagination footer), Pagination, useDataTable (client-side
│   │   │                         #     sort/paging state — spread its result into DataTable; pass the
│   │   │                         #     props yourself for server-side paging), RowActions/RowAction/RowMenu
│   │   │                         #     (the action cell — every table's row buttons come from here so they
│   │   │                         #     share one look; the strip stops the click reaching the row),
│   │   │                         #     useListView + ViewToggle (the per-list List / Grid switch,
│   │   │                         #     remembered in localStorage; `view="grid"` makes DataTable draw
│   │   │                         #     the rows as cards built from its columns, or `renderCard`'s own)
│   │   └── (root, PascalCase)    #   app composites: Avatar, PersonAvatar, PersonRow, RefreshButton, RowLabel, HelpTip (a "?" whose hover
│   │                             #     explains its neighbour — FormField's `help`), DragHandle (the grip a
│   │                             #     reorderable list grabs by — pair with useDragReorder),
│   │                             #     SaveQueryPanel, SqlEditor, CodeEditor, CommandReference (a command
│   │                             #     console's side panel: catalog rows → insert, chevron → that command's
│   │                             #     docs in place, Back → the list), CommandDocView + CommandDoc (one
│   │                             #     command's docs, any engine),
│   │                             #     icons — no group yet
│   ├── hooks/                    # generic hooks (useServerVersion — the connected server's release, one
│   │                             #   cached lookup per connection, shared by the status bar and every
│   │                             #   command reference; useSlideOver, useDragReorder — drag-to-reorder a
│   │                             #   vertical list of cards: the grip starts it, the whole card is a
│   │                             #   drop target, and the cards animate into their new places (FLIP:
│   │                             #   measure on drop, play the delta with transforms). Native HTML5
│   │                             #   drag, so keep it out of a React Flow canvas, whose own d3-drag
│   │                             #   suppresses native drag events)
│   ├── lib/                      # helpers: datetime (every time the app shows, in the account's zone), recents, schemaDraft, toggleId, version (meetsVersion)
│   ├── api/                      # backend client: request.ts (fetch wrapper) + database.ts
│   ├── config/                   # runtime API_URL and shared database type catalog/labels
│   └── types/                    # ambient/shared TS types (globals.d.ts)
│
├── features/                     # self-contained business features (each has index.ts barrel)
│   ├── auth/                     # signing in, either mode (GET /api/auth/config says which). Solo: the
│   │                             #   owner's SoloSignIn / SoloSetup drawn in place by RequireAuth, access
│   │                             #   token in memory + httpOnly refresh cookie; useIdentity() → { mode,
│   │                             #   people } gates member pages (EnterpriseOnly). Enterprise: at Hayat —
│   │                             #   stores/AuthContext (oidc-client-ts, code + PKCE,
│   │                             #   tokens per tab in sessionStorage, renewal on demand and deduplicated —
│   │                             #   Hayat revokes a refresh token family on reuse; registers the token
│   │                             #   source shared/api/request reads), CallbackPage (/callback), api
│   │                             #   (/auth/config, /auth/me). `user.role` is 'admin' when they hold
│   │                             #   tabletsgo's admin role at Hayat's root — see the `auth-sessions` skill.
│   │                             #   components/AccountSetting: the account, read-only, linking to Hayat's
│   │                             #     account page (name, password, time zone, sign-in methods are Hayat's)
│   ├── admin/                    # the instance-admin area: AdminSmtpPanel + SmtpForm (the instance's one
│   │                             #   mail server). Accounts, workspaces, roles and sign-in are Hayat's
│   ├── modules/                  # which databases/features the instance offers (server/module-registry.js):
│   │                             #   ModulesContext (useModules().isEnabled — the type picker and the
│   │                             #   Backup tabs hide what's off; useEngineLimits(type) — the consoles'
│   │                             #   query timeout and the table view's row limit), AdminModulesPanel (Admin → Modules:
│   │                             #   toggles, the blocked-engine dialog, the settings slide-over),
│   │                             #   ModulePicker + ModuleSettingsFields (fields are drawn from the
│   │                             #   schema the server sends)
│   ├── workspaces/               # org/tenant layer — a workspace is a Hayat tenant: WorkspaceContext (current
│   │                             #   workspace + switch), WorkspaceSwitcher, MembersPanel (the roster,
│   │                             #     read-only, with each member's workspace roles; MembersPage links to the
│   │                             #     tenant in Hayat's console; MemberDetailPage + MemberAccessTable: one
│   │                             #     member's Access list — every grant that reaches them, from Hayat),
│   │                             #   RequireWorkspace / NoWorkspace (pages that need a current workspace),
│   │                             #   NotificationSettings (backup-failure emails — the mail server
│   │                             #     itself is instance-level, see `auth-sessions` skill),
│   │                             #   WorkspaceGeneral (the name, read-only + link to Hayat; removing
│   │                             #     tabletsgo's data for it), WorkspaceConfig (the default "max
│   │                             #     sessions per connection" every connection inherits);
│   │                             #   HomePage (the `/` landing) built from components/home/
│   │                             #     (StatTile, HomePanel, ConnectionsPanel, AutomationPanel,
│   │                             #     ActivityPanel, GettingStarted) + hooks/useHomeOverview
│   │                             #     (one parallel read of the workspace-wide lists);
│   │                             #   api (workspaces/members CRUD)
│   ├── connections/              # stores/ConnectionsContext (scoped to current workspace); components:
│   │                             #   ConnectionForm, ConnectionDetail (Data/Access/Schema history/Backup
│   │                             #     tabs — `detailTabs(type)` drops Schema history on a schemaless
│   │                             #     engine; the tab itself is schema-designer's SchemaHistoryPanel),
│   │                             #   ConnectionAccessPanel, DbTypePickerModal (uses shared/config/databaseTypes),
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
│   │                             #     + argument hints + `since` per command, isWriteCommand), docs (redisCommandDoc: the
│   │                             #     reference panel's static summary/returns/example responses;
│   │                             #     liveRedisDoc merges the server's COMMAND DOCS over it — args,
│   │                             #     complexity, history — + redis.io link), tree (buildKeyTree:
│   │                             #     split keys on ':' — one
│   │                             #     folder level per segment, no chain folding; TTL/type formatting)
│   ├── kafka/                    # everything stream-shaped in the console (console kind `stream`,
│   │   │                         #   see shared/config/databaseTypes). Like Redis it swaps the browser
│   │   │                         #   sidebar and the query tab, and adds three tab kinds.
│   │   ├── components/           #   KafkaSidebar (the topics, grouped by dotted
│   │   │                         #     prefix; New topic; a row's menu opens any of its views),
│   │   │                         #     ConsumerGroupsSidebar (its own rail entry under Topics: groups
│   │   │                         #     sorted by lag, each unfolding its consumers via describeGroup), TopicView (one tab per view, TOPIC_VIEWS: MessageBrowser /
│   │   │                         #     PartitionsPanel / TopicConsumersPanel / TopicConfigPanel — the "Kafka
│   │   │                         #     Topic Overview" template has the same as a dashboard; no header — the
│   │   │                         #     topic's shape goes up to the status bar via onDetail/topicFacts),
│   │   │                         #     TopicMenuItems (the topic's actions, in the sidebar row's ⋮ — a
│   │   │                         #     tab's right-click menu is close/split only), GroupView + ResetOffsetsDialog (live dry
│   │   │                         #     run; apply needs an empty group + the id typed back),
│   │   │                         #     ProduceView (a produce tab; production asks for the topic name),
│   │   │                         #     CreateTopicDialog (also Clone: `cloneOf`), ClearTopicDialog,
│   │   │                         #     ClusterView (one tab per lib/services CLUSTER_PANELS entry, opened from the console toolbar: BrokersPanel,
│   │   │                         #     AclsPanel). The services
│   │   │                         #     beside it are rail entries (lib/services SERVICE_PANELS, shown
│   │   │                         #     when the connection names one; kafkaPanelsFor puts Consumer
│   │   │                         #     groups ahead of them), each a sidebar + a tab kind:
│   │   │                         #     SchemaRegistrySidebar + SubjectView, ConnectSidebar +
│   │   │                         #     ConnectorView, KsqlSidebar + KsqlView, ConfigList
│   │   │                         #     (a topic's or broker's configs, shared), Tile,
│   │   │                         #     KafkaConsole + KafkaEditor (lazy, NOT in the
│   │   │                         #     barrel — CodeMirror; commands + topic/group completion)
│   │   └── lib/                  #   api (/streams/* client), commands (catalog for completion, hints
│   │                             #     and the reference panel), docs (kafkaCommandDoc: the reference panel's
│   │                             #     options/returns/examples — the only docs our grammar has),
│   │                             #     format (topic tree, lag tones, JSON)
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
│   ├── saved-queries/            # saved-query API shared by the console and schema designer
│   ├── workspace/                # the DB console (one connection): data browsing + querying
│   │   ├── components/           #   TableView uses shared/ui/table/DataGrid (drag / Shift+click selects a rectangular cell range —
│   │   │                         #     ⌘/Ctrl+C copies it as TSV, Esc clears; the range rides along in
│   │   │                         #     onCellContextMenu's payload as `selection`), TableView (its cell
│   │   │                         #     context menu acts on that selection: copy as TSV/CSV/JSON, set
│   │   │                         #     NULL/EMPTY/DEFAULT, duplicate/delete the spanned rows),
│   │   │                         #   SchemaView, QueryEditor, FunctionView,
│   │   │                         #   QueryHistoryView, InsertRowPanel, ChangesPanel, SavedQueriesPanel,
│   │   │                         #   DataTransferView (the Export / Import tab the toolbar's button beside
│   │   │                         #     Query history open; DataExportPane + DataImportPane in a shared
│   │   │                         #     TransferLayout; hidden on Redis),
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
│   │   │                         #   DatabaseConsole (the shell itself — rail + sidebar + panes + status
│   │   │                         #     bar, and nothing else: it wires the hooks below to the components
│   │   │                         #     around it), ConsoleSidebar (the aside + namespace breadcrumb — a
│   │   │                         #     stream engine's cluster id in its place — with the selected panel
│   │   │                         #     as children), ObjectBrowser (tables/views/
│   │   │                         #     functions accordion + table folders — owns its own filter, sort and
│   │   │                         #     folders, none of which leave it), ConsoleToolbar, EditorPanes (both
│   │   │                         #     panes + the drag divider; takes a renderContent render prop),
│   │   │                         #     TabContent (one tab's body — the kind switch, and where the lazy
│   │   │                         #     QueryEditor / WorkflowEditor / DashboardView / RedisConsole are
│   │   │                         #     imported), EmptyWorkspace, TabContextMenu, ConnectionLostModal
│   │   ├── hooks/                #   the console's state engines, each independently readable:
│   │   │                         #   useConsoleTabs (the flat tab list + panes + split + per-tab editor
│   │   │                         #     state: openTab focuses where a tab already lives else the focused
│   │   │                         #     pane; settlePanes re-points each pane's active tab after any change
│   │   │                         #     and folds the split away once pane 1 empties),
│   │   │                         #   useConnectionBrowser (namespace, objects, ping + heartbeat, nsConn),
│   │   │                         #   useStagedChanges (the Changes queue, direct-execute, commit batches,
│   │   │                         #     one schema-version bump per batch),
│   │   │                         #   useQueryHistory, useSchemaHistory (trail + rollback),
│   │   │                         #   useFolderTree (the folder CRUD all three panels share),
│   │   │                         #   useResourceLibrary (a foldered per-connection resource you open in a
│   │   │                         #     tab — workflows and dashboards are the same object to the console,
│   │   │                         #     so they are one hook parameterized, not two copies),
│   │   │                         #   useSavedQueries (not a library: a saved query seeds a tab rather than
│   │   │                         #     being edited in place, and saving from its tab updates it)
│   │   └── lib/                  #   savedQueries, queryHistory, dataTransfer (backend calls), dialect, consoleCommands
│   │                             #     (the ⌘K entries — engine-aware, hints mirror the live keymap),
│   │                             #     sql-reference (the SQL editor's command reference: one catalog per
│   │                             #     engine — sqlite, postgres — of statements, clauses and functions
│   │                             #     with the release each arrived in; index turns an entry into a
│   │                             #     CommandDoc and dims what the connected server predates)
│   ├── schema-designer/          # visual schema design (React Flow ERD + table/column editors; tables
│   │   │                         #   sharing a folder are clustered into a draggable, editable region;
│   │   │                         #   sticky notes pinned to the canvas, and the whole arrangement —
│   │   │                         #   table/group/note positions, plus each table's column order (dragged
│   │   │                         #   in the create/edit table panels, never on the canvas: in the create
│   │   │                         #   panel it rewrites the CREATE TABLE, in the edit panel it is the
│   │   │                         #   *drawn* order, since no engine can move a column of an existing
│   │   │                         #   table with ALTER) — saved with the draft, together with
│   │   │                         #   the *schema it draws*: a draft stores its database's tables and
│   │   │                         #   FKs (SchemaSnapshot, inside `layout`). The canvas reads no
│   │   │                         #   database at all — it draws that snapshot and follows a newer one
│   │   │                         #   arriving in `layout`; the host is what syncs ("Sync schema" in
│   │   │                         #   SchemaDraftPage's header, plus the write-back after a Release))
│   │   ├── components/           #   SchemaEditor, SchemaSidebar (accordion: Draft Schema / Table List /
│   │   │                         #     References / Table Folders — click to focus/edit), CreateTablePanel,
│   │   │                         #     TableEditPanel (also the one writer of the drawn column order —
│   │   │                         #     onReorderColumns, saved even when it stages no SQL), columnFields
│   │   │                         #     (ColumnField takes the `dragHandle` its list passes in), SchemaHistoryPanel (schema-version audit
│   │   │                         #     trail), ReleaseDialog (the confirmation in front of Release: every
│   │   │                         #     statement, and the database receiving them), LinkConnectionDialog /
│   │   │                         #     UnlinkConnectionDialog (give a from-scratch design a database — same
│   │   │                         #     engine only — and cut a draft loose from one, carrying its live
│   │   │                         #     tables out as DDL), SchemaHistoryPanel (the connection's migration
│   │   │                         #     trail as a *home* tab — /connections/:id/schema. Not
│   │   │                         #     workspace/components/SchemaHistoryView: that one is the console's DataGrid with a
│   │   │                         #     flex height; this is the shared DataTable. Both take
│   │   │                         #     canRollbackTo/rollbackTitle/MigrationInspector from
│   │   │                         #     MigrationInspector, so the rollback rule is written once)
│   │   ├── components/           #   …plus WorkspaceSchemaList (the workspace-wide draft table behind
│   │   │                         #     /schemas, with the Created by column — who saved it *last* is the
│   │   │                         #     editor header's line, not a second name per row. Its row actions:
│   │   │                         #     open, schema version history, unlink, delete. Only delete happens
│   │   │                         #     in the list (deleteWorkspaceSchema branches on connectionId, then
│   │   │                         #     the row goes); the other two navigate, and both are disabled on a
│   │   │                         #     from-scratch row) and NewSchemaDialog (name + either a connection ⟶ an empty
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
│   │                             #   layout + notes + groups + the schema snapshot the draft
│   │                             #   draws — SchemaSnapshot/schemaSnapshot/withoutSchemaSnapshot —
│   │                             #   and the portable .design.json export/import document, which
│   │                             #   carries the design but never the snapshot)
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
│   │   │                         #   Table widgets: server-side pagination, 25 rows unless set (LIMIT/OFFSET
│   │   │                         #   wrap, falling back to slicing; N+1 has-more probe) + per-row action buttons (up to 3, styled via
│   │   │                         #   variant/icon, optional per-row condition that disables/hides by a
│   │   │                         #   column value) that run a workflow with the clicked row as its trigger
│   │   │                         #   input (Widget.pageSize/rowActions; icons in lib/rowActionIcons).
│   │   │                         #   A table can also list its columns (Widget.tableColumns: header, display
│   │   │                         #   text|number|compact|bytes|bar|badges|count, prefix/unit, mono, color thresholds); a metric
│   │   │                         #   aggregates a column (Widget.metric: first|sum|count|min|max|avg|rate,
│   │   │                         #   thresholds — base + "from value" steps with color/caption — hero or stat-tile look).
│   │   ├── components/           #   DashboardView (tab content: toolbar + VariableBar + WidgetGrid),
│   │   │                         #     DashboardsPanel (rail list), WidgetCard (runs its query; samples a rate
│   │   │                         #     metric every 10 s), WidgetChart, TableWidget (per-column cells),
│   │   │                         #     WidgetEditor + ColumnsEditor + MetricEditor + ThresholdsEditor + ColorSwatch +
│   │   │                         #     DashboardSettings, MarkdownText,
│   │   │                         #     charts/ (XYChart area|line|bar, PieDonut, SankeyChart, chrome)
│   │   └── lib/                  #   api (per-connection CRUD), variables ({{}} substitution + option
│   │                             #     resolution), queryData (result → chart shapes), metric (aggregate +
│   │                             #     rate sampling), thresholds (active step + its color as card tint/text/fill),
│   │                             #     format (number/compact/bytes, list cells), palette (validated
│   │                             #     CVD-safe series colors), grid (collision math), scale, useSize
│   ├── backup/                   # S3-compatible storage destinations (workspace-scoped) + the
│   │   │                         #   per-connection backup schedule built from generic workflow nodes
│   │   │                         #   (Schedule → Export SQL → Store to Storage)
│   │   ├── components/           #   StorageList, StorageModal, BackupPanel, BackupConfigForm,
│   │   │                         #     BackupCalendarHeatmap, BackupVersionList (run-based restore),
│   │   │                         #     RestorePanel (restore from uploaded file or browsed storage object)
│   │   └── lib/                  #   api (storages CRUD, backup schedule/runs/calendar/restore), types
│   ├── ssh/                      # SSH keys + gateways (workspace-scoped) a connection tunnels through
│   │   ├── components/           #   SshGatewayList/SshGatewayModal (test, pinned host key, reset),
│   │   │                         #     SshKeyList/SshKeyModal (generate or import; view = copy public
│   │   │                         #     key), PublicKeyBox
│   │   ├── lib/                  #   api (keys + gateways CRUD, gateway test), providers (form presets:
│   │   │                         #     SSH server / Railway / Cloudflare — derived, never stored)
│   │   └── types.ts
│   ├── templates/                # built-in, read-only template catalog (browse + apply only — no
│   │   │                         #   authoring). A template bundles workflows + dashboards; applying
│   │   │                         #   creates the workflows first, resolves `{{workflow:<key>}}`
│   │   │                         #   placeholders in dashboard row-action `workflowId`s against the
│   │   │                         #   newly created ids, then creates the dashboards. Filterable by
│   │   │                         #   DB type ("postgresql" | "sqlite" | "kafka") against Template.databases.
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
│       ├── components/           #   UpdateBanner (dismissible home-shell banner), UpdatePanel (Admin → Settings >
│       │                         #     Updates: version + changelog + re-check), UpdateWizard (guided flow)
│       ├── stores/               #   UpdateContext (useUpdate: info + check + per-version dismiss)
│       └── lib/                  #   api (/api/system/* client + version polling), types
│
└── (no pages/)                   # like hayat, a page lives in the feature that owns it (features/x/XPage.tsx)
                                  #   and stays composition: it reads the address and renders the feature's
                                  #   components. AppRoutes lazy-loads each one; see the table below.
```
Where each route's page lives:

| Route | Page |
| --- | --- |
| `/callback` (back from signing in at Hayat) | `features/auth/CallbackPage` (+ `components/AuthCard`) |
| `/`, `/members`, `/members/:userId`, `/notifications(/:sub)`, `/workspace(/:sub)` | `features/workspaces/` HomePage, MembersPage, MemberDetailPage, NotificationsPage, WorkspaceSettingsPage |
| `/connections`, `/connections/:id/:tab`, `/connections/new`, `…/edit/:tab` | `features/connections/` ConnectionsPage, ConnectionDetailPage, ConnectionFormPage |
| `/connection/:id` (the console, outside HomeLayout) | `features/workspace/WorkspacePage.tsx` → DatabaseConsole |
| `/dashboards` · `/workflows` · `/storage` | `features/dashboard/DashboardsPage` · `features/workflow/WorkflowsPage` · `features/backup/StoragePage` |
| `/schemas`, `/schemas/:id`, `/schemas/connection/:connectionId` (editor, outside HomeLayout) | `features/schema-designer/` SchemasPage, SchemaDraftPage |
| `/ssh/hosts`, `/ssh/keys` | `features/ssh/` SshHostsPage, SshKeysPage |
| `/settings(/:sub)` (the person's own account) | `features/settings/SettingsPage` |
| `/admin…` | `features/modules/AdminModulesPage` (`/admin` lands here); `features/admin/AdminEmailPage`; `features/system-update/AdminUpdatesPage` |

Tab bars bind to their address with `shared/hooks/useTabRoute`.


Note: `features/workspaces` (plural) is the org/tenant layer (workspaces, members,
invites); `features/workspace` (singular) is the per-connection DB console. Don't
conflate them.

### Future decomposition candidates
Out of scope so far: `schema-designer/SchemaEditor.tsx` (~2500),
`workspace/TableView.tsx` (~900), and `server.js` (~2900 — the remaining step is
moving route handlers into `server/routes/*.js` express routers).

The console was the other one. It is now `workspace/components/DatabaseConsole.tsx`
(~600 lines of wiring) over `workspace/hooks/*`; `features/workspace/WorkspacePage.tsx`
is a dozen lines. Same shape to copy for SchemaEditor: pull the state engines out
as hooks, the regions out as components, and leave the top file saying only how
they talk to each other.

## Backend (`server.js` + `server/`)

`server.js` is routes and wiring only; everything a route needs lives in a module
under `server/`.

```
prisma.config.mjs         # Prisma CLI config: META_DB_TYPE picks prisma/<engine>/ (paths from server/config.js)
prisma/
├── sqlite/               # schema.prisma + migrations/ (0_baseline = legacy v22) — Prisma Migrate's
└── postgresql/           #   history is provider-locked, so one per engine; both declare the same models
scripts/migrate.js        # `npm run migrate [-- --status]` — the migrator by hand (also the updater's one-shot container)
scripts/dev/hayat.sh      # `npm run dev:hayat` — Hayat from ../hayat's source + tabletsgo, configured as .env option B
scripts/dev/demo-workspace.mjs# the Demo workspace hayat.sh seeds once: sample SQLite DBs + connections, people with every kind of access
scripts/dev/kafka/        # local Kafka stacks (broker+ACLs, Schema Registry, Connect, ksqlDB) + seed.mjs sample data
server.js                 # express app: 108 routes, static frontend, schedulers, shutdown
server/
├── config.js             # every env var + filesystem path, resolved once (imports nothing app-level)
├── util.js               # safeJson, jsonPreview, describeError, sleep, sanitizeForKey, computeNextRun
├── crypto.js             # AES-256-GCM: encryptSecret/decryptSecret + streamed file encryption.
│                         #   One scrypt-derived key per namespace (connections | storage | backup files |
│                         #   app settings | ssh)
├── meta-connection.js    # openMeta() (SQLite or PostgreSQL, the one place that picks) + snapshotMeta()
├── meta.js               # Prisma Client for the app's store: db() (the open transaction's client, or
│                         #   the shared one), transaction(fn) (nested calls join), backupMeta(),
│                         #   checkMetaIntegrity(). BIGINTs come back as numbers;
│                         #   on SQLite a gate keeps other requests out of an open transaction. Never migrates —
│                         #   boot.js has already, before this module is evaluated
├── postgres-meta.js      # synchronous PostgreSQL handle — only the migrator uses it now
├── postgres-sql.js       # metadata placeholder and conflict syntax translation
├── migrator/             # ★ the migrator (see the `meta-schema` skill). Runs on boot, before the
│   │                     #   app opens its store; also `npm run migrate` and the updater's
│   │                     #   one-shot container
│   ├── index.js          # runMigrations(): empty → Prisma baseline + seed; pre-Prisma → legacy
│   │                     #   steps to v22, record 0_baseline applied; before the Hayat drop,
│   │                     #   writeHayatBundle(); then `prisma migrate deploy`.
│   │                     #   metaSchemaStatus() (what is applied / pending)
│   ├── hayat-export.js   # the old identity tables → the bundle `hayat import` loads (Hayat terms);
│   │                     #   exportSoloBundle(): a solo owner + workspace, for moving to enterprise
│   ├── identity.js       # the mode: TABLETSGO_MODE → recorded (`app_settings.identity`) → HAYAT_ISSUER;
│   │                     #   never enterprise → solo; solo → enterprise writes the bundle;
│   │                     #   captureSoloOwner() keeps a v1.0 account as the owner before the drop
│   ├── boot.js           # server.js's FIRST import: migrateAndResolveMode() before meta.js opens
│   │                     #   the store; sets server/mode.js
│   └── legacy/           # FROZEN pre-Prisma history, only for upgrading old installs to v22
│       ├── catalog.js    #   the pre-Hayat permission catalog the steps seed from (frozen copy)
│       ├── sqlite.js     #   v1–v22 stepped migrations + DEPRECATED_TABLES
│       ├── postgresql.js #   PostgreSQL v20 bootstrap + v21–v22
│       └── postgresql-v20.sql
├── dashboards.js         # dashboard metadata CRUD and workspace summaries
├── workflow-store.js     # workflow metadata CRUD and run-history reads
├── hayat/                # ★ Hayat, in tabletsgo's terms — see the `auth-sessions` skill
│   ├── connect.js        #   the wire: Connect over fetch (unary JSON + Watch frames), the
│   │                     #     client-credentials token, offline JWT verification (jose)
│   ├── index.js          #   people (directory), tenants + rosters, cached decisions (emptied by
│   │                     #     Watch and our own writes), resource mirrors, the contract publish
│   └── solo-backend.js   #   solo mode's backend at the same seam: Hayat's RPCs answered in-process
│                         #     for one owner + one workspace (owner holds every permission)
├── mode.js               # leaf: 'solo' | 'enterprise', as boot resolved it. No route reads it
├── solo.js               # solo's one owner (`app_settings` key `solo`, never a table): setup code,
│                         #   scrypt password, HS256 access/refresh tokens + tokenEpoch, account,
│                         #   the workspace's name. Answers 404 in enterprise mode
├── auth.js               # the guards over Hayat — requireAuth, requireSystemAdmin (tabletsgo
│                         #   admin role at Hayat's root), requirePermission/requireMember. The
│                         #   token is verified once per request in `sessionMiddleware`, so
│                         #   requireAuth stays a sync read; the workspace guards are async —
│                         #   always awaited. userCanAccessConnection = `connection.open` in Hayat
├── permissions-catalog.js # leaf: every permission key ↔ its Hayat key and scope, and
│                         #   contractManifest() — tabletsgo's Hayat contract (types, keys, roles)
├── workspaces.js         # tabletsgo's per-workspace row (settings; name cached from Hayat) and
│                         #   the data cascade DELETE /api/workspaces/:id runs
├── module-registry.js    # leaf (imports nothing): the module catalog — engines (postgresql,
│                         #   sqlite, redis, kafka) and features (backup) — plus an in-memory copy of
│                         #   the admin's on/off choices and settings. isModuleEnabled / moduleSetting
│                         #   are sync reads: the db layer's driverFor refuses a turned-off engine,
│                         #   the Kafka driver reads its read caps here; every engine has its own query
│                         #   timeout, and the SQL ones a table row limit the /table route enforces.
│                         #   Settings have no env var under them — Admin → Modules is the only source
├── module-settings.js    # loads/saves those choices (`app_settings` key 'modules'), the admin view
│                         #   with per-engine usage, and the rule only it can check: an engine in use
│                         #   is only turned off with `force` (else 409 + the connections). Forced, its
│                         #   connections are locked, not deleted — server.js's connection guard
│                         #   refuses all but DELETE + handshake, the schedulers skip them
├── module-notices.js     # notifies the owners of an engine's connections by email — one per unique
│                         #   address — that a forced turn-off locked them
├── app-settings.js       # instance-wide settings (`app_settings`, key → JSON): the admin-owned
│                         #   counterpart of workspaces.settings. Keys: 'smtp' (the global mail server,
│                         #   its password sealed under its own scrypt namespace), 'modules'
├── sessions/             # open-connection sessions (a login is a Hayat token, never stored)
│   ├── index.js          #   the registry: connection sessions, the limit, the sweeper
│   ├── memory.js         #   the store: in-process (no external store)
│   └── limits.js         #   resolveMaxSessions: workspace → instance → unlimited
├── mail.js               # SMTP resolution (admin app-settings → env) + tabletsgo's notices
├── connections.js        # connection records: rowToConnection/connectionToRow + CRUD + schemaVersion
├── folders.js            # FOLDER_TYPES + the polymorphic folder tree (depth/height/ancestor checks)
├── schema-drafts.js      # from-scratch schema drafts (schema_drafts): a diagram the *workspace* owns
│                         #   because it has no connection — the row carries the dialect its DDL targets.
│                         #   Drafts designed against a connection stay saved queries (kind = 'schema').
│                         #   Both tables carry the audit trail (created_by/updated_by/created_at + ts,
│                         #   meta v20); server.js's withAudit is what resolves the ids to names
├── ssh.js                # SSH keys (generate/import; public half + fingerprint as columns, private
│                         #   key sealed) and gateways (bastions: host/user + key or password, host key
│                         #   pinned on first login, transport tcp | cloudflare). connectGateway/
│                         #   forwardOut + SSH error prose
├── cloudflare-access.js  # SSH over Cloudflare Access: wss:// to the Access hostname with a service
│                         #   token, raw bytes in binary frames (what `cloudflared access ssh` does)
├── storage.js            # storage destinations (S3-compatible + built-in local disk) and object ops:
│                         #   store/fetch/list/delete/prune. Every step branches on `dest.local`, not a caller
├── db/                   # ★ the engine-agnostic database layer — see the `db-engine` skill
│   ├── index.js          #   the driver contract + generic dispatch (the only file routes import)
│   ├── diagnose.js       #   why a connection attempt failed: engine-agnostic transport
│   │                     #     classification + the driver's own `explainError`
│   ├── tunnel.js         #   SSH tunnels: a 127.0.0.1 listener per connection forwarding through its
│   │                     #     gateway; every dispatcher dials through it, so drivers never know.
│   │                     #     `forwardPort(host, port)` adds a listener per extra address on the same
│   │                     #     SSH login, for engines redirected to other hosts (Kafka's brokers)
│   ├── sql.js            #   dialect-agnostic SQL text utils shared by the SQL drivers
│   ├── sqlite.js         #   one file per engine; each adapts itself to the contract
│   ├── postgres.js
│   ├── mysql.js          #   MySQL: backticks, backslash-safe literals, a fresh connection for anything
│   │                     #     that leaves session state (USE, SET, BEGIN); mysqldump/mysql for backups
│   ├── redis.js
│   ├── kafka.js          #   Kafka: admin/producer/fetch clients per connection, the stream ops
│   │                     #     (topics, clear, bounded group-less reads, produce, groups, offset
│   │                     #     resets, brokers + their configs, ACLs)
│   ├── kafka-auth.js     #   client certificates (mTLS) + SASL OAUTHBEARER (client-credentials
│   │                     #     token, cached) and AWS_MSK_IAM (SigV4-signed, no AWS SDK)
│   ├── kafka-rest.js     #   the one HTTP client for the services beside a cluster: URL + Basic
│   │                     #     auth per service, the connection's TLS, its SSH tunnel; bounded reads
│   ├── kafka-registry.js #   Schema Registry: subjects/versions/compatibility + the wire format
│   │                     #     (Avro, Protobuf message indexes, JSON Schema ↔ JSON), codecs by id
│   ├── kafka-connect.js  #   Kafka Connect: connectors, plugins, validate/save, lifecycle actions
│   ├── kafka-ksql.js     #   ksqlDB: statements via /ksql, bounded SELECT/PRINT via /query-stream
│   └── kafka-command.js  #   pure parser: the console's command language + the WHERE filter
├── workflow.js           # the node-graph executor (vm sandbox, {{input.x}} substitution),
│                         #   executeAndRecord, nextRunForGraph, runDueWorkflows
├── connection-transfer.js  # the portable connection export/import bundle (see that skill)
├── data-transfer.js      # table rows out/in as CSV/JSON/SQL (the console's Export / Import tab):
│                         #   planExport streams pages of getTableData; previewImport/runImport go
│                         #   through insertRows/runScript/tableDdl — engine-agnostic
├── backup/
│   ├── index.js          #   barrel — what the routes import
│   ├── schedule.js       #   the backup_schedules row store, clamps and validation
│   ├── runner.js         #   export → store, retries, run history, failure notification
│   ├── history.js        #   backup run calendar, listing and upload status
│   └── restore.js        #   fetch artifact → decrypt → hand to the driver
├── system-update.js      # GitHub release checking (cached) + Docker-socket self-update
├── openapi.yaml          # the API reference: every route (tests/openapi.test.js keeps it honest)
└── openapi.js            # loads it, stamps the running version; Swagger UI options for /api/docs
```
