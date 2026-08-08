# Tabletsgo — single-image build: builds the frontend, then runs the
# Express API which also serves the static build on the same port.
FROM node:20-bookworm-slim

# better-sqlite3 compiles native bindings on install (python3/make/g++).
# pg_dump/pg_restore back the Postgres backup/restore. Debian's own
# postgresql-client pins to PG 15, and pg_dump refuses to dump a *newer* server
# ("aborting because of server version mismatch"), so install the current major
# (17) from the official PostgreSQL apt repo — it dumps every older server too.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ curl ca-certificates gnupg \
  && install -d /usr/share/postgresql-common/pgdg \
  && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client-17 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies (dev deps are needed to run the Vite build).
COPY package*.json ./
RUN npm install

# Frontend API base URL — baked into the static build (Vite inlines VITE_* at
# build time). Override for a split deploy where the API lives elsewhere:
#   docker build --build-arg VITE_API_URL=https://api.example.com/api .
ARG VITE_API_URL=/api
ENV VITE_API_URL=${VITE_API_URL}

# Build the frontend.
COPY . .
RUN npm run build

# Image identity, baked in so the running app can report what it is and compare
# itself against the latest published release (the in-app update checker). CI
# passes these; they default to package.json/"dev" for local builds.
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
# Persist app metadata (users, workspaces, connections, saved queries) outside the image.
ENV META_DB=/app/data/app.db
# NOTE: no default admin is baked in — a fresh instance shows the first-run
# setup wizard. Set ADMIN_USERNAME + ADMIN_PASSWORD to pre-seed the instance
# admin and skip the wizard (no workspace is created either way — the admin
# makes the first one). SMTP_* enable invite emails. UPDATE_* wire the in-app
# update checker (Docker-socket self-update). See .env.example.

EXPOSE 3000
CMD ["node", "server.js"]
