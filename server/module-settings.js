/**
 * Loading and saving the instance's module choices (see
 * server/module-registry.js for what a module is).
 *
 * Stored as one `app_settings` key, `modules`:
 *   { enabled: { [id]: boolean }, settings: { [id]: { [key]: number } } }
 * and mirrored into the registry's in-memory copy after every load and save, so
 * the rest of the server reads it synchronously.
 *
 * The one rule only this module can check, because it needs the metadata
 * store: **an engine still in use is only turned off on purpose** — without
 * `force` the save fails with 409 and the list of those connections, so the
 * admin can force it — and have their owners notified (server/module-notices.js).
 * Forced, those connections stay exactly as they are but locked: the connection guard
 * in server.js refuses everything but deleting them, and the schedulers skip
 * them. Turning a module off never deletes anyone's work.
 */

import { getSetting, setSetting } from './app-settings.js'
import { connectionsOfType, connectionUsageByType } from './connections.js'
import { getWorkspaceRow } from './workspaces.js'
import {
  MODULES,
  ModuleError,
  isModuleEnabled,
  planModuleChange,
  setModuleState,
  settingValues,
  settingsView,
} from './module-registry.js'

const KEY = 'modules'

/** Read the stored choices into the registry. Called once at boot. */
export async function loadModules() {
  setModuleState(await getSetting(KEY))
}

/**
 * What any signed-in client needs: what's off, to hide it, and the settings in
 * effect, to apply them (the console's query timeout, the table row limit):
 * [{ id, kind, label, enabled, settings: { key: value } }].
 */
export const publicModules = () =>
  MODULES.map((m) => ({ id: m.id, kind: m.kind, label: m.label, enabled: isModuleEnabled(m.id), settings: settingValues(m.id) }))

/** The Admin → Modules view: identity, state, settings and, for an engine, who uses it. */
export async function adminModules() {
  const usage = await connectionUsageByType()
  return MODULES.map((m) => ({
    id: m.id,
    kind: m.kind,
    label: m.label,
    description: m.description,
    enabled: isModuleEnabled(m.id),
    usage: m.kind === 'engine' ? usage[m.id] || { connections: 0, workspaces: 0 } : null,
    settings: settingsView(m.id),
  }))
}

/**
 * Apply `{ [id]: { enabled?, settings? } }` and return the new admin view.
 * Validates the whole patch before writing any of it. `force` turns off an
 * engine even while connections use it — they are locked, not deleted.
 */
export async function updateModules(patch, { force = false } = {}) {
  const next = planModuleChange(patch)
  for (const m of MODULES) {
    if (force || m.kind !== 'engine' || !isModuleEnabled(m.id) || next.enabled[m.id] !== false) continue
    const connections = await connectionsOfType(m.id)
    if (connections.length) {
      const n = connections.length
      throw new ModuleError(
        `${n} ${n === 1 ? 'connection uses' : 'connections use'} ${m.label}. Turn it off anyway to lock ${n === 1 ? 'it' : 'them'} — nothing is deleted.`,
        409,
        { module: m.id, connections: await withWorkspaceNames(connections) }
      )
    }
  }
  await setSetting(KEY, next)
  setModuleState(next)
  return adminModules()
}

/** The connections an engine has, with where each lives and who owns it — who to tell. */
export const moduleConnections = async (id) => withWorkspaceNames(await connectionsOfType(id))

// An instance admin can't open workspace connections, so the list says where
// each one lives and who owns it — that's who has to act on it.
async function withWorkspaceNames(connections) {
  const names = new Map()
  for (const id of new Set(connections.map((c) => c.workspaceId).filter(Boolean))) {
    names.set(id, (await getWorkspaceRow(id))?.name || null)
  }
  return connections.map((c) => ({ ...c, workspaceName: names.get(c.workspaceId) || null }))
}
