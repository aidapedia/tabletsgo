// Public API for the schema-designer feature: the workspace-wide draft list
// plus the create-table / edit-table / column editors.
//
// `SchemaEditor` is deliberately absent — it pulls React Flow, dagre and
// html-to-image, so it stays behind a direct lazy import in the console
// (see WorkspacePage) and never lands in a chunk that only lists drafts.
export { default as WorkspaceSchemaList } from './components/WorkspaceSchemaList'
export { default as CreateTablePanel } from './components/CreateTablePanel'
export { default as TableEditPanel } from './components/TableEditPanel'
export * from './components/columnFields'
export { default as NewSchemaDialog } from './components/NewSchemaDialog'
export type { SchemaDraft, SchemaDraftDetail, SchemaEngine, WorkspaceSchemaDraft } from './types'
// The design document (layout + notes + groups) is the schema editor's other
// half — the hosts that save a draft need its type, and the design file format
// is public API for anyone importing one.
export type { SchemaDesignDoc, SchemaGroupLayout, SchemaLayout, SchemaNote } from './lib/design'
