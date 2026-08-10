import type { SchemaLayout } from './lib/design'

// A schema draft as the workspace-wide list sees it: a saved query with
// `kind = 'schema'`, plus the connection it belongs to. The console has the
// connection as context; this list has it as a column, so it carries the name
// and type the row renders.
export type WorkspaceSchemaDraft = {
  /** null for a from-scratch draft — it belongs to the workspace, not a connection. */
  connectionId: string | null
  connectionName: string | null
  /** The connection's engine, or (from scratch) the dialect the DDL targets. */
  connectionType: string
  id: string
  name: string
  ts: number
  statementCount: number
}

// One draft as the standalone editor page loads it — either kind, resolved
// through the one workspace address. `connectionId` is what the page branches
// on: with one, the diagram is drawn from that live database and Save writes
// back to its saved query; without, the canvas starts empty and `connectionType`
// is the only dialect there is.
export type SchemaDraftDetail = {
  id: string
  name: string
  sql: string
  /** The saved diagram arrangement (positions, notes, groups) — null until one is saved. */
  layout: SchemaLayout | null
  ts: number
  connectionId: string | null
  connectionName: string | null
  connectionType: string
}

// A from-scratch draft on its own: no connection, so the row carries the
// dialect and the staged DDL the standalone editor loads.
export type SchemaDraft = {
  id: string
  workspaceId: string
  name: string
  dbType: string
  sql: string
  layout: SchemaLayout | null
  createdBy: string | null
  ts: number
}

// An engine a schema can be designed for, straight from the driver registry.
export type SchemaEngine = {
  type: string
  label: string
  dataTypes: string[]
}
