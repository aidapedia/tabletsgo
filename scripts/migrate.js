/**
 * `npm run migrate` — bring the metadata database to the latest schema, then
 * exit. The app does the same on boot; this is for running it by hand, and it
 * is what the in-app updater's one-shot migrate container runs.
 *
 *   npm run migrate              apply everything pending
 *   npm run migrate -- --status  print what is applied / pending, change nothing
 */
import { metaSchemaStatus, runMigrations } from '../server/migrator/index.js'

try {
  if (process.argv.includes('--status')) {
    const { engine, state, applied, pending } = metaSchemaStatus()
    console.log(`engine:  ${engine}\nstate:   ${state}\napplied: ${applied.join(', ') || '—'}\npending: ${pending.join(', ') || '—'}`)
    process.exit(pending.length ? 2 : 0)
  }
  runMigrations()
  process.exit(0)
} catch (e) {
  console.error(`❌ Migration failed: ${e.message}`)
  process.exit(1)
}
