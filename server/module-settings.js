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
 * store: **an engine can't be turned off while any connection uses it** — the
 * save fails with 409 and the list of those connections. Turning a module off
 * never deletes anyone's work.
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
 * Validates the whole patch before writing any of it.
 */
export async function updateModules(patch) {
  const next = planModuleChange(patch)
  for (const m of MODULES) {
    if (m.kind !== 'engine' || !isModuleEnabled(m.id) || next.enabled[m.id] !== false) continue
    const connections = await connectionsOfType(m.id)
    if (connections.length) {
      const n = connections.length
      throw new ModuleError(
        `${m.label} can’t be turned off while ${n} ${n === 1 ? 'connection uses' : 'connections use'} it. Remove ${n === 1 ? 'it' : 'them'} first.`,
        409,
        { module: m.id, connections: await withWorkspaceNames(connections) }
      )
    }
  }
  await setSetting(KEY, next)
  setModuleState(next)
  return adminModules()
}

// An instance admin can't open workspace connections, so the blocked list says
// where each one lives and who owns it — that's who has to remove it.
async function withWorkspaceNames(connections) {
  const names = new Map()
  for (const id of new Set(connections.map((c) => c.workspaceId).filter(Boolean))) {
    names.set(id, (await getWorkspaceRow(id))?.name || null)
  }
  return connections.map((c) => ({ ...c, workspaceName: names.get(c.workspaceId) || null }))
}
