<div align="center">

<img src="public/favicon.svg" width="80" height="80" alt="Tabletsgo logo" />

# Tabletsgo

**A self‑hosted, team‑friendly database console.**
Browse data, write queries, design schemas, automate workflows and back up to S3 — from one web app you run yourself.

[![Version](https://img.shields.io/badge/version-0.26.0-6FCF6A)](package.json)
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
- **Teams** — workspaces, groups, email invites and permission‑based roles on a resource tree.
- **Secure by default** — credentials encrypted at rest (AES‑256‑GCM), brute‑force login protection.
- **In‑app updates**, split view, configurable keymap, light/dark theme.

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
| PostgreSQL, SQLite, Redis, Kafka | ✅ Supported |
| MySQL, MariaDB, MongoDB | 🚧 Planned |

## Quick start

```bash
git clone https://github.com/aidapedia/tabletsgo.git
cd tabletsgo
cp .env.example .env
node -e "console.log('ENCRYPTION_KEY='+require('crypto').randomBytes(32).toString('hex'))" >> .env
docker compose up -d
```

Open **http://localhost:3000** and finish the setup wizard. It creates the **instance admin**, who then creates the first workspace (and names its owner) under **Administration → Workspaces**. The owner adds connections.

> Keep `ENCRYPTION_KEY` safe — losing or changing it makes saved credentials unreadable.

**Upgrading:** `docker compose pull && docker compose up -d`. The app migrates its metadata schema on startup, so a new image upgrades it the first time it runs.

**PostgreSQL instead of SQLite** for the app's own metadata: set `META_DB_TYPE=postgresql` and `META_DATABASE_URL`, then `docker compose --profile postgresql up -d`. See [docs/CONFIGURATION.md](docs/CONFIGURATION.md#postgresql-for-app-metadata).

## System requirements

**A 1 vCPU / 1 GB RAM server with Docker is enough for a team.**

| | Minimum | Recommended |
|---|---|---|
| CPU | 0.5 vCPU | 1 vCPU |
| RAM | 512 MB | 1 GB |
| Disk | 2 GB | 5 GB + backups |

Tabletsgo itself uses ~150–250 MB of RAM; the rest is for the OS and Docker. More CPU makes it faster; more RAM doesn't. Details: [docs/BENCHMARK.md](docs/BENCHMARK.md).

## Configuration

Set these in `.env`. Everything else is optional.

| Variable | Description |
|---|---|
| `ENCRYPTION_KEY` | **Required.** Encrypts connection credentials at rest. |
| `PORT` | Host port (default `3000`). |
| `META_DB_TYPE` / `META_DATABASE_URL` | Metadata store: `sqlite` (default) or `postgresql` + its URL. |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Pre‑seed the instance admin instead of using the wizard. |
| `SMTP_*` | Fallback mail server for invites and resets (admins can set one in the UI). |
| `KAFKA_READ_MAX_MESSAGES` / `_MAX_BYTES` / `_TIMEOUT_MS` | Caps on one Kafka read (defaults 500 rows / 16 MiB / 8000 ms). |

Full list: [docs/CONFIGURATION.md](docs/CONFIGURATION.md) and [`.env.example`](.env.example).

## Development

```bash
npm install
npm run dev:all     # Vite frontend + API server (runs migrations first)
npm test
```

Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · API: [BACKEND_DOCUMENTATION.MD](BACKEND_DOCUMENTATION.MD) · Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)

## Donation

Tabletsgo is free and open source with nothing behind a paywall. If it helps you, please consider donating to fund its development.

## License

[Apache License 2.0](LICENSE)
