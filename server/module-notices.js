/**
 * Notifying the owners of the connections on a database an instance admin
 * turned off anyway (Admin → Modules) that those connections are now locked, by
 * email. **One email per unique recipient address**, listing every connection
 * that address owns — an owner with four connections gets one email, not four. Split from server/module-settings.js
 * because it sends mail, which sits further down the dependency order than the
 * settings store.
 */

import { moduleById, ModuleError } from './module-registry.js'
import { moduleConnections } from './module-settings.js'
import { sendModuleNoticeEmail, smtpConfig } from './mail.js'

/**
 * Connections grouped by who to notify: [{ email, ownerName, connections }].
 * Keyed on the address trimmed and lower-cased, so one mailbox is one
 * recipient however its owner's rows spell it. A connection without an owner
 * address can't be notified and is left out.
 */
export function groupByRecipient(connections) {
  const groups = new Map()
  for (const c of connections) {
    const email = String(c.ownerEmail || '').trim().toLowerCase()
    if (!email) continue
    if (!groups.has(email)) groups.set(email, { email, ownerName: c.ownerName || null, connections: [] })
    groups.get(email).connections.push(c)
  }
  return [...groups.values()]
}

/**
 * Tell each owner their connections on this engine are locked.
 * → { owners: recipients notified, connections, failed: [{ email, error }] }.
 * Throws 400 when there is nobody to notify or no mail server to do it with.
 */
export async function notifyModuleOwners(id) {
  const m = moduleById(id)
  if (!m || m.kind !== 'engine') throw new ModuleError(`No connections to notify owners about for: ${id}`)
  const connections = await moduleConnections(id)
  const recipients = groupByRecipient(connections)
  if (!recipients.length) throw new ModuleError(`No connection on ${m.label} has an owner to notify.`)
  const cfg = await smtpConfig()
  if (!cfg) throw new ModuleError('No mail server is configured — set one up in Administration → Email to notify owners.')

  const failed = []
  for (const r of recipients) {
    try {
      await sendModuleNoticeEmail(cfg, { to: r.email, moduleLabel: m.label, connections: r.connections })
    } catch (error) {
      failed.push({ email: r.email, error: error.message })
    }
  }
  return { owners: recipients.length - failed.length, connections: connections.length, failed }
}
