// Public API for the domains feature: colored, named groupings assignable to a
// connection's tables (one domain per table), with a picker slide-over and a
// colored dot. Drives the sidebar's group-by-domain view and the schema-diagram
// regions.
export { default as DomainPickerPanel } from './components/DomainPickerPanel'
export { default as DomainQuickMenu } from './components/DomainQuickMenu'
export { default as DomainEditPanel } from './components/DomainEditPanel'
export { default as DomainDot } from './components/DomainDot'
export { fetchDomains, createDomain, updateDomain, deleteDomain, setTableDomain } from './lib/api'
export { DOMAIN_COLORS } from './types'
export type { Domain } from './types'
