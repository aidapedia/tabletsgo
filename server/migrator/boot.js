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
 * With nothing pending it is a quick status read. A failed run stops the boot;
 * the pre-migrate snapshot in data/backups/ has the data as it was.
 */
import { runMigrations } from './index.js'

try {
  runMigrations()
} catch (e) {
  console.error(`❌ Migration failed: ${e.message}`)
  process.exit(1)
}
