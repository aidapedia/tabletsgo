// Public API for the templates feature (built-in, read-only template catalog —
// browse and apply only, no user authoring). Browsed from the console's icon
// rail: TemplatesPanel lists them in the sidebar; picking one opens
// TemplateDetailView in a main-area tab.
export { default as TemplatesPanel } from './components/TemplatesPanel'
export { default as TemplateDetailView } from './components/TemplateDetailView'
export { TEMPLATES } from './catalog'
export { applyTemplate } from './lib/apply'
export type { ApplyResult } from './lib/apply'
export type { Template, TemplateDbType, TemplateWorkflow, TemplateDashboard } from './types'
