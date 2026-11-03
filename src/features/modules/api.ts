import { request, safeRequest } from '@/shared/api/request'

// The instance's modules — which databases and features this instance offers.
// An instance admin switches them (Admin → Modules, and the first-run wizard);
// everyone else only reads what's on. See server/module-registry.js.

export type ModuleKind = 'engine' | 'feature'

/** What any signed-in user sees: what's off, to hide it, and the settings in effect, to apply them. */
export type PublicModule = { id: string; kind: ModuleKind; label: string; enabled: boolean; settings: Record<string, number> }

/** One instance-wide setting. */
export type ModuleSetting = {
  key: string
  label: string
  help?: string
  unit?: string
  type: 'int'
  min: number
  max: number
  /** What one click of the stepper moves it by. */
  step: number
  value: number
  default: number
}

export type AdminModule = Omit<PublicModule, 'settings'> & {
  description: string
  /** Engines only: how many connections use it, across how many workspaces. */
  usage: { connections: number; workspaces: number } | null
  settings: ModuleSetting[]
}

/** A connection that keeps an engine from being turned off. */
export type BlockingConnection = { id: string; name: string; workspaceId: string | null; workspaceName: string | null; ownerName: string | null }

/** A setting goes as typed (the server checks the range); null puts it back to its default. */
export type ModulePatch = { enabled?: boolean; settings?: Record<string, number | string | null> }

export async function listModules() {
  return (await safeRequest<{ modules: PublicModule[] | null }>('/modules', { modules: null })).modules
}

export async function getAdminModules() {
  return (await request<{ modules: AdminModule[] }>('/admin/modules')).modules
}

/** Several modules at once — the wizard's single save. */
export async function updateModules(modules: Record<string, ModulePatch>) {
  return (await request<{ modules: AdminModule[] }>('/admin/modules', { method: 'PUT', body: { modules } })).modules
}

export async function updateModule(id: string, patch: ModulePatch) {
  return (await request<{ modules: AdminModule[] }>(`/admin/modules/${encodeURIComponent(id)}`, { method: 'PUT', body: patch })).modules
}

/** The connections a refused switch-off listed, or null when the error was something else. */
export const blockingConnections = (error: any): BlockingConnection[] | null =>
  error?.status === 409 && Array.isArray(error.data?.connections) ? error.data.connections : null
