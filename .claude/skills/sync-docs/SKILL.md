---
name: sync-docs
description: Keep Tabletsgo's public site — the documentation and the landing page (the aidapedia repo: apps/tabletsgo's MDX docs, product.ts, compare.ts, hero, footer, Databases page, meta tags, and Aidapedia's own Tabletsgo blurb) — in line with what this repo's code does. Lists what changed since the last sync, maps each changed file to the docs pages and landing-page facts that describe it (docs-map.mjs), runs a drift check that compares the engines the code ships with every engine list on the site (facts.mjs), and gives the site's conventions. Use this skill when the user asks to sync, update or check the docs, the landing page, the product page, the website or aidapedia; when the docs-sync-reminder hook names pages after an edit; after changing an env var, install command, compose file, mode or sign-in behaviour, the Hayat wiring, migrations, modules, a database engine, security behaviour or the API; or before a release.
---

# Sync the public site (docs + landing page)

Tabletsgo's public site lives in a different repo, **aidapedia/aidapedia**. It describes
what the code here does, so a change here that a user would see, set or run can leave
it wrong. This skill brings it back in line. The site has two parts:

- **Docs**: `apps/tabletsgo/src/content/docs/<group>/<name>.mdx`, served at `/tabletsgo/docs/<name>`.
- **Landing page**: the facts in `apps/tabletsgo/src/content/product.ts` (engines, the support
  matrix, planned engines, features, the walkthrough, install commands) and
  `compare.ts` (the comparison pages), plus sentences that repeat them: the hero, the
  footer, the Databases page intro, `index.html`'s meta description, and Aidapedia's own
  Tabletsgo blurb (`apps/aidapedia/src/content/projects.ts`, `apps/aidapedia/src/pages/HomePage.tsx`).
  `SITE_TARGETS` in [docs-map.mjs](docs-map.mjs) lists every file for each fact.

- Repo: `$TABLETSGO_DOCS_REPO`, else `../aidapedia` beside this repo.
- Marker: `apps/tabletsgo/docs-sync.json` holds the tabletsgo commit the site was last synced to.
- Map: [docs-map.mjs](docs-map.mjs) maps source files to docs pages and `site:<fact>` targets.
  The hook and the script both read it.
- Drift check: [facts.mjs](facts.mjs) compares facts that can be checked mechanically with
  the site, whatever the marker says. Today it covers the database engines:
  `server/db/index.js`'s drivers against `SUPPORTED_ENGINES`, `PLANNED_ENGINES`,
  `ENGINE_SUPPORT`'s column count, the logos, every sentence that lists the engines,
  and compare reasons that send users of a supported engine to a competitor. A change
  that shipped before the marker, as MySQL did, still shows up here.

## Steps

1. **See what changed.**
   ```bash
   node .claude/skills/sync-docs/changed.mjs            # since the marker
   node .claude/skills/sync-docs/changed.mjs --since <ref>
   ```
   It prints the commits, the docs pages and landing-page facts each change touches,
   changed `server/` / `scripts/` files the map doesn't cover, and then the drift check.
   Fix every drift line, even when nothing changed since the marker.
   `--check` runs only the drift check and exits 1 on drift. If the user only asked about
   the change you just made, use the pages the hook named, plus the drift check.

2. **Read the diff, then the page.** For each page, `git diff <since> -- <files>` here,
   then read the whole MDX page. Decide whether the change alters something the page
   says: a name, a default, a command, an error message, a step, a limit. An internal
   refactor needs no docs change. Say so and move on.

3. **Check every claim against the code before you write it.** The docs say what the
   code does, not what a commit message says it does. Look up defaults in
   `server/config.js`, compose files and `.env.example`; error text in the code that
   throws it; routes in `server/openapi.yaml`.

4. **Edit the pages** with the conventions below. A fact is usually stated in more than
   one place, so grep for it across the whole site, not only the file the map names:
   `grep -rn '<ENV_NAME, engine or phrase>' apps/tabletsgo/src apps/tabletsgo/index.html apps/aidapedia/src packages/shared/src`.
   Configuration, troubleshooting and the install guides repeat one another. The
   landing page repeats the engine list in about ten places. The drift check doesn't
   flag a two-engine list ("PostgreSQL and SQLite"), because those are often a different
   fact (the metadata store), so read those by hand.

5. **For a page with no source mapped to it**, or a new user-facing area (a new engine,
   a new install path), add the page *and* a line to `docs-map.mjs` in this repo.

6. **Verify** in the docs repo:
   ```bash
   cd ../aidapedia && npm run typecheck && npm run build
   node ../tabletsgo/.claude/skills/sync-docs/changed.mjs --check
   ```
   The build compiles every MDX page and both apps. A broken JSX tag or a missing import
   fails here. For a layout change (a grid's column count), look at the page in
   `npm run dev` (http://localhost:5173/tabletsgo).

7. **Record the sync.** After the docs match HEAD, run
   `node .claude/skills/sync-docs/changed.mjs --mark`. It writes the marker in the docs repo.
   If documented files still have uncommitted changes it warns, so commit tabletsgo first
   or mark later.

8. **Don't commit or push either repo unless the user asks.** Report each page you
   changed and why, and each page you checked and left alone.
9. **When a new kind of fact keeps drifting** and can be read from the code, add a check
   to `facts.mjs` beside `checkEngines`. If it's one sentence that is deliberately
   partial, add it to its `ALLOW` list with the reason instead.

## Landing page conventions

- **A new engine** gets: an entry in `SUPPORTED_ENGINES`, in the module registry's order
  (`id` = its logo's file name in `public/logos/`, from Devicon or Simple Icons; the
  README credits them). Give it a value in **every** `ENGINE_SUPPORT` row at the same index,
  and take it off `PLANNED_ENGINES`. Check each matrix cell against its driver in
  `server/db/<engine>.js`: `analyze` → Query analysis, `dump`/`restore` → backups,
  `tunneledHost` → SSH tunnels, `getDiagram`/`tableDdl` → schema designer. Then fix the
  roster sentences, the home grid's column count (`components/Databases.tsx`) and the
  planned grid on `DatabasesPage.tsx`.
- **compare.ts**: the `tabletsgo` column of `COMPARE_ROWS` is ours. Competitors' `values`
  and `pickThem` come from *their* sites, so change those only where Tabletsgo itself
  changed: drop "pick them if you use X" once we support X. Set `COMPARE_CHECKED` to the
  current month whenever you re-check.
- **Screenshot alt text** (`SCREENS` in `packages/shared`) describes the image as it is.
  Leave it alone unless the screenshot is retaken.
- **FEATURES / FLOW_STEPS** are short card copy. The walkthrough's terminal lines are
  the image's real boot log, so update them when the log changes.
- Don't claim what a driver doesn't do. The SQL command reference exists only for the
  dialects in `console/src/features/workspace/lib/sql-reference/`.

## Docs site conventions

- **Frontmatter:** `title`, `description` (one sentence, quoted), `keywords` (the words people
  search for that the title doesn't contain, including env var names). The introduction page
  sets `slug: ""`.
- **A new page** goes in a folder named for its sidebar group, and in
  `apps/tabletsgo/src/content/docs/index.ts` as `'group/name'` in its group's list in
  `order`, at its place. Its file name is its address.
- **Headings:** each `##` becomes an anchor (from its text) and a ⌘K search entry. When
  other pages link to a heading's anchor, write it as `<H2 id="…">` so renaming the text
  doesn't break those links. Before you rename or remove a heading, grep for `#<anchor>`.
- **Links:** internal links are `/docs/<name>` or `/docs/<name>#anchor`, never `/tabletsgo/docs/…`.
- **Components** from the docs kit work without importing: `<Callout kind>`,
  `<Steps><Step title>`, `<Cards><Card>`, `<CodeTabs><Tab label>` (each tab holds a code
  fence), `<Kbd>`, `<Params><Param name def badges>`. The kit has moved between the app
  and `packages/shared/src/docs/`. Find it with `grep -rn "export function Callout" apps packages/shared/src`
  rather than trusting a path. The badge constants (`REQ`, `SOLO`, `ENT`, `ENT_REQ`, `OPT`)
  must be imported. Copy the import line from `configure/configuration.mdx`, which already
  uses them.
- **Code fences** take a title: ```` ```dotenv title=".env" ````.
- **An env var** gets one `<Param>` on `configure/configuration`, under the group it belongs
  to. Give it badges for who reads it, a `def` when it has a default, and a link to the guide
  that explains it.
- **Voice:** short, plain sentences in the present tense. Say what Tabletsgo does and what
  the reader does, without filler or "simply". Name things the way the UI and the code do
  (Hayat *tenants* are "workspaces"; Administration → Modules). Match the surrounding page.
- **Two modes:** say which mode a fact is for. Solo is chosen at install and recorded, never
  a fallback, so the docs must never suggest it is one.
- **product.ts** text is short card copy. Change a value there only when the fact changed
  (an engine added, an install command changed, a feature added or removed).
  `INSTALL_METHODS` must match `getting-started/quick-start.mdx`.
