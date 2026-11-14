#!/bin/sh
# Hayat and tabletsgo from source, for development: no tabletsgo or Hayat image
# is pulled or built. Only Hayat's own Postgres runs in Docker (postgres:17 on
# 127.0.0.1:55432, from Hayat's `make db`).
#
#   npm run dev:hayat          # everything below; Ctrl+C stops it
#
# What runs:
#   tabletsgo console  http://localhost:5173   (vite; /api → :3000)
#   tabletsgo server   http://localhost:3000   (also serves the last `npm run build`)
#   hayat auth         http://localhost:8443   sign-in — HAYAT_ISSUER
#   hayat console      http://localhost:3001   people, workspaces, groups, grants
#   hayat api / admin  :7443 / :8080           tabletsgo's decisions / the console's API
#
# Sign in as admin@hayat.test / hayat-dev-password: Hayat's seeded instance
# admin, made tabletsgo's admin and the owner of a "Dev" workspace. The other
# seeded accounts (alice@, bob@, …) are in Acme / Globex but hold no tabletsgo
# role there until one is granted in Hayat's console. They are also in "Demo",
# with sample connections and a different kind of access each (who opens what:
# scripts/dev/demo-workspace.mjs), beside two more accounts, erin@ and frank@.
# Every password is the same. Hayat logs the mail it would send.
#
# tabletsgo is configured the one way it supports: a Hayat that runs on its
# own, named by the HAYAT_* values in .env. The first run registers tabletsgo in
# Hayat (`hayat import`) and writes those values into .env. Delete
# HAYAT_CLIENT_ID from .env to register again, e.g. after
# `make -C ../hayat db-reset`.
#
# Hayat's checkout is ../hayat; set HAYAT_DIR to use another.
set -eu

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
HAYAT_DIR=${HAYAT_DIR:-$ROOT/../hayat}
ENV_FILE=$ROOT/.env

ISSUER=http://localhost:8443
CONSOLE_URL=http://localhost:3001
APP_URL=http://localhost:5173
ADMIN_EMAIL=admin@hayat.test
DEV_WORKSPACE_ID=7ab1e75e-0de7-4000-8000-000000000001
DEMO_WORKSPACE_ID=7ab1e75e-0de7-4000-8000-000000000002

[ -f "$HAYAT_DIR/Makefile" ] || { echo "No Hayat checkout at $HAYAT_DIR (set HAYAT_DIR)." >&2; exit 1; }
HAYAT_DIR=$(cd "$HAYAT_DIR" && pwd)

# The env Hayat's Makefile gives its local runs, plus the console's address.
hayat_env() {
  export HAYAT_DATABASE_URL='postgres://hayat:hayat@127.0.0.1:55432/hayat?sslmode=disable'
  HAYAT_MASTER_KEY=$(cat "$HAYAT_DIR/.dev/master.key")
  export HAYAT_MASTER_KEY HAYAT_DEV=true HAYAT_ISSUER=$ISSUER HAYAT_CONSOLE_URL=$CONSOLE_URL
}
HAYAT_BIN=$HAYAT_DIR/.dev/bin/hayat

# Set KEY=value in .env, replacing the line if it is there.
set_env() {
  node -e '
    const fs = require("fs")
    const [file, ...pairs] = process.argv.slice(1)
    let text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""
    for (const pair of pairs) {
      const key = pair.slice(0, pair.indexOf("="))
      const line = new RegExp(`^${key}=.*$`, "m")
      text = line.test(text) ? text.replace(line, pair) : text.replace(/\n?$/, "\n") + pair + "\n"
    }
    fs.writeFileSync(file, text, { mode: 0o600 })
  ' "$ENV_FILE" "$@"
}

has_env() { [ -f "$ENV_FILE" ] && grep -Eq "^$1=.+" "$ENV_FILE"; }
get_env() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -1; }

# psql in Hayat's dev Postgres, the one `make db` started (compose project
# "compose", service "postgres"). Not `docker compose exec`: that file wants a
# .env only Hayat's Docker deploy has.
hayat_psql() {
  pg=$(docker ps -q --filter label=com.docker.compose.project=compose --filter label=com.docker.compose.service=postgres)
  [ -n "$pg" ] || { echo "Hayat's Postgres isn't running (make -C $HAYAT_DIR db)." >&2; exit 1; }
  docker exec -i "$pg" psql -U hayat -d hayat -v ON_ERROR_STOP=1 -qtA -c "$1"
}

# `hayat import` with the dev env; its report goes to $2 (it can hold a secret).
hayat_import() {
  file=$1 log=$2
  shift 2
  if ! (hayat_env && "$HAYAT_BIN" import --file "$file" "$@") > "$log" 2>&1; then
    grep -v CLIENT_SECRET "$log" >&2
    exit 1
  fi
}

# Register tabletsgo in Hayat once and write its credentials into .env.
register() {
  if has_env HAYAT_CLIENT_ID; then
    echo "tabletsgo is registered in Hayat (HAYAT_CLIENT_ID in .env)."
    return
  fi
  (cd "$ROOT" && node --env-file-if-exists=.env scripts/hayat-bundle.js --out "$TMP/bundle.json" --admin "$ADMIN_EMAIL")
  hayat_import "$TMP/bundle.json" "$TMP/import.log" --app-url "$APP_URL" --out "$TMP/result.json"
  # The report prints the client secret: keep that line out of the terminal.
  grep -v CLIENT_SECRET "$TMP/import.log"
  creds=$(node -e '
    const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))
    if (r.clientId && r.clientSecret && r.webClientId)
      console.log(["HAYAT_CLIENT_ID=" + r.clientId, "HAYAT_CLIENT_SECRET=" + r.clientSecret, "HAYAT_WEB_CLIENT_ID=" + r.webClientId].join("\n"))
  ' "$TMP/result.json")
  if [ -z "$creds" ]; then
    echo "Hayat already knew tabletsgo, so it printed no secret. Either rotate it (Hayat console → Services →" >&2
    echo "tabletsgo) and set HAYAT_CLIENT_ID / _SECRET / HAYAT_WEB_CLIENT_ID in .env, or start Hayat over" >&2
    echo "with 'make -C $HAYAT_DIR db-reset' and run this again." >&2
    exit 1
  fi
  # shellcheck disable=SC2086 # one KEY=value per line, no spaces
  set_env $creds
  echo "tabletsgo registered in Hayat; credentials written to .env."
}

# tabletsgo is opened at two addresses in development: Vite (:5173) and the
# server's built console (:3000). `hayat import` registers the web client with
# one redirect, so add both — every run, so an older registration catches up.
# Hayat has no CLI to edit a client and reads clients from its database on each
# request, so this writes the dev database directly.
allow_app_origins() {
  web=$(get_env HAYAT_WEB_CLIENT_ID)
  case "$web" in *[!A-Za-z0-9_-]*|'') echo "HAYAT_WEB_CLIENT_ID in .env looks wrong: '$web'" >&2; exit 1 ;; esac
  hayat_psql "
      UPDATE oauth_clients SET
        redirect_uris = ARRAY(SELECT DISTINCT unnest(redirect_uris ||
          ARRAY['http://localhost:5173/callback', 'http://localhost:3000/callback']) ORDER BY 1),
        post_logout_redirect_uris = ARRAY(SELECT DISTINCT unnest(post_logout_redirect_uris ||
          ARRAY['http://localhost:5173', 'http://localhost:5173/', 'http://localhost:3000', 'http://localhost:3000/']) ORDER BY 1),
        updated_at = now()
      WHERE id = '$web' RETURNING array_to_string(redirect_uris, ', ');" |
    sed -n '1s/^/tabletsgo sign-in redirects: /p' | grep . ||
    { echo "Hayat has no client $web (HAYAT_WEB_CLIENT_ID). Delete HAYAT_CLIENT_ID from .env to register again." >&2; exit 1; }
}

# Hayat's seed puts its admin in no tenant, and its tenants grant nothing of
# tabletsgo's — so the admin would sign in to no workspace. Give them "Dev", as
# its owner with Hayat's Tenant admin and Workspace owner (tabletsgo). Once:
# after that the tenant exists and this returns at the first question.
ensure_dev_workspace() {
  [ -z "$(hayat_psql "SELECT 1 FROM tenants WHERE id = '$DEV_WORKSPACE_ID'")" ] || return 0
  (cd "$ROOT" && node --input-type=module -e '
    import fs from "fs"
    import { randomUUID } from "crypto"
    import { emptyBundle } from "./server/migrator/hayat-export.js"
    const [out, email, tenantId] = process.argv.slice(1)
    const b = emptyBundle()
    // Matched to the seeded account by email; the id only links it within the bundle.
    const admin = { id: randomUUID(), email, name: "", passwordHash: "", status: "active", zoneinfo: "", admin: false }
    b.users.push(admin)
    b.tenants.push({
      id: tenantId, name: "Dev", ownerId: admin.id, members: [admin.id], groups: [], resources: [],
      grants: ["hayat.tenant-admin", "tabletsgo.owner"].map((role) => ({ on: "tenant", principal: "user:" + admin.id, role, inherit: true })),
    })
    fs.writeFileSync(out, JSON.stringify(b))
  ' "$TMP/workspace.json" "$ADMIN_EMAIL" "$DEV_WORKSPACE_ID")
  hayat_import "$TMP/workspace.json" "$TMP/workspace.log"
  echo "Workspace \"Dev\" created: $ADMIN_EMAIL owns it, with Workspace owner (tabletsgo)."
}

# "Demo": people reaching its sample connections in every way Hayat allows (an
# owner, a role on a group, a group's roster, a grant on one connection, the
# whole workspace, nobody) — the table is in scripts/dev/demo-workspace.mjs.
# tabletsgo's half (sample SQLite files, connection rows) is written first, then
# Hayat's is imported and the owners pointed at the accounts Hayat matched. Once,
# like Dev: delete the tenant in Hayat's console to have it made again.
ensure_demo_workspace() {
  [ -z "$(hayat_psql "SELECT 1 FROM tenants WHERE id = '$DEMO_WORKSPACE_ID'")" ] || return 0
  has_env ENCRYPTION_KEY || set_env "ENCRYPTION_KEY=$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
  [ -d "$ROOT/server/generated" ] || (cd "$ROOT" && npm run --silent prisma:generate >/dev/null)
  (cd "$ROOT" && node --env-file-if-exists=.env scripts/dev/demo-workspace.mjs --tenant "$DEMO_WORKSPACE_ID" --out "$TMP/demo.json")
  hayat_import "$TMP/demo.json" "$TMP/demo.log" --out "$TMP/demo-result.json"
  (cd "$ROOT" && node --env-file-if-exists=.env scripts/hayat-remap.js "$TMP/demo-result.json" >/dev/null)
  echo "Workspace \"Demo\" created: alice@ owns it; bob@, carol@, dave@, erin@ and $ADMIN_EMAIL each reach"
  echo "  its connections a different way, frank@ isn't in it. Same password for all."
}

case "${1:-}" in
  setup)
    # Docker + Postgres + master key, build, migrate, seed (once).
    make -C "$HAYAT_DIR" --no-print-directory seed
    [ -d "$HAYAT_DIR/console/node_modules" ] || (cd "$HAYAT_DIR/console" && pnpm install)

    TMP=$(mktemp -d)
    trap 'rm -rf "$TMP"' EXIT
    set_env HAYAT_ISSUER=$ISSUER HAYAT_API_URL=http://127.0.0.1:7443 HAYAT_CONSOLE_URL=$CONSOLE_URL
    register
    allow_app_origins
    ensure_dev_workspace
    ensure_demo_workspace
    ;;

  serve) # every Hayat role in one process (setup built, migrated and seeded it)
    hayat_env
    exec "$HAYAT_BIN" serve
    ;;

  console) # Hayat's console, on the port HAYAT_CONSOLE_URL names
    cd "$HAYAT_DIR/console"
    exec ./node_modules/.bin/vite --port 3001 --strictPort
    ;;

  wait) # until Hayat's sign-in answers, so tabletsgo starts against a live Hayat
    i=0
    until curl -fs "$ISSUER/.well-known/openid-configuration" >/dev/null 2>&1; do
      i=$((i + 1))
      [ $i -le 60 ] || { echo "Hayat didn't answer at $ISSUER within a minute." >&2; exit 1; }
      sleep 1
    done
    ;;

  *)
    echo "usage: $0 setup|serve|console|wait  (or just: npm run dev:hayat)" >&2
    exit 2
    ;;
esac
