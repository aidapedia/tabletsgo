<div align="center">

<img src="public/favicon.svg" width="80" height="80" alt="Tabletsgo logo" />

# Tabletsgo

**A self‑hosted, team‑friendly database console.**
Browse data, write queries, design schemas, automate workflows and back up to S3 — from one web app you run yourself.

[![Version](https://img.shields.io/badge/version-1.0.0-6FCF6A)](package.json)
[![Docker](https://img.shields.io/badge/deploy-Docker-2496ED?logo=docker&logoColor=white)](#-installation)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-checked-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)

</div>

<p align="center">
  <img src="docs/screenshots/hero-console.png" alt="Tabletsgo database console" width="880" />
</p>

## Features

- **Data browser** — spreadsheet‑style grid: filter, sort, edit inline, review staged changes before commit.
- **SQL editor** — highlighting, formatting, history, saved queries, and a command reference that shows which SQLite / PostgreSQL release each statement arrived in.
- **Kafka console** — browse topics and filter messages without joining a consumer group, produce, see a topic's messages, partitions, consumers and configs (each in its own tab), clone or clear a topic, and watch or reset consumer-group lag. Toolbar buttons for **Brokers** and **ACLs** add brokers (skew, out-of-sync replicas, runtime config edits) and ACLs (with consumer / producer / Streams-app templates), and — when the connection names them, each with its own icon-rail entry — **Schema Registry** (Avro / Protobuf / JSON Schema messages decode to JSON and can be produced from it; subjects, versions, compatibility), **Kafka Connect** (connectors, tasks, failure traces, pause / stop / restart / reset offsets) and **ksqlDB** (streams, tables, queries and a KSQL editor). Connects with SASL PLAIN / SCRAM / OAUTHBEARER / AWS_MSK_IAM and mutual TLS (PEM or PKCS#12). The **Kafka Topic Overview** template adds a dashboard of a topic's partitions — retained messages, produce rate and under-replicated tiles over a per-partition table — and the groups consuming it.
- **Schema designer** — visual ERD; stage DDL, release it in one confirmed step, roll back by version.
- **Workflows** — schedule/webhook triggers → query → HTTP → JavaScript → export.
- **Dashboards** — query widgets with variables, auto‑refresh and a kiosk mode. Table widgets can format each column (number, compact, bytes, a bar of its share, badges, a list count, a prefix or unit) and color its cells by thresholds; metric widgets can sum, count, average or measure a per-second rate of a column, with thresholds that color the widget and swap its caption as the value climbs (theme tones or any custom color).
- **Backups** — scheduled dumps to any S3‑compatible bucket, with one‑click restore.
- **Data export / import** — CSV, JSON or SQL, with a dry‑run preview.
- **SSH tunnels** — reach private databases through a bastion (plain SSH, Railway, Cloudflare Access).
- **Solo or enterprise, one image** — run it alone with nothing else (**solo**: one owner, a password, one workspace), or for a team (**enterprise**: sign-in, workspaces, groups, roles and who may open each connection come from [Hayat](https://github.com/aidapedia/hayat), the identity and access service tabletsgo shares with your other apps). Both are free; a solo instance moves to enterprise with its data.
- **Time zones** — each person picks a time zone in **Setting → Preferences**, and times across the app show in it. Values stored in your databases are shown exactly as stored.
- **Sign-in** — solo: the owner's email and password, set at first run with a code from the server's log. Enterprise: single sign-on at Hayat (OpenID Connect, authorization code + PKCE), where accounts, passwords, sign-up and sign-in methods are managed and shared by every app that uses it.
- **Modules** — the instance admin chooses which databases (PostgreSQL, MySQL, SQLite, Redis, Kafka) and features (Backups) the instance offers under **Administration → Modules**, and sets their instance-wide settings — each database's query timeout and table row limit, Kafka's read caps. Workspaces only see what's on. Turning off a database that connections still use locks those connections instead of deleting them, and notifies their owners by email.
- **Secure by default** — credentials encrypted at rest (AES‑256‑GCM); solo passwords hashed with scrypt and sessions ended at once on a password change; enterprise access tokens verified offline against Hayat's keys, every permission asked of Hayat.
- **Themes** — one per account, the same in every app you sign in to: presets, light/dark, every color (accent, content, sidebar, status), text size, density, corners, sidebar and content width, font, with a live preview and a readability check. Edited in Hayat's console (enterprise) or at Setting → Appearance (solo).
- **In‑app updates**, split view, configurable keymap.

Every feature in detail: **[docs/FEATURES.md](docs/FEATURES.md)**.

<table>
  <tr>
    <td width="33%"><img src="docs/screenshots/connections.png" alt="Connections" width="100%" /><p align="center"><sub>Connections</sub></p></td>
    <td width="33%"><img src="docs/screenshots/data-grid.png" alt="Data browser" width="100%" /><p align="center"><sub>Data browser</sub></p></td>
    <td width="33%"><img src="docs/screenshots/query-editor.png" alt="SQL editor" width="100%" /><p align="center"><sub>SQL editor</sub></p></td>
  </tr>
  <tr>
    <td width="33%"><img src="docs/screenshots/schema-designer.png" alt="Schema designer" width="100%" /><p align="center"><sub>Schema designer</sub></p></td>
    <td width="33%"><img src="docs/screenshots/workflows.png" alt="Workflows" width="100%" /><p align="center"><sub>Workflows</sub></p></td>
    <td width="33%"><img src="docs/screenshots/backups.png" alt="Backups" width="100%" /><p align="center"><sub>Backups</sub></p></td>
  </tr>
</table>

| Database | Status |
|---|:---:|
| PostgreSQL, MySQL, SQLite, Redis, Kafka | ✅ Supported |
| MariaDB, MongoDB | 🚧 Planned |

## Quick start

For one person, Tabletsgo needs nothing but Docker:

```bash
docker run -d --name tabletsgo -p 3000:3000 -v tabletsgo-data:/app/data ghcr.io/aidapedia/tabletsgo
docker logs tabletsgo     # 🔑 Solo setup: … enter this code: amber-falcon-river-stone-maple-orbit
```

Open **http://localhost:3000**, enter the setup code with your name, email and a password, and you're in. That is **solo mode**: you own the instance, you can do everything, and there is nobody else. Under **Administration → Modules** pick the databases and features it offers.

With compose instead (`docker-compose.yml` is the solo file):

```bash
git clone https://github.com/aidapedia/tabletsgo.git && cd tabletsgo
cp .env.example .env
docker compose up -d && docker compose logs tabletsgo
```

For a team, run it in **enterprise mode** against [Hayat](#enterprise-mode-hayat).

## Solo and enterprise

One codebase and one image run either way. The mode is chosen when the instance first starts and recorded in its store.

| | Solo | Enterprise |
|---|---|---|
| For | one developer | a team |
| Runs | tabletsgo alone | tabletsgo + [Hayat](https://github.com/aidapedia/hayat) |
| People | one owner, email + password | everyone Hayat lets in, signing in at Hayat (one account across your apps) |
| Workspaces | one, renamed in **Workspace → General** | Hayat tenants, with rosters and groups |
| Access | the owner can do everything | roles and grants in Hayat's console |
| Required settings | none | `ENCRYPTION_KEY` + the `HAYAT_*` values |
| Price | free | free |

**Which mode starts:** `TABLETSGO_MODE` (`solo` or `enterprise`) when set; otherwise the mode the instance recorded the first time it ran; otherwise enterprise when `HAYAT_ISSUER` is set, else solo. An instance that has run in enterprise mode never starts in solo mode, even if its `HAYAT_*` settings go missing: it refuses to start instead.

**Solo, the details:**

- **First run.** A new solo instance prints a six-word setup code to its log. Only someone who can read the log can claim it, even when the port is reachable from elsewhere.
- **Encryption key.** With `ENCRYPTION_KEY` unset, a new solo install generates one into the data volume (`/app/data/encryption.key`). Back it up with the volume, or set `ENCRYPTION_KEY` yourself to keep the key apart from the data.
- **Sessions.** Signing in gives a 15-minute access token and a 30-day refresh cookie (httpOnly, SameSite=Strict). Changing the password, or **Setting → Account → Sign out everywhere**, ends every session.
- **Forgotten password:** `docker compose exec tabletsgo npm run solo:reset-password` (or `docker exec tabletsgo npm run solo:reset-password`) prints a new one.

### Moving from solo to enterprise

Your connections, storage destinations, workspace and settings come along; you keep your id, so you keep owning everything.

1. Deploy Hayat ([its compose file](https://github.com/aidapedia/hayat/tree/main/deploy/compose)).
2. Write the import bundle from the running solo instance:
   ```bash
   docker compose exec tabletsgo npm run hayat:bundle -- --out /app/data/hayat-import.json
   docker compose cp tabletsgo:/app/data/hayat-import.json .
   ```
3. Load it into Hayat. It registers tabletsgo and prints the `HAYAT_*` values:
   ```bash
   hayat import --file hayat-import.json --app-url https://db.acme.com --out hayat-result.json
   ```
4. Put `ENCRYPTION_KEY` (copy `/app/data/encryption.key` if solo generated it) and the `HAYAT_*` values in `.env`, then restart with the overlay:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.enterprise.yml up -d
   ```
5. Sign up at Hayat with the owner's email. That account takes over your id, and with it everything you owned.

Going back from enterprise to solo isn't supported in place: export the connections you want and import them into a new solo instance.

### Enterprise mode (Hayat)

In enterprise mode tabletsgo keeps no accounts of its own. Hayat holds the people, the workspaces (Hayat *tenants*), groups, roles and grants; tabletsgo asks it. Hayat runs on its own — tabletsgo only needs its addresses and credentials in `.env`:

| Variable | What |
|---|---|
| `HAYAT_ISSUER` | Hayat's sign-in (auth role), as browsers reach it |
| `HAYAT_API_URL` | Hayat's service API (api role), reachable from this server |
| `HAYAT_CLIENT_ID` / `HAYAT_CLIENT_SECRET` | tabletsgo's service credentials in Hayat |
| `HAYAT_WEB_CLIENT_ID` | the public client the browser signs in with |
| `HAYAT_CONSOLE_URL` | optional: Hayat's console, for the "Manage in Hayat" links |
| `HAYAT_AUTH_URL` | optional: the auth role as this server reaches it, when not at `HAYAT_ISSUER` |

**Registering tabletsgo:**

```bash
# tabletsgo's contract + its first admin, written from the published image (no clone needed)
docker run --rm --env-file tabletsgo.env ghcr.io/aidapedia/tabletsgo:latest \
  node scripts/hayat-bundle.js --out - --admin you@acme.com > hayat-import.json

# hayat ships as an image: run `import` with the same settings as Hayat's other roles (here, its compose file)
docker compose -f ~/hayat/deploy/compose/docker-compose.yml run --rm --no-deps \
  --user "$(id -u):$(id -g)" -v "$PWD:/work" -w /work \
  hayat-api import --file hayat-import.json --app-url https://db.acme.com --out hayat-result.json
```

From a clone, `npm run hayat:bundle -- --out hayat-import.json --admin you@acme.com` writes the same file. `hayat import` registers tabletsgo as a service in Hayat, approves its contract, registers the browser's sign-in client (`<app-url>/callback`) and prints `HAYAT_ISSUER`, `HAYAT_CLIENT_ID`, `HAYAT_CLIENT_SECRET` and `HAYAT_WEB_CLIENT_ID`. Set those and `HAYAT_API_URL` (Hayat's api role), and optionally `HAYAT_CONSOLE_URL`. `--admin` gives that person **Tabletsgo admin** at Hayat's root (and makes them Hayat's first instance admin if it has none); someone Hayat doesn't know yet finishes by signing up with that address. Then, in Hayat's console, create a workspace (tenant), add people, and grant **Workspace owner (tabletsgo)** to whoever runs it.

If this server reaches Hayat's sign-in at a different address than browsers do — a private network, or Docker, where `localhost` is the container — set `HAYAT_AUTH_URL` to that address. Tokens still name `HAYAT_ISSUER`.

Start tabletsgo with the enterprise overlay, which sets `TABLETSGO_MODE=enterprise` and refuses to start with a `HAYAT_*` value missing:

```bash
docker compose -f docker-compose.yml -f docker-compose.enterprise.yml up -d
```

**Upgrading a v1.0 install that had its own accounts:** in enterprise mode, the first start of this version writes everything its account tables held to `data/hayat-import-<time>.json` and then drops those tables (a `pre-migrate` snapshot is taken too). Load it the same way:

```bash
hayat import --file data/hayat-import-<time>.json --app-url https://db.acme.com --out hayat-result.json
npm run hayat:remap -- hayat-result.json   # only if Hayat already had some of these email addresses
```

People keep their ids and passwords (the old hash is upgraded the first time they sign in), workspaces keep their ids, groups and rosters come along, owners become Hayat **Tenant admin** + **Workspace owner (tabletsgo)**, each connection's access list becomes **Connection user** grants, and instance admins get **Tabletsgo admin**. Google and GitHub sign-in links don't carry over — sign-in methods are Hayat's. Opening a connection is now the `tabletsgo.connection.open` permission; the **Access** tab on a connection shows who has it and links to Hayat to change it.

**Upgrading a v1.0 install to solo instead:** with one account, start it with no `HAYAT_*` set — that account becomes the owner, keeps its password and its id, and every workspace's data moves into the one solo workspace. With several accounts the start stops and says so: deploy Hayat (everyone keeps access), or set `SOLO_OWNER=<email>` to keep that person and all the data (the others lose access; the Hayat bundle written beside the data still holds them).

> Keep `ENCRYPTION_KEY` safe — losing or changing it makes saved credentials unreadable.

**Upgrading:** `docker compose pull && docker compose up -d`. The app migrates its metadata schema on startup, so a new image upgrades it the first time it runs.

**PostgreSQL instead of SQLite** for the app's own metadata: set `META_DB_TYPE=postgresql` and `META_DATABASE_URL`, then `docker compose --profile postgresql up -d`. See [docs/CONFIGURATION.md](docs/CONFIGURATION.md#postgresql-for-app-metadata).

## System requirements

**A 1 vCPU / 1 GB RAM server with Docker is enough for a team.** Enterprise mode also needs a Hayat ([its requirements](https://github.com/aidapedia/hayat)); solo needs nothing else.

| | Minimum | Recommended |
|---|---|---|
| CPU | 0.5 vCPU | 1 vCPU |
| RAM | 512 MB | 1 GB |
| Disk | 2 GB | 5 GB + backups |

Tabletsgo itself uses ~150–250 MB of RAM; the rest is for the OS and Docker. More CPU makes it faster; more RAM doesn't. Details: [docs/BENCHMARK.md](docs/BENCHMARK.md).

## Configuration

Set these in `.env`. A solo install needs none of them.

| Variable | Description |
|---|---|
| `TABLETSGO_MODE` | `solo` or `enterprise`. Unset: the recorded mode, else enterprise when `HAYAT_ISSUER` is set, else solo. |
| `ENCRYPTION_KEY` | Encrypts connection credentials at rest. **Required in enterprise mode**; a new solo install generates one if unset. |
| `SOLO_OWNER` | A v1.0 install with several accounts moving to solo: the email of the one who keeps it. |
| `HAYAT_ISSUER` / `HAYAT_API_URL` | **Enterprise, required.** Hayat's sign-in (public) and service API (internal) addresses. |
| `HAYAT_CLIENT_ID` / `HAYAT_CLIENT_SECRET` | **Enterprise, required.** Tabletsgo's service credentials in Hayat. |
| `HAYAT_WEB_CLIENT_ID` | **Enterprise, required.** The public client the browser signs in with. |
| `HAYAT_CONSOLE_URL` | Hayat's console, for the "Manage in Hayat" links. |
| `HAYAT_AUTH_URL` | Hayat's sign-in as this server reaches it, when that isn't `HAYAT_ISSUER` (Docker, private networks). |
| `PORT` | Host port (default `3000`). |
| `META_DB_TYPE` / `META_DATABASE_URL` | Metadata store: `sqlite` (default) or `postgresql` + its URL. |
| `SMTP_*` | Fallback mail server for tabletsgo's notices (admins can set one in the UI). Invites and resets are Hayat's. |
| `PUBLIC_URL` | The address people reach this instance at, e.g. `https://db.acme.com`. Set it behind a reverse proxy: emailed links use it. |

Full list: [docs/CONFIGURATION.md](docs/CONFIGURATION.md) and [`.env.example`](.env.example).

## Development

```bash
npm install
npm run dev:all     # Vite frontend + API server (runs migrations first) — solo mode unless .env sets HAYAT_*
npm test
```

**With Hayat from source** (a checkout at `../hayat`, or set `HAYAT_DIR`) — no tabletsgo or Hayat image is pulled; only Hayat's Postgres runs in Docker:

```bash
npm run dev:hayat   # Hayat (all roles + its console) + tabletsgo's server and Vite; Ctrl+C stops all
```

Open http://localhost:5173 (or the server's built console at http://localhost:3000 — both are registered sign-in redirects) and sign in as `admin@hayat.test` / `hayat-dev-password` — tabletsgo's admin and the owner of a **Dev** workspace the first run creates (Hayat's other seeded accounts are in Acme / Globex but hold no tabletsgo role until one is granted in Hayat's console). The first run also creates a **Demo** workspace with sample connections — four SQLite databases it generates under `data/samples/` (Shop, Payments service, Analytics warehouse, HR), a Postgres nobody runs (to see a failed handshake) and Kafka stack 1 (`scripts/dev/kafka/stack.sh up 1`) — and people who reach them in different ways: `alice@` owns it, `bob@` has Connection manager on the Engineering group, `carol@` is on the Backend subgroup's roster, `dave@` has a grant on one connection, `erin@` is in Analytics, `admin@` is a plain member, and `frank@` isn't in it at all. They all use the same password; the full who-opens-what table is in `scripts/dev/demo-workspace.mjs`. Hayat's console is at http://localhost:3001 and its sign-in at http://localhost:8443. The first run registers tabletsgo in Hayat and writes option **B**'s `HAYAT_*` values into `.env`. Delete `HAYAT_CLIENT_ID` from `.env` to register again, for example after `make -C ../hayat db-reset`.

Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · API: Swagger UI at `/api/docs` on any running instance ([server/openapi.yaml](server/openapi.yaml)) · Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)

## Donation

Tabletsgo is free and open source with nothing behind a paywall. If it helps you, please consider donating to fund its development.

## License

[Apache License 2.0](LICENSE)
