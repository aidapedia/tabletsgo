// Public API for the schema-designer feature: the workspace-wide draft list
// plus the create-table / edit-table / column editors.
//
// `SchemaEditor` is deliberately absent — it pulls React Flow, dagre and
// html-to-image, so it stays behind a direct lazy import on the editor page
// (see SchemaDraftPage) and never lands in a chunk that only lists drafts.
export { default as WorkspaceSchemaList } from './components/WorkspaceSchemaList'
export { default as CreateTablePanel } from './components/CreateTablePanel'
export { default as TableEditPanel } from './components/TableEditPanel'
export * from './components/columnFields'
export { default as NewSchemaDialog } from './components/NewSchemaDialog'
// A connection's migration trail, for a host that has a connection but no
// console — the connection detail page's Schema history tab.
export { default as SchemaHistoryPanel } from './components/SchemaHistoryPanel'
export type { SchemaDraft, SchemaDraftDetail, SchemaEngine, WorkspaceSchemaDraft } from './types'
// The design document (layout + notes + groups) is the schema editor's other
// half — the hosts that save a draft need its type, and the design file format
// is public API for anyone importing one.
export type { SchemaDesignDoc, SchemaGroupLayout, SchemaLayout, SchemaNote, SchemaSnapshot } from './lib/design'
// A draft stores the schema it draws rather than re-reading it on every open,
// so a host that moves a design between databases has to build one (after a
// release) and drop one (on link/unlink) — see SchemaSnapshot.
export { emptyLayout, schemaSnapshot, withoutSchemaSnapshot } from './lib/design'
// Type only — ReleaseDialog itself stays behind the editor's lazy chunk, but a
// host has to name the database it will let a design be released to.
export type { ReleaseTarget } from './components/ReleaseDialog'
// Giving a from-scratch design a database is the host's flow, not the canvas's:
// it changes where the draft lives, so the page owns it.
export { default as LinkConnectionDialog } from './components/LinkConnectionDialog'
export type { LinkCandidate } from './components/LinkConnectionDialog'
export { default as UnlinkConnectionDialog } from './components/UnlinkConnectionDialog'
// Rebuilding a live table as DDL is what lets a draft leave its connection with
// its diagram intact — see UnlinkConnectionDialog.
export { buildCreateTableSql } from './lib/rollback'
