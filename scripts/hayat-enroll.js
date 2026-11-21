/**
 * `npm run hayat:enroll -- --code hye_… [--address https://db.acme.com] [--admin-email you@acme.com]`
 *
 * Enroll this instance with Hayat from a shell — the setup page's job, for an
 * install nobody opens in a browser first (and `npm run dev:hayat`). Same
 * module, same rules: the code comes from Hayat's console (Services → Enroll
 * service) or `hayat enrollment-code --service tabletsgo`; the credentials are
 * stored sealed under ENCRYPTION_KEY. A running server picks them up when Hayat
 * next refuses the ones it holds, or at its next start.
 *
 *   --address      the address people open tabletsgo at; PUBLIC_URL wins when set
 *   --admin-email  tabletsgo's admin when the code registers it (default: whoever made the code)
 *   --check        exit 0 if this instance holds credentials Hayat accepts, 1 otherwise
 *
 * From the image: docker compose exec tabletsgo node scripts/hayat-enroll.js --code hye_…
 */
// Migrate first, like server.js: meta.js opens the store when it is evaluated.
import '../server/migrator/boot.js'

const flag = (name) => {
  const at = process.argv.indexOf(name)
  return at > 0 ? process.argv[at + 1] || '' : ''
}

const hayat = await import('../server/hayat/index.js')
const enrollment = await import('../server/hayat-enrollment.js')

let status = 0
try {
  if (!hayat.enrollmentState()) {
    console.error('This instance runs in solo mode: there is no Hayat to enroll with.')
    status = 1
  } else if (process.argv.includes('--check')) {
    if (!(await enrollment.connectStored())) {
      console.log('Not enrolled with Hayat.')
      status = 1
    } else {
      try {
        await hayat.checkCredentials()
        console.log('Enrolled with Hayat; it accepts these credentials.')
      } catch (e) {
        console.log(`Enrolled, but Hayat refuses the credentials: ${e.message}`)
        status = 1
      }
    }
  } else {
    const code = flag('--code')
    if (!code) throw new Error('Give the code: --code hye_…')
    const res = await enrollment.enroll(
      { code, adminEmail: flag('--admin-email'), address: flag('--address') },
      { log: () => {} },
    )
    console.log(`${res.registered ? 'Registered tabletsgo in Hayat' : "Rotated tabletsgo's secret in Hayat"}; sign-in returns to ${res.address}.`)
    for (const w of res.warnings) console.warn(`⚠️  ${w}`)
  }
} catch (e) {
  console.error(`❌ ${e.message}`)
  status = 1
} finally {
  hayat.stopHayat()
}
process.exit(status)
