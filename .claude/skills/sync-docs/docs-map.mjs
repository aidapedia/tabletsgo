// Which tabletsgo source files each part of the public site describes: the docs pages and the landing page.
//
// Both live in the aidapedia repo. A docs page is named by its path under apps/tabletsgo/src/content/docs
// without `.mdx` (`install/enterprise`). A landing-page target is `site:<name>`, one of SITE_TARGETS below:
// a set of files in the aidapedia repo that state the same fact.
// Read by changed.mjs (what to re-check since the last sync) and by .claude/hooks/docs-sync-reminder.mjs
// (the nudge after an edit). One map, so the two never disagree. A new docs page, a new landing-page
// fact or a new user-facing source file goes in here.
//
// `match` is a list of repo-relative paths: an entry ending in `/` matches everything under it.

const TG = 'apps/tabletsgo'

/** The landing page's facts, each with every file in the aidapedia repo that states it. */
export const SITE_TARGETS = {
  engines: {
    what: 'which databases Tabletsgo connects to, what each supports, which are planned',
    files: [
      `${TG}/src/content/product.ts (SUPPORTED_ENGINES, ENGINE_SUPPORT, PLANNED_ENGINES)`,
      `${TG}/public/logos/<id>.svg (an engine's id is its logo's file name)`,
      `${TG}/src/components/Databases.tsx (home grid columns follow the count)`,
      `${TG}/src/pages/DatabasesPage.tsx (intro sentence, planned grid)`,
    ],
  },
  tagline: {
    what: 'the one-line "a self-hosted web console for …" with the engine list',
    files: [
      `${TG}/index.html (description + og:description)`,
      `${TG}/src/components/Hero.tsx`,
      `${TG}/src/components/SiteFooter.tsx`,
      `${TG}/src/pages/DatabasesPage.tsx`,
      `apps/aidapedia/src/content/projects.ts`,
      `apps/aidapedia/src/pages/HomePage.tsx`,
    ],
  },
  compare: {
    what: 'the Tabletsgo column of the comparison table, and each competitor\'s "pick them if" reasons',
    files: [`${TG}/src/content/compare.ts (COMPARE_ROWS, COMPETITORS[].pickTabletsgo/pickThem; bump COMPARE_CHECKED)`],
  },
  features: {
    what: 'the feature cards and the home page walkthrough',
    files: [`${TG}/src/content/product.ts (FEATURES, FLOW_STEPS)`],
  },
  install: {
    what: 'the install commands on the home page',
    files: [`${TG}/src/content/product.ts (INSTALL_METHODS — kept the same as getting-started/quick-start.mdx)`],
  },
  'repo-docs': {
    what: 'links to markdown files in the tabletsgo repo',
    files: [`${TG}/src/content/product.ts (DOCS — each path must exist on the default branch)`],
  },
  screens: {
    what: 'the screenshot gallery',
    files: [
      `packages/shared/src/content/tabletsgo.ts (SCREENS)`,
      `${TG}/public/screenshots/`,
    ],
  },
}

export const DOCS_MAP = [
  {
    match: ['server/config.js', '.env.example'],
    pages: ['configure/configuration', 'configure/reverse-proxy'],
    why: 'env vars, their defaults and which mode reads them',
  },
  {
    match: ['Dockerfile'],
    pages: ['configure/configuration', 'getting-started/requirements', 'getting-started/introduction'],
    why: 'build-time args and what the image includes',
  },
  {
    match: ['docker-compose.yml'],
    pages: ['getting-started/quick-start', 'install/solo', 'site:install', 'site:features'],
    why: 'the solo install commands',
  },
  {
    match: ['docker-compose.enterprise.yml'],
    pages: ['install/enterprise'],
    why: 'the enterprise overlay and HAYAT_* wiring',
  },
  {
    match: ['server/mode.js', 'server/migrator/identity.js'],
    pages: ['install/modes', 'install/solo-to-enterprise', 'reference/troubleshooting'],
    why: 'how an instance picks and records its mode',
  },
  {
    match: ['server/solo.js', 'server/hayat/solo-backend.js', 'scripts/solo-reset-password.js'],
    pages: ['install/solo', 'reference/security', 'reference/api', 'reference/troubleshooting', 'site:features'],
    why: 'solo sign-in, setup code, password reset, sign-in routes',
  },
  {
    match: ['server/hayat/', 'scripts/hayat-bundle.js', 'scripts/hayat-remap.js', 'server/migrator/hayat-export.js'],
    pages: ['install/enterprise', 'install/solo-to-enterprise', 'install/upgrading', 'reference/security'],
    why: 'Hayat wiring, the import bundle, remapping',
  },
  {
    match: ['server/permissions-catalog.js'],
    pages: ['install/enterprise', 'reference/security', 'site:compare'],
    why: 'permissions tabletsgo publishes to Hayat',
  },
  {
    match: ['server/migrator/', 'prisma/', 'scripts/migrate.js'],
    pages: ['install/upgrading'],
    why: 'migrations on boot and upgrade paths',
  },
  {
    match: ['server/meta-connection.js', 'server/meta.js'],
    pages: ['configure/metadata-database'],
    why: 'SQLite/PostgreSQL store and snapshots',
  },
  {
    match: ['server/mail.js', 'server/app-settings.js'],
    pages: ['configure/email'],
    why: 'the instance SMTP config',
  },
  {
    match: ['server/module-registry.js', 'server/module-settings.js'],
    pages: ['configure/modules', 'site:features', 'site:engines'],
    why: 'which engines and features can be switched',
  },
  {
    match: ['server/db/'],
    pages: ['getting-started/requirements', 'getting-started/introduction', 'configure/modules', 'site:engines', 'site:tagline', 'site:compare'],
    why: 'engines you can connect and what each supports',
  },
  {
    match: ['server/backup/', 'server/storage.js'],
    pages: ['site:engines', 'site:compare', 'site:features'],
    why: 'which engines back up, and where to',
  },
  {
    match: ['server/ssh.js', 'server/cloudflare-access.js', 'server/db/tunnel.js'],
    pages: ['site:engines', 'site:features'],
    why: 'SSH tunnels and which engines take one',
  },
  {
    match: ['server/workflow.js', 'server/data-transfer.js', 'console/src/features/dashboard/', 'console/src/features/workflow/'],
    pages: ['site:features', 'site:engines'],
    why: 'workflows, dashboards, export and import',
  },
  {
    match: ['console/src/features/workspace/lib/sql-reference/'],
    pages: ['site:features'],
    why: 'which dialects the SQL editor has a command reference for',
  },
  {
    match: ['server/crypto.js', 'server/auth.js', 'server/sessions/'],
    pages: ['reference/security', 'site:features'],
    why: 'encryption at rest, guards, sessions',
  },
  {
    match: ['server/openapi.yaml'],
    pages: ['reference/api'],
    why: 'the API reference',
  },
  {
    match: ['server/system-update.js'],
    pages: ['install/upgrading'],
    why: 'in-app updates',
  },
  {
    match: ['server/migrator/boot.js'],
    pages: ['reference/troubleshooting', 'site:features'],
    why: 'start-up errors and the boot log the walkthrough plays',
  },
  {
    match: ['README.md', 'docs/FEATURES.md'],
    pages: ['getting-started/introduction', 'site:features', 'site:tagline'],
    why: 'the repo docs the public site restates',
  },
  {
    match: ['docs/', 'CONTRIBUTING.md'],
    pages: ['site:repo-docs'],
    why: 'markdown files the landing page links to',
  },
  {
    match: ['docs/screenshots/'],
    pages: ['site:screens'],
    why: 'screenshots',
  },
]

const hits = (file, prefix) => (prefix.endsWith('/') ? file.startsWith(prefix) : file === prefix)

/** The map entries a repo-relative file belongs to. */
export const entriesFor = (file) => DOCS_MAP.filter((e) => e.match.some((p) => hits(file, p)))

/** The docs pages and site targets a list of repo-relative files touches, each with the files that touch it. */
export function pagesFor(files) {
  const pages = new Map()
  for (const file of files) {
    for (const e of entriesFor(file)) {
      for (const page of e.pages) {
        if (!pages.has(page)) pages.set(page, { files: new Set(), why: new Set() })
        pages.get(page).files.add(file)
        pages.get(page).why.add(e.why)
      }
    }
  }
  return pages
}
