/**
 * `npm run hayat:bundle [-- --out file.json] [--admin email]` — write the
 * bundle `hayat import` loads, from the metadata database as it is now.
 * `--out -` writes it to stdout (from the image: `docker run --rm --env-file
 * tabletsgo.env <image> node scripts/hayat-bundle.js --out - > hayat-import.json`).
 *
 * On a fresh install it holds tabletsgo's contract and nothing else: importing
 * it registers tabletsgo in Hayat and prints the HAYAT_* values to configure.
 * On a database the drop migration hasn't reached yet, it holds every account,
 * workspace, group and grant (the migrator writes the same file on its own
 * right before the drop).
 *
 * On a solo instance it holds the owner, the one workspace and its connections
 * and storage destinations — the way from solo to enterprise (README → Solo and
 * enterprise). The owner finishes by signing up at Hayat with the same email.
 *
 * `--admin email` also makes that person tabletsgo's admin (and Hayat's first
 * instance admin, on a Hayat that has none) — a fresh install's first admin, who
 * finishes by signing up at Hayat with that address.
 */
import fs from 'fs'

const flag = (name) => {
  const at = process.argv.indexOf(name)
  return at > 0 ? process.argv[at + 1] || '' : ''
}
const out = flag('--out') || 'hayat-import.json'
const admin = flag('--admin')
// `--out -` writes the bundle to stdout, so a one-off container can hand it to
// the host (`docker run … > hayat-import.json`) without a volume or a file the
// host user can't read. Everything else this prints, config's notices included,
// goes to stderr — hence the imports below come after this line.
const toStdout = out === '-'
if (toStdout) console.log = console.error

const { openMeta } = await import('../server/meta-connection.js')
const { META_DB_TYPE } = await import('../server/config.js')
const { addBundleAdmin, emptyBundle, exportHayatBundle, exportSoloBundle } = await import('../server/migrator/hayat-export.js')
const { SOLO_KEY, readSetting } = await import('../server/migrator/identity.js')

let bundle
try {
  const db = openMeta()
  const hasTable = (name) =>
    META_DB_TYPE === 'postgresql'
      ? !!db.prepare('SELECT to_regclass(?) AS name').get(name).name
      : !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)
  // Accounts still in tabletsgo's own tables (pre-drop) win; else a solo owner.
  bundle = !hasTable('users') && readSetting(db, SOLO_KEY)?.owner ? exportSoloBundle(db, hasTable) : exportHayatBundle(db, hasTable)
  db.close()
} catch (e) {
  console.warn(`No metadata database to read (${e.message}); writing the contract only.`)
  bundle = emptyBundle()
}
addBundleAdmin(bundle, admin)
const json = JSON.stringify(bundle, null, 2)
if (toStdout) process.stdout.write(`${json}\n`)
else fs.writeFileSync(out, json, { mode: 0o600 })
const where = toStdout ? 'the bundle' : out
console.log(`Wrote ${where}: ${bundle.users.length} people, ${bundle.tenants.length} workspaces.`)
for (const s of bundle.skipped) console.log(`  not carried over: ${s}`)
console.log(`Next: hayat import --file ${toStdout ? 'hayat-import.json' : out} --app-url <this instance's URL> --out hayat-result.json`)
