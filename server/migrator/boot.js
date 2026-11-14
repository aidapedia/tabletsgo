/**
 * Migrate on boot — imported for its side effect, as the *first* import of
 * server.js.
 *
 * It has to be first: server/meta.js opens the app's own Prisma Client the
 * moment it is evaluated, and on SQLite Prisma Migrate cannot work on a file
 * another connection holds open. ES modules evaluate their imports in order,
 * so this runs (synchronously, `prisma migrate deploy` in a child process) and
 * finishes before meta.js, or anything that imports it, is evaluated.
 *
 * With nothing pending it is a quick status read. It also resolves the mode
 * (server/mode.js) before anything asks for it. A failed run stops the boot;
 * the pre-migrate snapshot in data/backups/ has the data as it was.
 */
import { migrateAndResolveMode } from './index.js'
import { setMode } from '../mode.js'

try {
  // Then which mode the instance runs in (solo | enterprise), recorded in the
  // store so a lost env var can't change it (server/migrator/identity.js).
  setMode(migrateAndResolveMode())
} catch (e) {
  console.error(`❌ Couldn't start: ${e.message}`)
  process.exit(1)
}
