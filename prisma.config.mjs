/**
 * Prisma CLI config. The metadata engine is chosen by the same META_DB_TYPE the
 * app reads, so `prisma migrate …` always targets the database the app opens —
 * and each engine keeps its own schema + migration history under prisma/<engine>/,
 * because a Prisma migrations folder is locked to one provider.
 *
 * Paths and URLs come from server/config.js (the only module that reads env).
 * Run the CLI through the npm scripts so .env is loaded first.
 */
import path from 'path'
import { defineConfig } from 'prisma/config'
import { META_DATABASE_URL, META_DB_PATH, META_DB_TYPE, ROOT_DIR } from './server/config.js'

const dir = path.join(ROOT_DIR, 'prisma', META_DB_TYPE)

export default defineConfig({
  schema: path.join(dir, 'schema.prisma'),
  migrations: { path: path.join(dir, 'migrations') },
  datasource: { url: META_DB_TYPE === 'postgresql' ? META_DATABASE_URL : `file:${META_DB_PATH}` },
})
