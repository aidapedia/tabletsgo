# syntax=docker/dockerfile:1
# Tabletsgo — one image: the Express API, which also serves the built console on
# the same port. Built in stages so the shipped image carries no compiler, no
# console source and no dev/frontend packages — only what `node server.js` runs.
#
#   toolchain → build   (all deps, Vite build of console/, Prisma clients)
#   toolchain → deps    (server production deps only, native modules compiled)
#   runtime             (slim Node + DB client tools + the two outputs above)

ARG NODE_VERSION=22

# ---------------------------------------------------------------------------
# toolchain — what compiling native modules needs. better-sqlite3 builds its
# bindings on install (python3/make/g++); pg-native builds against libpq-dev.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS toolchain
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ libpq-dev \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ---------------------------------------------------------------------------
# build — every dependency of both workspaces (dev deps run the Vite build),
# then the console bundle and the metadata store's query clients.
# ---------------------------------------------------------------------------
FROM toolchain AS build
COPY package.json package-lock.json ./
COPY console/package.json console/
RUN --mount=type=cache,target=/root/.npm npm ci

# Frontend API base URL — baked into the static build (Vite inlines VITE_* at
# build time). Override for a split deploy where the API lives elsewhere:
#   docker build --build-arg VITE_API_URL=https://api.example.com/api .
ARG VITE_API_URL=/api
ENV VITE_API_URL=${VITE_API_URL}

COPY . .
RUN npm run build
# One client per engine (META_DB_TYPE picks one at runtime) → server/generated.
RUN npm run prisma:generate

# ---------------------------------------------------------------------------
# deps — the server's production dependencies only. The console's packages
# (React, CodeMirror, …) are already bundled into console/dist, so the console
# workspace is left out entirely. `prisma` stays: the app migrates on boot.
# ---------------------------------------------------------------------------
FROM toolchain AS deps
COPY package.json package-lock.json ./
COPY console/package.json console/
RUN --mount=type=cache,target=/root/.npm \
  npm ci --omit=dev --workspaces=false --include-workspace-root

# ---------------------------------------------------------------------------
# runtime
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime

# pg_dump/pg_restore back the Postgres backup/restore. Debian's own
# postgresql-client pins to PG 15, and pg_dump refuses to dump a *newer* server
# ("aborting because of server version mismatch"), so install the current major
# (18) from the official PostgreSQL apt repo — it dumps every older server too.
# It also brings libpq5, which pg-native (PostgreSQL metadata) links against.
# mysqldump/mysql back the MySQL backup/restore; Debian's default-mysql-client is
# the MariaDB build of those tools, which also speaks to MySQL servers.
# openssl: Prisma's schema engine (the migrator) probes it to pick its build.
ADD https://www.postgresql.org/media/keys/ACCC4CF8.asc /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
RUN chmod 644 /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  && apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client-18 default-mysql-client \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Only what the server reads at runtime (see server/config.js for the paths).
COPY --from=deps  /app/node_modules ./node_modules
COPY --from=build /app/server/generated ./server/generated
COPY --from=build /app/console/dist ./console/dist
COPY package.json prisma.config.mjs server.js ./
COPY prisma ./prisma
COPY server ./server
# The updater's one-shot migrate container runs this (`npm run migrate`).
COPY scripts/migrate.js ./scripts/migrate.js

# Image identity, baked in so the running app can report what it is and compare
# itself against the latest published release (the in-app update checker). CI
# passes these; they default to package.json/"dev" for local builds. Declared
# last so a new version/sha never invalidates the cached layers above.
ARG APP_VERSION=
ARG GIT_SHA=dev
ENV APP_VERSION=${APP_VERSION}
ENV GIT_SHA=${GIT_SHA}
LABEL org.opencontainers.image.title="tabletsgo" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.source="https://github.com/aidapedia/tabletsgo"

ENV NODE_ENV=production
ENV PORT=3000
# SQLite default; set META_DB_TYPE=postgresql and META_DATABASE_URL for PostgreSQL.
ENV META_DB=/app/data/app.db
# NOTE: no admin is baked in — a fresh instance shows the first-run setup
# wizard, which creates the instance admin. SMTP_* enable invite emails. See
# .env.example.

EXPOSE 3000
# /api/health answers 200 once Express is listening (boot migrations run before
# that), so an unhealthy container is one whose HTTP server is down.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# The app migrates the metadata schema on boot (server/migrator/boot.js), so a
# new image upgrades the store the first time it starts.
CMD ["node", "server.js"]
