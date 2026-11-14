/**
 * `npm run hayat:bundle [-- --out file.json] [--admin email]` — write the
 * bundle `hayat import` loads, from the metadata database as it is now.
 *
 * On a fresh install it holds tabletsgo's contract and nothing else: importing
 * it registers tabletsgo in Hayat and prints the HAYAT_* values to configure.
 * On a database the drop migration hasn't reached yet, it holds every account,
 * workspace, group and grant (the migrator writes the same file on its own
 * right before the drop).
 *
 * `--admin email` also makes that person tabletsgo's admin (and Hayat's first
 * instance admin, on a Hayat that has none) — a fresh install's first admin, who
 * finishes by signing up at Hayat with that address.
 */
import fs from 'fs'
import { openMeta } from '../server/meta-connection.js'
import { META_DB_TYPE } from '../server/config.js'
import { addBundleAdmin, emptyBundle, exportHayatBundle } from '../server/migrator/hayat-export.js'

const flag = (name) => {
  const at = process.argv.indexOf(name)
  return at > 0 ? process.argv[at + 1] || '' : ''
}
const out = flag('--out') || 'hayat-import.json'
const admin = flag('--admin')

let bundle
try {
  const db = openMeta()
  const hasTable = (name) =>
    META_DB_TYPE === 'postgresql'
      ? !!db.prepare('SELECT to_regclass(?) AS name').get(name).name
      : !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)
  bundle = exportHayatBundle(db, hasTable)
  db.close()
} catch (e) {
  console.warn(`No metadata database to read (${e.message}); writing the contract only.`)
  bundle = emptyBundle()
}
addBundleAdmin(bundle, admin)
fs.writeFileSync(out, JSON.stringify(bundle, null, 2), { mode: 0o600 })
console.log(`Wrote ${out}: ${bundle.users.length} people, ${bundle.tenants.length} workspaces.`)
for (const s of bundle.skipped) console.log(`  not carried over: ${s}`)
console.log(`Next: hayat import --file ${out} --app-url <this instance's URL> --out hayat-result.json`)
