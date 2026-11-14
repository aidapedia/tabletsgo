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
- **Hayat owns identity and authorization; tabletsgo keeps none of it.** Accounts, sign-in, SSO, workspaces (= Hayat *tenants*), rosters, groups, roles and grants live in Hayat; `server/hayat/` is the only way to ask. Never reintroduce a local user, login, role, grant or tree table, or a local-login fallback (decided 2026-11-10). → skill `auth-sessions`
- **`requireAuth` is sync**, and stays sync — the Hayat token is verified in `sessionMiddleware`. The workspace guards are **async**: `if (!(await requirePermission(req, res, wsId, 'x'))) return` — a missing `await` is a silent authorization bypass (a Promise is truthy), and so is `list.filter(async …)`; use `filterAsync`. → skill `auth-sessions`
- **Reach the metadata store through `db()`** (from `server/meta.js`), never a client you hold — `transaction(fn)` only composes because nested calls read `db()`. In `server.js` it is imported as `meta()`, since `db` there is the database layer. → skill `meta-schema`
- **A route asks for a permission, never a role name** — `requirePermission(req, res, wsId, 'storage.manage')`. Roles are Hayat data; routes use the short key and `server/permissions-catalog.js` maps it to Hayat's (`tabletsgo.storage.manage`). → skill `auth-sessions`
- **A permission exists because a route enforces it** — add it to `server/permissions-catalog.js` (which generates tabletsgo's Hayat contract) and bump `CONTRACT_VERSION`; a contract version only adds, and goes live as soon as tabletsgo publishes it (only a version that files types under another service's types waits for that service's owners). → skill `auth-sessions`
- **Opening a connection is `connection.open` at the connection's node in Hayat** — `userCanAccessConnection` asks exactly that. Hayat's rule covers ownership, grants (inherit), the roster of a `hayat/group` it is filed under, and refuses non-members. Nothing granted means nobody. Managing one is owning it or `connections.manage` *at the connection*. → skill `auth-sessions`
- **Membership gates data** — `isMember()` (the tenant's roster in Hayat) decides who sees a workspace's resources; what they may do is a permission. An instance admin (`instance.manage` at Hayat's root) holds no data access through that role. → skill `auth-sessions`
- **A connection or storage destination is mirrored into Hayat's tree by the route that creates, renames, re-owns or deletes it** — never on its own, and the row and the mirror change together (create: mirror or roll back; delete: mirror first). Dashboards and workflows are not mirrored. → skill `auth-sessions`
- **Never cache a Hayat answer outside `server/hayat/`** — its caches are emptied by Hayat's Watch stream and by our own writes (read-your-writes); a copy kept elsewhere would outlive a revoked grant. → skill `auth-sessions`
- **People, rosters and grants are managed in Hayat's console**, never through a tabletsgo route — tabletsgo's pages read them and link there (`consoleLink`). The workspace's name is the tenant's: `PUT /api/workspaces/:id` refuses `name`. → skill `auth-sessions`
- **Meta migrations are append-only and additive-only** — Prisma Migrate owns them (`prisma/<engine>/migrations`, one history per engine, edited together); never edit a shipped migration or the frozen legacy steps (they read the frozen `server/migrator/legacy/catalog.js`), never `DROP`/rename, never add `NOT NULL` without a default. The one sanctioned exception is `20261110000000_hayat_owns_identity`, which the migrator precedes by writing the Hayat import bundle. → skill `meta-schema`
- **The app migrates on boot, before anything opens the meta DB** — `import './server/migrator/boot.js'` stays the *first* import of `server.js`. On SQLite Prisma Migrate can't work on a file another connection holds, and `server/meta.js` opens its client the moment it is evaluated; never migrate from anywhere that runs after it. → skill `meta-schema`
- **`workspaces.settings.smtp` is dead data** — never read it. SMTP is instance-level. → skill `auth-sessions`
- **`server/config.js` is the only place that reads `process.env`** for tunables. → skill `add-tunable`
- **A new per-connection resource goes in the export bundle** and the `DELETE /api/connections/:id` cascade, together. → skill `connection-transfer`
- **Always `SCAN`, never `KEYS`** on Redis. → skill `db-engine`
- **An instance admin switches modules; the server enforces them** — a turned-off engine is refused in `driverFor` (never re-check it in a route), a feature's routes go through `assertModuleEnabled`, and an engine still in use is only turned off with `force` — its connections are then **locked, never deleted**: the `/api/connections/:id` guard refuses everything but `DELETE` and the handshake, the webhook route checks too, and the schedulers skip them. The UI only hides (`useModules`). Module settings live only in Admin → Modules — no env var under them. → `server/module-registry.js`

## WHERE THINGS ARE
Full annotated file map: **`docs/ARCHITECTURE.md`** — read it when you need to know
what a specific component or module does. Keep both it and this section in sync
whenever you add, remove, or rename a folder.

### Frontend (`console/`)
Its own npm workspace beside the server, like hayat's `console/`: `console/package.json`,
`vite.config.js`, `tsconfig.json`, `components.json` (shadcn/ui). One `npm ci` at the root
installs both; `npm run dev` / `build` / `typecheck` at the root run the console's. The
server serves `console/dist`. React 19 + TypeScript + Tailwind v4 + **shadcn/ui** (radix-nova).
Imports use the `@/` alias (→ `console/src/`). Each feature exposes a public API through
its `index.ts` barrel; reach into another feature via that barrel, not its internal files.

```
console/src/
├── app/         # wiring only: main.tsx, App.tsx, providers/, layouts/ (route shells), routes/ (table + guards)
├── shared/      # ui/ (shadcn primitives, kebab-case, flat; composites in form/, navigation/, overlay/,
│                #   feedback/, table/, page/ + PascalCase root), hooks/, lib/, api/, config/, types/
└── features/    # self-contained business features, each with its own pages (XPage.tsx) — no pages/ layer
```

| Feature | What it owns |
| --- | --- |
| `auth` | AuthContext: signing in at Hayat (OIDC code + PKCE via `oidc-client-ts`), the `/callback` page, the caller's account (read-only, links to Hayat) |
| `admin` | instance-admin area (`instance.manage` at Hayat's root): the one SMTP config. Accounts and workspaces are Hayat's |
| `modules` | which databases/features the instance offers: `useModules().isEnabled(id)`, Admin → Modules panel, the wizard's module picker + settings fields |
| `workspaces` | org/tenant layer: current workspace (a Hayat tenant), its roster (read-only, links to Hayat), notifications, tabletsgo's settings |
| `workspace` | **the per-connection DB console** — DataGrid, TableView, QueryEditor, tabs, status bar |
| `connections` | connection CRUD, owner + who-can-open (from Hayat), type picker, switcher modal, export/import, connect handshake |
| `redis` | the Redis-shaped console pieces: key tree sidebar + command console (console kind `keyspace`) |
| `kafka` | the stream-shaped console pieces: topics sidebar, consumer-groups sidebar (own rail entry), topic/group/produce tabs, command console (console kind `stream`) |
| `table-folders` | the connected DB's tables grouped by the generic folders tree (`type='table'`) |
| `schema-designer` | React Flow ERD, table/column editors, schema history, DDL rollback |
| `workflow` | node-graph automations: builder, scheduling, folders, JSON export/import |
| `dashboard` | per-connection query dashboards: variables, 12-col grid, hand-rolled SVG charts, row actions |
| `backup` | S3-compatible storage destinations + per-connection backup schedule and restore |
| `ssh` | workspace SSH keys (generate/import, copy public key) + the gateways connections tunnel through |
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
prisma/<engine>/         # schema.prisma + migrations/ per engine (sqlite | postgresql) → skill meta-schema
scripts/migrate.js       # `npm run migrate [-- --status]` — the migrator by hand (the app runs it on boot; the updater's one-shot container runs this)
scripts/hayat-bundle.js  # `npm run hayat:bundle [-- --admin <email>]` — the bundle `hayat import` loads (contract + named first admin on a fresh install)
scripts/hayat-remap.js   # `npm run hayat:remap -- result.json` — rewrite user ids Hayat matched to existing accounts
scripts/dev/hayat.sh     # `npm run dev:hayat` — Hayat from ../hayat's source beside tabletsgo; writes .env option B
scripts/dev/demo-workspace.mjs# the Demo workspace hayat.sh seeds once: sample SQLite DBs + connections, people with every kind of access
scripts/dev/kafka/       # local Kafka stacks (broker+ACLs, Schema Registry, Connect, ksqlDB) + seed.mjs sample data
server.js                # express app: routes, static frontend, schedulers, shutdown
server/
├── config.js            # every env var + filesystem path, resolved once      → skill add-tunable
├── util.js  crypto.js   # helpers; AES-256-GCM secret + file encryption
├── meta.js              # Prisma Client for the app's own store: db(), transaction(), backups → skill meta-schema
├── meta-connection.js   # openMeta() + snapshotMeta(): the one place that picks the engine
├── migrator/            # ★ the migrator, run on boot (boot.js): Prisma Migrate + frozen legacy v1–v22; hayat-export.js writes the Hayat import bundle → skill meta-schema
├── hayat/               # ★ Hayat's service API: connect.js (Connect over fetch, Watch, token verify), index.js (people, tenants, cached decisions, mirrors) → skill auth-sessions
├── auth.js              # the guards + sessionMiddleware, over Hayat          → skill auth-sessions
├── permissions-catalog.js  # leaf: permission keys ↔ Hayat keys, tabletsgo's Hayat contract → skill auth-sessions
├── sessions/            # connection sessions (in-process cache)              → skill auth-sessions
├── workspaces.js        # tabletsgo's per-workspace settings row + the data cascade
├── app-settings.js  mail.js                                                   → skill auth-sessions
├── module-registry.js   # leaf: the module catalog (engines + features) + in-memory on/off and settings
├── module-settings.js   # loads/saves them (`app_settings` key `modules`); refuses turning off an engine in use
├── connections.js       # connection records (encrypted credentials blob)
├── folders.js           # the polymorphic folder tree (4 types, depth caps)
├── schema-drafts.js     # from-scratch schema drafts: a diagram a *workspace* owns, no connection
├── ssh.js               # SSH keys + gateways (bastions); host key pinning      → skill db-engine
├── cloudflare-access.js # SSH over Cloudflare Access (WebSocket + service token) → skill db-engine
├── storage.js           # storage destinations (S3 + local disk) and object ops
├── db/                  # ★ the engine-agnostic database layer (sqlite|postgres|mysql|redis|kafka) → skill db-engine
├── workflow.js          # the node-graph executor + scheduler
├── connection-transfer.js  # the portable connection bundle          → skill connection-transfer
├── data-transfer.js     # table rows out/in as CSV/JSON/SQL (console Export / Import tab) → skill db-engine
├── backup/              # schedule.js / runner.js / restore.js
├── system-update.js     # GitHub release checking + Docker-socket self-update
├── openapi.yaml         # the API reference: every route, served as Swagger UI at /api/docs
└── openapi.js           # loads it; its Swagger UI options
```

## CONVENTIONS
### Frontend
- A feature folder gets `components/`, `stores/`, `lib/`, `hooks/`, `types.ts` only as needed — don't create empty buckets.
- Cross-feature use goes through the barrel (`@/features/x`); intra-feature files import each other directly to avoid barrel import cycles.
- Name folders/files for what they do (e.g. `schema-designer`, not `erd-viewer`; `database.ts`, not `sqlite.ts`).
- **A page never sets its own width.** `HomeLayout` (in `app/layouts/`) owns the one content container (max-width, centered); build pages with `shared/ui/page`'s `PageHeader` + `PageTabs` (a plain header-plus-list page is `Section` from `shared/ui/page/Section`, which owns the header→content gap — don't hand-roll a `mt-*` wrapper; header CTAs are `size="lg"`), and wrap only the content that reads badly wide in `<Narrow>`. A page-level `max-w-*` is what made every section a different shape before.
- **A route shell lives in `app/layouts/`, never under the section that uses it first.** `HomeLayout` is the shell for the home, admin *and* account routes; filing it under one feature would say it belonged to that one.
- **A page lives in its feature and is composition, not logic** (`features/x/XPage.tsx`, lazy-loaded by `AppRoutes`). If it grows state engines and panel wiring, those belong in the feature's components/hooks — `features/workspace/WorkspacePage.tsx` reads the `:id` and renders `features/workspace`'s `DatabaseConsole`, which is where the console's hooks and components live.
- **Anything a user can be looking at has an address.** A detail view, a create/edit form and a tab are routes (`/connections/:id/:tab`, `/connections/:id/edit/:tab`), not `useState` on the list page — so a refresh keeps you there and a link lands there. Use `useTabRoute` to bind a tab bar to its segment. Transient dialogs (confirm, export, picker) stay local state.
- **A time the app recorded is formatted through `shared/lib/datetime`** (`formatDateTime`, `formatDate`, `formatTime`, `isSameDay`, `zonedInputToDate` for a `datetime-local` input), never `toLocaleString` on a Date — that is what makes it follow the zone in the person's account. A value read from someone's own database stays as stored, and a day bucket the server cut in UTC stays UTC.
- All backend calls go through `shared/api/request.ts`: use `request()` for mutations (throws on failure — caller `try/catch`es and toasts) and `safeRequest(path, fallback)` for reads that should degrade quietly. Don't call `fetch` directly or re-declare `API_URL`.
- **UI is shadcn/ui.** Primitives live flat in `shared/ui/<name>.tsx` (`button`, `badge`, `input`, `select`, `dialog`, `alert-dialog`, `sheet`, `popover`, `dropdown-menu`, `tooltip`, `command`, `table`, …) — use them with shadcn's API: `<Button variant="outline" size="sm">` (icon-only: `size="icon-*"`), `<Tooltip><TooltipTrigger asChild>…</TooltipTrigger><TooltipContent>`, `<Dialog>/<DialogContent>`, `<Switch onCheckedChange>`, `<Badge variant="warning">`. Add a missing one with the shadcn CLI (`npx shadcn add <name>` in `console/`), then tune only density and tokens. Colors are shadcn tokens (`bg-background`, `bg-muted`, `text-muted-foreground`, `border-border`, `bg-primary`, `text-destructive`) plus four of ours: `text-faint`, `text-primary-bright`, `success`, `warning` — never a hex. Toasts are `toast.success/error/info` from `sonner`. `fieldClass` (from `shared/ui/input`) is **only** for a non-`<input>` that must read as a field — never on a raw `<input>`/`<textarea>`; use `Input`/`Textarea`. An options-array select is `OptionSelect` (`variant="ghost"` for a bare switcher in a toolbar or trail). The app's own icons (`shared/ui/icons`) carry `width`/`height`; shadcn only sizes lucide icons.
- Reuse the shared micro-components instead of re-styling inline: `Avatar` (initial bubble for a named thing that isn't a person), `PersonAvatar` (a person's generated face — always seeded `name || email`, so they look the same in every list), `Badge` (uppercase pill), `PersonRow` (avatar+name+email), `CheckboxRow` (bordered selectable row), `HelpTip` (a "?" whose hover explains the thing beside it — for a field, pass `FormField`'s `help` instead of a `hint` when the text is advice rather than something needed to fill it in), `SearchInput` (input with search icon), `LoadingState`/`EmptyState` (faint placeholders), `ConfirmDialog` (from `shared/ui/confirm-dialog`, mounted while asking; `typeToConfirm` for the irreversible — never `window.confirm`), `toggleId` (selection-list toggle), `DragHandle` + `useDragReorder` (drag-to-reorder a list of cards — the grip starts the drag, the whole card is the drop target, and the cards animate into place on drop; spread `listProps` on the container and give `itemProps(i, id)` a stable id, never the index; native HTML5 drag, so it does **not** work inside a React Flow canvas, whose d3-drag suppresses native drag events), `AccountTile` (the signed-in person's face as a rounded tile; `presence` notches the online dot into it — pass the `surface` it sits on), `AccountMenu` (name/email/settings/sign-out popover), `RailItem`/`RailDivider` (a row of a 56px icon rail), `Breadcrumb` (the `root / … / here` trail — see below).
- **A list page offers List / Grid** — `useListView('<list>')` + `<ViewToggle>` at the end of the search row, and pass `view` into `useDataTable` (it reaches `DataTable` through the spread). The grid card is built from the columns: the first is its title, a trailing empty-header column its actions, the rest labelled fields — so keep that column shape, or pass `renderCard` for a card of your own (connections does).
- **A path a user is standing in is drawn by `Breadcrumb`** — the shell's trail, a node's ancestors in the resource tree, the location a dialog writes into. `HomeLayout` draws the trail above every page and works out root → section from the address, so a page never draws its own; `PageHeader`'s `crumbs` adds only what comes after the section (a record's name). The last crumb is where you are and never links, even if given an `onClick`. Don't hand-roll another `name / name` line. An **editor** outside the shell (the schema editor) draws no trail — just a back button beside its title.
- **There is one icon rail, used twice** — the console's `IconRail` and the home sidebar collapsed. Both are built from `RailItem`, so size, tooltip and active look are defined once; don't restyle either in place.
- Heavy editors stay out of feature barrels so they code-split: `WorkflowEditor`, `DashboardView`, `RedisConsole`/`RedisEditor` (they pull in CodeMirror / React Flow).

### Backend
- A module owns its table(s): if a route is writing raw SQL against `backup_schedules` or `storage_destinations`, that belongs in the module.
- Dependencies point one way: `module-registry` and `permissions-catalog` are leaves (import nothing); `config → hayat → crypto → meta-connection → meta → sessions → {auth, workspaces, app-settings, connections, folders, storage, module-settings} → ssh → mail → db → workflow/backup/transfer → server.js`. `hayat/` imports only `config` (no meta store), so anything may ask it. `migrator/` sits beside them on `config → crypto → meta-connection → permissions-catalog` and never imports `meta.js` (its handle would lock the SQLite file Prisma needs). No cycles — `sessions` never imports `db`; the db layer hands it a release callback instead (`setReleaseHandler`), which is what lets the sweeper close idle handles. Also `backup/schedule.js` is split out from the runner precisely so `connection-transfer.js` can read a schedule without importing the pipeline.

## EXTRA ACTION
- Every time you add endpoint on server, describe its request, response and sample values in `server/openapi.yaml` — it is served as Swagger UI at `/api/docs`, and `tests/openapi.test.js` fails when it and `server.js` disagree
- Update README.MD if you have any changes about features, instalation etc.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
