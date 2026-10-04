# Benchmark

How much machine Tabletsgo needs. Measured on 2026‑10‑02 against v0.22.0.

## Setup

- **Image:** built from this repo's `Dockerfile` (Node 20, linux/arm64), SQLite metadata store.
- **Host:** Docker Desktop on an Apple M2 (8 cores). Each run caps the container with `--memory`/`--memory-swap` and `--cpus`.
- **Workload:** a fresh instance is bootstrapped through the real API (setup → user → workspace → login → SQLite connection), then each scenario runs for 10 s with **20 concurrent clients** ([autocannon](https://github.com/mcollina/autocannon)). The connected database is a 200,000‑row SQLite table (21 MB).
- **Memory** is `docker stats` usage (excludes page cache), sampled every 250 ms.

20 clients firing back‑to‑back is far more than a team uses a console; treat these numbers as stress results, not as expected latency.

## Scenarios

| Scenario | Request |
|---|---|
| health | `GET /api/health` |
| auth API | `GET /api/connections?workspace=…` (session + permission checks + metadata reads) |
| 100 rows | `SELECT * … LIMIT 100` through `POST /api/connections/:id/query` |
| 5k rows | `SELECT * … LIMIT 5000` |
| aggregate | `GROUP BY` over all 200k rows (no index) |

## Results

Throughput in requests/s, with p99 latency in ms in brackets.

| Limit | Ready | Idle | Peak | health | auth API | 100 rows | 5k rows | aggregate | Failed |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| 2 GB · 2 CPU | 0.2 s | 169 MB | 234 MB | 8,883 | 1,244 (30) | 879 (43) | 114 (382) | 25 (6,308) | 0 |
| 1 GB · 1 CPU | 0.5 s | 158 MB | 187 MB | 7,747 | 931 (60) | 741 (61) | 104 (508) | 24 (6,328) | 0 |
| 512 MB · 1 CPU | 0.8 s | 151 MB | 206 MB | 7,364 | 880 (64) | 704 (68) | 68 (1,361) | 25 (6,218) | 0 |
| 384 MB · 1 CPU | 0.7 s | 122 MB | 176 MB | 7,062 | 840 (76) | 690 (75) | 70 (1,330) | 22 (6,972) | 0 |
| 256 MB · 1 CPU | 0.7 s | 151 MB | 206 MB | 7,017 | 840 (70) | 602 (91) | 66 (1,344) | 24 (6,528) | 0 |
| 256 MB · 0.5 CPU | 3.0 s | 151 MB | 174 MB | 3,541 | 322 (205) | 302 (188) | 27 (5,860) | 11 (8,698) | 10 |
| 192 MB · 0.5 CPU | 2.9 s | 151 MB | 178 MB | 3,567 | 291 (211) | 300 (182) | 27 (5,828) | 10 (7,771) | 12 |
| 512 MB · 0.25 CPU | 10.7 s | 151 MB | 170 MB | 567 | 36 (4,622) | 36 (4,737) | 5 (8,449) | 2 (9,089) | 48 |
| 128 MB · 0.5 CPU | — | — | — | — | — | — | — | — | OOM‑killed at boot |

"Failed" counts requests that hit autocannon's 10 s timeout. No run above 128 MB was OOM‑killed.

**Migrator:** `node scripts/migrate.js` peaks at ~187 MB on a fresh install; it completes at 160 MB and fails at 144 MB.

**Disk:** the image is 1.44 GB uncompressed (574 MB of it is `node_modules`). The SQLite metadata file was 0.4 MB after the run; backups staged to `data/backups/` add their dump size on top.

## What it means

- **Memory is flat.** The app idles at ~150–170 MB and stayed under 235 MB in every scenario. It doesn't grow with load; more memory buys nothing above ~512 MB.
- **CPU sets the speed.** 1 CPU serves ~700 small queries/s; 0.5 CPU halves that; 0.25 CPU still works but takes ~10 s to start and stalls under concurrent load.
- **Heavy queries block.** SQLite queries run synchronously in the Node process, so a slow query (the aggregate: ~45 ms each) delays every other request queued behind it. That's what the multi‑second p99s are, not a capacity limit. PostgreSQL and Redis queries run on the database server and don't block this way.
- **Not covered:** PostgreSQL as the metadata store, `pg_dump`/`pg_restore` backups (a separate process with its own memory), and result sets far larger than 5,000 rows, which are held in memory while they're serialised.
