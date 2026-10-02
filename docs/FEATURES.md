# Features

A detailed tour of what Tabletsgo does. The [README](../README.md) has the short version.

- [Connections](#connections)
- [SSH tunnels](#ssh-tunnels)
- [Data browser](#data-browser)
- [Table folders](#table-folders)
- [SQL editor](#sql-editor)
- [Data export / import](#data-export--import)
- [Redis keyspace & console](#redis-keyspace--console)
- [Schema designer](#schema-designer)
- [Workflows](#workflows)
- [Dashboards](#dashboards)
- [Templates](#templates)
- [Backups & restore](#backups--restore)
- [Connection sessions](#connection-sessions)
- [Workspaces & groups](#workspaces--groups)
- [Resource tree](#resource-tree)
- [Roles & permissions (RBAC)](#roles--permissions-rbac)
- [Email (SMTP)](#email-smtp)
- [Auth & security](#auth--security)
- [In‑app updates](#inapp-updates)
- [Split view](#split-view)
- [Keyboard‑first](#keyboardfirst)
- [Theming](#theming)

---

## Connections

Organize databases by environment, folder, and tags. Credentials encrypted at rest. Per‑connection access control. **Connect handshakes first** — the database is probed before the console opens, and a failure tells you the likely root cause (host unreachable, wrong password, missing database, TLS mismatch…) with what to change, instead of dropping you into a broken workspace. **JSON export/import** moves a whole connection between instances — its settings plus every folder, saved query, workflow, dashboard and backup schedule, re‑wired to fresh ids on import (the password is left out unless you ask for it; schedules arrive paused).

## SSH tunnels

The sidebar's **Infrastructure** group has two SSH pages: **SSH Host** (the SSH hosts / bastions connections tunnel through) and **SSH Key**. Generate an Ed25519/ECDSA/RSA key on the server (the private half never leaves it) or import an existing private key, then copy its public key into the bastion's `~/.ssh/authorized_keys`. An SSH host is an address, port, user, and either a key or a password; **Test** logs in, and its host key is pinned on first contact so a swapped server is refused. Presets cover a plain **SSH server**, **Railway** (`ssh.railway.com`, logging in as the service's domain, so connections can use private addresses like `postgres.railway.internal`) and **Cloudflare Access** (an SSH server behind a Cloudflare Tunnel — SSH is carried over Cloudflare with an Access service token, no `cloudflared` binary needed). Pick the SSH host on any PostgreSQL or Redis connection and everything — the console, workflows, dashboards and `pg_dump`/`pg_restore` backups — goes through the tunnel, with TLS still verifying the real database host. If a tunnel fails, the connect dialog tells you which part failed: SSH host unreachable, login rejected, host key changed, or the SSH host can't reach the database.

## Data browser

Fast, spreadsheet‑style data grid — filter, multi‑column sort (click a header, Shift+click to add), edit rows inline, insert & delete, with a staged **Changes** panel before you commit. Drag (or Shift+click) across cells to select a block, then `⌘/Ctrl+C` to copy it as TSV or right‑click for copy as CSV/JSON, set NULL/EMPTY/DEFAULT, and duplicate/delete the rows it spans.

## Table folders

Group a connection's tables into colored, nestable folders (up to 3 levels) — create one inline from the Tables sidebar header, drag tables (and folders) between them, and click a folder's icon to pick its color. The schema designer clusters each folder's tables into its own region on the ERD, where the region can be renamed, recolored or deleted and a table moved between folders from its node menu.

## SQL editor

CodeMirror‑powered editor with SQL highlighting, formatting, query history, and reusable **saved queries**.

## Data export / import

The **Export / Import** button beside Query history opens one tab with an Export/Import switch. Export: tick tables, pick **CSV**, **JSON** or **SQL** (optionally **Include schema** — the `CREATE TABLE`/index DDL), preview the first 50 rows per table, and download; multi‑table exports are ordered parents‑first by foreign key so they replay cleanly, and a multi‑table CSV saves one file per table. Import: just drop a CSV, JSON or SQL file — the file says the rest. The format comes from its extension (or its content), a CSV goes into the table named after the file (`users.csv` → `users`), a JSON export brings its own tables, and a SQL file runs as a script. A table that doesn't exist yet is created — from the schema in the file when it has one, otherwise with column types inferred from the rows. A dry‑run preview shows exactly that (each table, its row count, existing or new, and the `CREATE TABLE` a new one gets) before anything is written. Each table imports in one transaction, and a SQL script runs in one. Works on SQLite and PostgreSQL; hidden for Redis.

## Redis keyspace & console

On a Redis connection the sidebar becomes a **key tree** built from the `:` namespacing convention — paged with `SCAN` (never `KEYS`), filtered by a real match pattern, with per‑key type and TTL badges. Click a key to inspect its value (strings, lists, sets, sorted sets, hashes and streams, paged), set or clear its expiry, or delete it. The editor tab becomes a **command console**: every Redis command with autocomplete and argument hints, one command per line, run the whole buffer at once and see each command's reply.

## Schema designer

Visual ERD (React Flow) to create/edit tables and columns; staged DDL with a **schema version** audit trail and best‑effort rollback SQL. **Notes** pin free text to the canvas (right‑click → Add note; drag, resize, recolor) for the "why" a diagram can't show, and the whole **arrangement is saved with the draft** — every table, group region and note goes back exactly where you left it instead of being re‑arranged on open. **Column order is draggable** — in the Create/Edit Table panel, by the grip on each column card. Creating a table (or reopening a staged one), the order you drop the cards in is the order the `CREATE TABLE` below the form is written with. Editing a table that already exists, it's the order the *diagram draws* it in, saved with the design like a table's position or a note — because no engine can move a column of an existing table with `ALTER` (not PostgreSQL, not SQLite), and a reorder is worth saving without pretending otherwise; that save needs no other change to be a real one. The **Create Table** and **Edit Table** panels each have three views — **Columns**, **Indexes** and **SQL** — toggled at the top, so a table's indexes are one click away instead of a scroll below its columns. Columns is the form. **Indexes** edits that same table's indexes: the ones it already has — read by **Sync**, along with the tables and relationships, and stored with the design like everything else the canvas draws — are listed with their columns, uniqueness, access method (PostgreSQL) and partial-index predicate, and are editable in place — no engine can `ALTER` an index, so a change stages a `DROP INDEX` and a fresh `CREATE INDEX`, and a drop's rollback is read from the live definition before it runs. Pick the columns in the order the index should lead with; leave the name blank and one is generated from the table and those columns. An index a `PRIMARY KEY` or `UNIQUE` constraint owns is shown but not editable — it belongs to the constraint, not to a `CREATE INDEX`. SQL shows the exact DDL the form built (the `CREATE TABLE` plus its indexes, or the `ALTER` batch), editable by hand for what a form can't express — a `CHECK` constraint, an expression index, a SQLite table rebuild — and stages it verbatim. The form is the source of truth, so opening SQL always rebuilds it from the form and nothing is parsed back; switching away asks before discarding hand-written SQL. In SQL the table name comes from the statement, so renaming it there re-files the staged change. Reopening a staged `CREATE TABLE` is the one case that starts on SQL: if the statement isn't what the form would have written, the form's reading of it is lossy, and showing it would quietly drop the rest on the next save. Hovering a table on the canvas reveals two icons in its header: **focus** (a crosshair — zooms the view to that table, revealing it first if it was hidden) and **edit**. **Design export/import** (`Export → Design (JSON)`) carries the staged DDL *and* that arrangement, so a diagram moves between drafts and instances intact — the PNG/JPG/SVG exports beside it are pictures, this one comes back. A connection‑linked draft **stores the schema it draws**: the tables and relationships it shows are saved with it, and nothing re‑reads the database on its own — **Sync schema**, beside Unlink in the header, is what pulls the current tables, their indexes and their relationships in — walked a few tables at a time behind a progress dialog that says how far along it is (tables read, indexes found, and which tables it is on), because a large schema is otherwise a long wait with nothing to show for it. The dialog holds the page until the read lands and closes itself — a sync replaces the schema the canvas draws, so editing a diagram that is about to be redrawn under you is work you'd lose — and the header says how long ago that last happened, or that it never has. So a diagram opens exactly as you left it, and still draws when its database is unreachable. (A release syncs on both sides of itself: before it asks, so the confirmation is true of the schema that is there, and after it runs, since it just changed that schema.) The diagram is **not** a console tab: it has its own full‑screen page, and the console's Schema icon opens *that connection's* editor there — resuming its most recent draft, or starting a fresh canvas for it if it has none. The home area's **Schema Editor** section lists every schema draft in the workspace, each opening at its own address. Its rows also act on a draft without opening it: **delete** it (a confirmation names what goes — the target database keeps its tables, schema version and history, because a draft is DDL that hasn't run), **unlink** it from its connection, or jump to that connection's **schema version history** — a tab on the connection's own detail page (`/connections/:id/schema`), beside Access and Backup, listing every DDL commit with who ran it, its Up/Down SQL and a **Rollback** to any reversible version. It's a question about the database, so it needs no session on it; a schemaless engine (Redis) has no such tab. Unlink from a row opens the editor with the unlink question already up, so the tables it offers to carry out are on screen behind it — one implementation of the move, not two. Both are disabled on a from‑scratch row, which has no database behind it to leave or to have a history. Every draft is **attributed**: that list has a *Created by* column, searchable by name, beside how long ago the draft was last saved, and the editor's header says who saved the design last and when, with the exact start and save times on hover. So a shared diagram answers “whose is this, and who moved it?”. That section is also where a new one starts: name it, then **from a connection** to design against that database (Sync draws its tables in, staged DDL runs against them), or **from scratch** — pick a database type and get an empty canvas for a database that doesn't exist yet, exported as SQL. Either kind opens on the same schema editor page, which draws a connection-linked draft for anyone with access to that connection — no need to open the whole console. **Release** runs the staged DDL against the draft's database from there, as a **two‑step dialog**: step 1 reads the database — the same read as the Sync button, with its progress inside the dialog and the Release button disabled (“Reading schema…”) until it lands — and step 2 is the confirmation that read makes true, listing every statement in the order it will run, the down SQL resolved from the definitions it is about to overwrite, the database receiving them and when that schema was read. So the question and the evidence for it arrive in the same window, and there is no moment where Release is live over a schema nobody has checked. If that read finds the design out of step with the database — a table it stages a `CREATE` for that already exists, a column it drops that is already gone, a table it alters that isn't there any more — the dialog says so, in the words of each statement that would fail, above the SQL and while it can still be cancelled. It is a warning and not a block: which of the two is wrong is a decision, not a repair. A failed read leaves the dialog on step 1 with the reason and a **Try again**, and nothing runs — releasing without that read would run DDL against a database nobody could see. What ran is then recorded as one schema version on that connection — so a draft applies to its own database without a detour through the console. A from‑scratch design has no database yet, so Release stays disabled until you **link it to a connection** of the same engine: the design moves onto that connection, **Sync schema** draws that database's tables under the staged ones, and it releases from then on like any other draft. **Unlink** takes it back out — and offers to carry the tables it draws with it as CREATE TABLE statements, so the diagram survives becoming a from‑scratch design again. Neither direction runs anything against the database. The type picker comes from the driver registry, so a schemaless engine (Redis) never appears in it.

## Workflows

Drag‑and‑drop automation builder: `Manual`/`Schedule`/`Webhook` triggers → `Run query`, `HTTP Request`, `Run JavaScript`, `Switch`, `Loop`, `Export SQL`, `Store to Storage`. Real hourly/daily scheduling, a public **webhook** trigger URL, **folders** to organize them (drag into nested folders), JSON export/import (share or version‑control a workflow's graph — webhook tokens are stripped on export and re‑minted on import), and an **Activity** trail of past runs (every trigger). The JavaScript node has a built‑in `crypto` helper for HMAC/hash signing (e.g. signed HTTP headers). Runs can carry an input payload; query nodes inline it as `{{input.field}}`. A workflow is built inside its connection, but **Workspace → Workflow** lists every one in the workspace in a sortable, searchable table — what's scheduled, when it fires next, and how it last ran — and a row opens that workflow in its own console.

## Dashboards

Per‑connection query dashboards with dynamic `{{variables}}` (single‑ or **multi‑select** with "select all" — multi values expand to a SQL list for `IN (…)`, shown as glanceable filter chips), drag/resize grid, JSON export/import, **auto‑refresh** (10s–5m with a "last updated" indicator) and a fullscreen **kiosk mode** (auto‑hiding toolbar for wall displays). Table widgets support server‑side pagination and per‑row **action buttons** that run a workflow with the clicked row as its input. The home area's **Dashboard** section lists every dashboard in the workspace across its connections, and a row opens it in that connection's console.

## Templates

Browse built‑in dashboard/workflow templates, filtered by database type, and apply one with a click to instantly create the bundled dashboard(s) and workflow(s) on your connection — e.g. a PostgreSQL health dashboard wired to a one‑click **Vacuum** workflow.

## Backups & restore

S3‑compatible storage destinations + per‑connection scheduled backups. Calendar heatmap of runs and point‑in‑time restore — from a tracked backup version, any file browsed out of a storage destination, or a backup file uploaded from your computer. Turn on **Include connection configuration** and every run also stores the connection's JSON export (settings, folders, saved queries, workflows, dashboards — never the password) next to the dump, so a lost connection can be rebuilt with Import.

## Connection sessions

Every open connection to a database is a tracked session — see who's connected to what, and cap how many the app keeps open at once, per connection or as a workspace‑wide default. Logins are held in the metadata DB, so they survive a restart with no extra infrastructure to run. Idle connections are released automatically and reopened on demand.

## Workspaces & groups

Multi‑workspace (org/tenant) model with members, groups and email invites. Belonging to a workspace lets you *see* everything in it; *doing* anything needs a role granted on a node, and opening a database needs access on that connection (SMTP optional — always get a copyable link). Roles come in two tiers: an **instance admin** manages which workspaces exist and who runs them (and deliberately has no data access of their own), while inside a workspace people hold a **configurable role**.

## Resource tree

One hierarchy of everything on the instance, under **Browse → Resource Tree**: **Application** at the root, workspaces under it, then your own **groups**, and the connections, storage destinations, dashboards and workflows filed inside them. It's not just navigation — it's where access lives. Pick any node to see who owns it, who's been granted a role on it, and exactly what *you* can do there. On a **connection** that list is who can actually *open* it — a role granted on the workspace reaches every connection inside it, but opening one is granted per connection, so anyone holding permissions here with no way in is stated separately underneath instead of sitting in the list as if they had access. Make a group like "Production" by right‑clicking wherever it belongs in the tree, move connections into it (right‑click → **Move…**, or the move button in the node panel — the picker only offers places that can hold it and that you may file into), and grant someone a role on that group alone. Moving re‑files no *grant*: the node simply starts inheriting whatever is granted on its new parent. A group is also a set of **people**, and that's the point of filing things into one — **everyone on a group's roster can open the connections filed under it**, no per‑connection setup. So "Company A" can hold *Team Promotions* and *Team Orders*, each staffed differently, each using only its own databases; and when one person needs both, put them in a *Team Database Admin* group and list that group on each connection's **Access** tab — one row per connection covers the whole roster. Every grant made to a group reaches all of them too, so access is granted once, not per person. (Nesting a group under another only files resources; it never merges who's in them. And because placement is access, re‑filing a *connection* needs you to own or manage it, not just to be allowed to organise the tree.)

## Roles & permissions (RBAC)

Workspace access is permission‑based, not hardcoded: every route asks for a capability — manage the workspace, delete it, manage members, group rosters, notifications, storage destinations, add connections, manage all connections, transfer connection ownership, organise resources, grant access — and a role is a named set of those. Those roles are granted **on nodes of the resource tree**, so the same `Analyst` role can mean one connection for one person and a whole workspace for another; a grant either applies to just that node or cascades to everything inside it. **Owning a node means you can do anything under it.** `Owner` and `Member` ship built‑in, and a workspace always keeps at least one member who can manage it. A role can also declare *where* it may be granted, and a role granting workspace‑level powers is refused on a single connection rather than stored as a promise nothing can keep. The catalog is instance‑wide and admin‑owned — custom roles are created through the API (`/api/admin/roles`), there's no screen for it yet. Separately, **every connection has an owner**: whoever owns one can edit, back up and delete it whatever their role, and ownership can be handed to another member.

## Email (SMTP)

One mail server for the whole instance, configured by an admin under **Administration → Email** — no redeploy to change it. It sends invites, password resets and backup notifications for every workspace; workspace owners don't configure mail (they just see which server is in effect). The `SMTP_*` env vars remain the fallback underneath, so an env‑configured instance keeps working and the form pre‑fills from them. Test‑send from the same screen; the password is encrypted at rest and never sent back.

## Auth & security

First‑run setup wizard (creates the instance admin; workspaces come after), token‑based auth, two‑tier roles, and membership‑guarded connection routes. Logins are stored in the metadata DB and read through an in‑process cache, so a restart doesn't sign anyone out. Everyone manages their own account under **Setting → Account**: rename yourself and change your password (the current one is required; a change signs you out on every other device). Your email is your sign‑in identity, so only an admin can change it.

## In‑app updates

Checks GitHub for newer releases and guides admins through a safe update — backup → pre‑flight checks → apply → verify. One‑click self‑update when the Docker socket is mounted, otherwise a copyable `docker compose pull` command.

## Split view

Work on two tabs at once: split the editor **right** or **down** from the tab bar, the tab's right‑click menu or `⌘/Ctrl+\`, then drag tabs between the two groups. Each group keeps its own tab strip and its own close/close‑others menu, the divider between them is draggable, and closing the last tab in the second group folds the split away — nothing is lost, since tabs move rather than close.

## Keyboard‑first

Configurable keymap and shortcuts throughout the console.

## Theming

Light / dark theme, clean and distraction‑free.

## Redis connections

Redis is a key‑value store, not a relational database, so the console adapts: the sidebar shows a **keyspace tree** instead of a table list, and the editor tab is a **command console** rather than a SQL editor. Everything that isn't SQL‑specific still works — saved queries (commands), query history, workflows and dashboards all run against it, because the server normalizes every Redis reply into the same rows/message shape the SQL engines return. What Redis connections don't get: the schema designer, the schema‑version audit trail, row‑level grid editing, query analysis (`EXPLAIN`) and scheduled backups — none of which have a Redis equivalent.
