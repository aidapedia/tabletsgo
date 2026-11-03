// Public API for the instance's modules — which databases and features this
// instance offers (see server/module-registry.js). `useModules().isEnabled(id)`
// is how any other feature hides what an instance admin turned off, and
// `useEngineLimits(type)` is where a console reads its query timeout and the
// table view its row limit. Admin → Modules and the first-run wizard are the
// two places that change them.
export { ModulesProvider, useModules, useEngineLimits } from './stores/ModulesContext'
export type { EngineLimits } from './stores/ModulesContext'
export { default as AdminModulesPanel } from './components/AdminModulesPanel'
export { default as ModulePicker } from './components/ModulePicker'
export { default as ModuleSettingsFields, draftOf, patchOf } from './components/ModuleSettingsFields'
export type { SettingsDraft } from './components/ModuleSettingsFields'
export type { AdminModule, ModuleKind, ModulePatch, ModuleSetting, PublicModule } from './api'
export { getAdminModules, updateModules } from './api'
