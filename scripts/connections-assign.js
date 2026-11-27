/**
 * `npm run connections:assign -- --workspace <id>` — file every connection that
 * belongs to no workspace under that one, and mirror it into Hayat's tree, so
 * the people Hayat grants can open it again.
 *
 *   docker compose exec tabletsgo npm run connections:assign -- --workspace <id>
 *
 * Nobody may open a connection without a workspace (server/auth.js). The
 * migrator files them on the way to Hayat; this is for an instance that was
 * already past that step. Enterprise only: a solo instance has none. Whoever can
 * run this already holds the data volume, so it asks for nothing else.
 */
// Migrate first, like server.js: meta.js opens the store when it is evaluated.
import '../server/migrator/boot.js'
import { closeMeta, db } from '../server/meta.js'
import * as hayat from '../server/hayat/index.js'
import { connectStored } from '../server/hayat-enrollment.js'
import { unassignedConnections } from '../server/connections.js'
import { CONNECTION_TYPE, TENANT_TYPE } from '../server/permissions-catalog.js'

const at = process.argv.indexOf('--workspace')
const workspaceId = at > 0 ? String(process.argv[at + 1] || '').trim() : ''

async function main() {
  if (!workspaceId) throw new Error('usage: npm run connections:assign -- --workspace <workspace id>')
  if (!(await connectStored())) throw new Error('This instance isn’t enrolled with Hayat (or runs in solo mode, which has nothing to file).')
  if (!(await hayat.getResource(hayat.ref(TENANT_TYPE, workspaceId)))) throw new Error(`Hayat has no workspace ${workspaceId}.`)

  const rows = await unassignedConnections()
  if (!rows.length) return console.log('Nothing to file: every connection belongs to a workspace.')
  for (const c of rows) {
    // The mirror first, then the row; a row that won't save takes its mirror back.
    await hayat.upsertResource({ type: CONNECTION_TYPE, externalId: c.id, name: c.name || c.id, parent: hayat.ref(TENANT_TYPE, workspaceId), ownerId: c.owner_id || '' })
    try {
      await db().connections.update({ where: { id: c.id }, data: { workspace_id: workspaceId, updated_at: Date.now() } })
    } catch (error) {
      await hayat.deleteResource(CONNECTION_TYPE, c.id).catch(() => {})
      throw error
    }
    console.log(`✅ ${c.name || c.id} → workspace ${workspaceId}`)
  }
  console.log(`Filed ${rows.length} connection(s). Who may open them is granted in Hayat's console.`)
}

main()
  .catch((error) => {
    console.error(`❌ ${error.message}`)
    process.exitCode = 1
  })
  .finally(async () => {
    await closeMeta()
    process.exit()
  })
