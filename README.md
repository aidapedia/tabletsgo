<div align="center">

<img src="public/favicon.svg" width="80" height="80" alt="Tabletsgo logo" />

# Tabletsgo

**A self‑hosted, team‑friendly database console.**
Browse data, write queries, design schemas visually, automate workflows, and back up to S3 — all from one clean, keyboard‑friendly web app you run yourself.

[![Version](https://img.shields.io/badge/version-0.21.2-6FCF6A)](package.json)
[![Docker](https://img.shields.io/badge/deploy-Docker-2496ED?logo=docker&logoColor=white)](#-installation)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)

</div>

<p align="center">
  <img src="docs/screenshots/hero-console.png" alt="Tabletsgo database console" width="880" />
</p>

---

## Introduction

**Tabletsgo** is an open, self‑hosted database management platform for teams. Think of it as a modern web console that lives next to your databases: connect to a Postgres, SQLite or Redis instance, explore and edit rows in a fast data grid, run and save SQL, browse a Redis keyspace, and design your schema on a visual ERD — without leaving the browser.

It's built for **teams**, not just a single power user. Everything is organized into **workspaces** with per‑workspace members and roles, so you can share a set of connections with your team, invite people by email, and keep environments (dev / staging / prod) tidy in one place.

What makes Tabletsgo more than a query tool:

- 🎨 **Visual schema designer** — model tables and relationships on a React Flow canvas, then stage the DDL as reviewable changes.
- ⚙️ **Workflow automations** — chain nodes (schedule/webhook → query → HTTP → JavaScript → export) to automate recurring database tasks, triggered on a schedule or by an inbound webhook.
- 💾 **Scheduled backups to S3** — point a connection at any S3‑compatible bucket and let it export & upload on a schedule, with a calendar heatmap of runs and one‑click restore.
- 🔐 **Credentials encrypted at rest** — connection secrets are stored AES‑256‑GCM encrypted; the server refuses to boot without an encryption key.

Self‑hosted, single Docker image, your data stays yours.

---

## Features

| | Feature | What it does |
|---|---|---|
| 🗂️ | **Connections** | Organize databases by environment, folder, and tags. Credentials encrypted at rest. Per‑connection access control. **Connect handshakes first** — the database is probed before the console opens, and a failure tells you the likely root cause (host unreachable, wrong password, missing database, TLS mismatch…) with what to change, instead of dropping you into a broken workspace. **JSON export/import** moves a whole connection between instances — its settings plus every folder, saved query, workflow, dashboard and backup schedule, re‑wired to fresh ids on import (the password is left out unless you ask for it; schedules arrive paused). |
| 📊 | **Data browser** | Fast, spreadsheet‑style data grid — filter, multi‑column sort (click a header, Shift+click to add), edit rows inline, insert & delete, with a staged **Changes** panel before you commit. Drag (or Shift+click) across cells to select a block, then `⌘/Ctrl+C` to copy it as TSV or right‑click for copy as CSV/JSON, set NULL/EMPTY/DEFAULT, and duplicate/delete the rows it spans. |
| 📁 | **Table folders** | Group a connection's tables into colored, nestable folders (up to 3 levels) — create one inline from the Tables sidebar header, drag tables (and folders) between them, and click a folder's icon to pick its color. The schema designer clusters each folder's tables into its own region on the ERD. |
| 🧮 | **SQL editor** | CodeMirror‑powered editor with SQL highlighting, formatting, query history, and reusable **saved queries**. |
| 🔑 | **Redis keyspace & console** | On a Redis connection the sidebar becomes a **key tree** built from the `:` namespacing convention — paged with `SCAN` (never `KEYS`), filtered by a real match pattern, with per‑key type and TTL badges. Click a key to inspect its value (strings, lists, sets, sorted sets, hashes and streams, paged), set or clear its expiry, or delete it. The editor tab becomes a **command console**: every Redis command with autocomplete and argument hints, one command per line, run the whole buffer at once and see each command's reply. |
| 🎨 | **Schema designer** | Visual ERD (React Flow) to create/edit tables and columns; staged DDL with a **schema version** audit trail and best‑effort rollback SQL. |
| ⚙️ | **Workflows** | Drag‑and‑drop automation builder: `Manual`/`Schedule`/`Webhook` triggers → `Run query`, `HTTP Request`, `Run JavaScript`, `Switch`, `Loop`, `Export SQL`, `Store to Storage`. Real hourly/daily scheduling, a public **webhook** trigger URL, **folders** to organize them (drag into nested folders), JSON export/import (share or version‑control a workflow's graph — webhook tokens are stripped on export and re‑minted on import), and an **Activity** trail of past runs (every trigger). The JavaScript node has a built‑in `crypto` helper for HMAC/hash signing (e.g. signed HTTP headers). Runs can carry an input payload; query nodes inline it as `{{input.field}}`. |
| 📈 | **Dashboards** | Per‑connection query dashboards with dynamic `{{variables}}` (single‑ or **multi‑select** with "select all" — multi values expand to a SQL list for `IN (…)`, shown as glanceable filter chips), drag/resize grid, JSON export/import, **auto‑refresh** (10s–5m with a "last updated" indicator) and a fullscreen **kiosk mode** (auto‑hiding toolbar for wall displays). Table widgets support server‑side pagination and per‑row **action buttons** that run a workflow with the clicked row as its input. |
| 🧩 | **Templates** | Browse built‑in dashboard/workflow templates, filtered by database type, and apply one with a click to instantly create the bundled dashboard(s) and workflow(s) on your connection — e.g. a PostgreSQL health dashboard wired to a one‑click **Vacuum** workflow. |
| 💾 | **Backups & restore** | S3‑compatible storage destinations + per‑connection scheduled backups. Calendar heatmap of runs and point‑in‑time restore — from a tracked backup version, any file browsed out of a storage destination, or a backup file uploaded from your computer. Turn on **Include connection configuration** and every run also stores the connection's JSON export (settings, folders, saved queries, workflows, dashboards — never the password) next to the dump, so a lost connection can be rebuilt with Import. |
| 🔗 | **Connection sessions** | Every open connection to a database is a tracked session — see who's connected to what, and cap how many the app keeps open at once, per connection or as a workspace‑wide default. Logins are held in the metadata DB, so they survive a restart with no extra infrastructure to run. Idle connections are released automatically and reopened on demand. |
| 👥 | **Workspaces & teams** | Multi‑workspace (org/tenant) model with members, teams and email invites (SMTP optional — always get a copyable link). Roles come in two tiers: an **instance admin** manages which workspaces exist and who runs them (and deliberately has no data access of their own), while inside a workspace an **owner** manages members, teams and connections — any number of owners, never zero — and a **member** uses the connections they've been granted without being able to add or change one. |
| ✉️ | **Email (SMTP)** | One mail server for the whole instance, configured by an admin under **Administration → Email** — no redeploy to change it. It sends invites, password resets and backup notifications for every workspace; workspace owners don't configure mail (they just see which server is in effect). The `SMTP_*` env vars remain the fallback underneath, so an env‑configured instance keeps working and the form pre‑fills from them. Test‑send from the same screen; the password is encrypted at rest and never sent back. |
| 🔑 | **Auth & security** | First‑run setup wizard, token‑based auth, two‑tier roles, and membership‑guarded connection routes. Logins are stored in the metadata DB and read through an in‑process cache, so a restart doesn't sign anyone out. Everyone manages their own account under **Setting → Account**: rename yourself and change your password (the current one is required; a change signs you out on every other device). Your email is your sign‑in identity, so only an admin can change it. |
| ⬆️ | **In‑app updates** | Checks GitHub for newer releases and guides admins through a safe update — backup → pre‑flight checks → apply → verify. One‑click self‑update when the Docker socket is mounted, otherwise a copyable `docker compose pull` command. |
| ⌨️ | **Keyboard‑first** | Configurable keymap and shortcuts throughout the console. |
| 🌗 | **Theming** | Light / dark theme, clean and distraction‑free. |

---

## Screenshots

<table>
  <tr>
    <td width="50%">
      <img src="docs/screenshots/connections.png" alt="Connections list with environment and tag filters" width="100%" />
      <p align="center"><sub><b>Connections</b> — filter by environment, folder & tags</sub></p>
    </td>
    <td width="50%">
      <img src="docs/screenshots/data-grid.png" alt="Data grid browsing table rows" width="100%" />
      <p align="center"><sub><b>Data browser</b> — edit rows inline, stage changes</sub></p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="docs/screenshots/query-editor.png" alt="SQL query editor with results" width="100%" />
      <p align="center"><sub><b>SQL editor</b> — history & saved queries</sub></p>
    </td>
    <td width="50%">
      <img src="docs/screenshots/schema-designer.png" alt="Visual ERD schema designer" width="100%" />
      <p align="center"><sub><b>Schema designer</b> — visual ERD, staged DDL</sub></p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="docs/screenshots/workflows.png" alt="Workflow automation builder" width="100%" />
      <p align="center"><sub><b>Workflows</b> — drag-and-drop automation builder</sub></p>
    </td>
    <td width="50%">
      <img src="docs/screenshots/backups.png" alt="Backup schedule with calendar heatmap" width="100%" />
      <p align="center"><sub><b>Backups</b> — scheduled runs & calendar heatmap</sub></p>
    </td>
  </tr>
</table>


---

## Database compatibility

Tabletsgo speaks a **dialect‑agnostic** connection contract, so support grows without breaking the API.

| Database | Status |
|---|:---:|
| **PostgreSQL** | ✅ Supported |
| **SQLite** | ✅ Supported |
| **Redis** | ✅ Supported |
| MySQL | 🚧 Planned |
| MariaDB | 🚧 Planned |
| MongoDB | 🚧 Planned |

Redis is a key‑value store, not a relational database, so the console adapts: the sidebar shows a **keyspace tree** instead of a table list, and the editor tab is a **command console** rather than a SQL editor. Everything that isn't SQL‑specific still works — saved queries (commands), query history, workflows and dashboards all run against it, because the server normalizes every Redis reply into the same rows/message shape the SQL engines return. What Redis connections don't get: the schema designer, the schema‑version audit trail, row‑level grid editing, query analysis (`EXPLAIN`) and scheduled backups — none of which have a Redis equivalent.

---

## Try it in 60 seconds

The fastest way to kick the tires — one command, no external database required. Tabletsgo ships as a single Docker image with a built‑in SQLite metadata store, so there's nothing else to install.

```bash
git clone https://github.com/aidapedia/tabletsgo.git
cd tabletsgo

# 1. Create your env (generates a required encryption key)
cp .env.example .env
node -e "console.log('ENCRYPTION_KEY='+require('crypto').randomBytes(32).toString('hex'))" >> .env

# 2. Run it
docker compose up -d
```

Open **http://localhost:3000**, complete the quick **first‑run setup wizard** (create your admin + workspace), add your first connection, and start browsing. 🎉

---

## Configuration

All configuration is via environment variables (see [`.env.example`](.env.example)):

| Variable | Required | Description |
|---|:---:|---|
| `ENCRYPTION_KEY` | ✅ | AES‑256‑GCM key encrypting connection credentials at rest. The server won't start without it. **Changing/losing it makes existing credentials unreadable.** |
| `PORT` | | Host port to expose (container listens on `3000`). |
| `META_DB` | | Path to the metadata SQLite DB (default `/app/data/app.db`). |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` / `WORKSPACE_NAME` | | Optional **instance admin** pre‑seed. Leave unset to use the in‑browser setup wizard. The seeded account administers the instance and holds no workspace access, so assign the workspace an owner from Administration → Workspaces first. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` / `SMTP_SECURE` | | Optional SMTP for invite/reset emails, and the **fallback** under the mail server an admin sets in Administration → Email (which wins, and changes without a redeploy). Invites always return a copyable link even without SMTP. |
| `VITE_API_URL` | | Frontend API base, **baked at build time** (default `/api`). Set to an absolute URL only for a split frontend/backend deploy. |
| `WORKFLOW_SCHEDULER_ENABLED` | | Set `false` to disable the minutely cron tick (useful for local/CI). |
| `HANDSHAKE_TIMEOUT_MS` | | How long the pre‑flight connection handshake waits for a database before reporting a timeout (default `8000`). Raise only for databases behind a slow tunnel/VPN. |
| `SESSION_TTL_MS` / `SESSION_IDLE_TTL_MS` | | Sliding login lifetime (default 30 days) and how long an idle database connection stays open before it's released (default 15 min). |
| `MAX_SESSIONS_PER_CONNECTION` | | Instance‑wide default cap on concurrent sessions per connection (`0` = unlimited). A workspace (Workspace → General) can override it; individual connections cannot. A session tracks a database handle the process holds, so with more than one replica the cap applies per replica. |
| `LOGIN_MAX_ATTEMPTS` / `LOGIN_ATTEMPT_WINDOW_MS` / `LOGIN_LOCKOUT_MS` | | Brute‑force protection: consecutive failed sign‑ins that block an account (default `5`, `0` disables), how close together they must be (default 15 min — an older failure restarts the counter), and how long the block lasts (default `0` = until an admin unblocks it in Administration → Users). |
| `LOGIN_ADMIN_COOLDOWN_MS` | | An instance admin is never blocked indefinitely (nobody could unblock them) — they get this self‑expiring cooldown instead (default 15 min; `0` leaves admin sign‑ins unthrottled). |
| `TABLETSGO_TAG` | | Published image tag `docker compose` runs and pulls on self‑update (default `latest`). One‑click self‑update works best on a moving tag. |
| `UPDATE_IMAGE` / `UPDATE_REPO` / `UPDATE_HELPER_IMAGE` | | In‑app update checker — default to the official image/repo; override only for a fork. Mount the Docker socket (see `docker-compose.yml`) to enable one‑click self‑update via `UPDATE_HELPER_IMAGE` (default `docker:cli`); otherwise the wizard shows a manual pull command. |

---

## Donation

To stay completely free and open-source, with no feature behind the paywall and evolve the project, we need your help. If you like Tabletsgo, please consider donating to help us fund the project's future development.

---

## License

This project is licensed under the [Apache License 2.0](LICENSE).

<div align="center">
<sub>Built with ☕ and SQL. Self‑host it, own your data.</sub>
</div>
