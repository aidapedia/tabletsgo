// Curated set of app actions that can be bound to a keyboard shortcut.
// `mod` in a binding means Cmd on Mac / Ctrl elsewhere (see combo.ts).
export type ActionCategory = 'General' | 'Workspace' | 'Schema Designer' | 'Workflow'

export interface KeymapAction {
  id: string
  label: string
  category: ActionCategory
  defaultBinding: string
}

export const CATEGORIES: ActionCategory[] = ['General', 'Workspace', 'Schema Designer', 'Workflow']

// Every defaultBinding below is unique across the whole list — even actions
// that only ever appear in mutually-exclusive contexts (e.g. running a query
// vs. running a workflow) get distinct defaults so the settings screen never
// shows a conflict out of the box.
export const ACTIONS: KeymapAction[] = [
  { id: 'general.search', label: 'Open Search', category: 'General', defaultBinding: 'mod+k' },
  { id: 'general.newTab', label: 'New Query Tab', category: 'General', defaultBinding: 'mod+n' },
  { id: 'general.save', label: 'Save', category: 'General', defaultBinding: 'mod+s' },

  { id: 'workspace.runQuery', label: 'Run Query', category: 'Workspace', defaultBinding: 'mod+enter' },
  { id: 'workspace.newRow', label: 'New Row', category: 'Workspace', defaultBinding: 'mod+i' },
  { id: 'workspace.deleteSelected', label: 'Delete Selected Rows', category: 'Workspace', defaultBinding: 'mod+backspace' },
  { id: 'workspace.duplicateSelected', label: 'Duplicate Selected Rows', category: 'Workspace', defaultBinding: 'mod+d' },
  { id: 'workspace.discardEdits', label: 'Discard Changes', category: 'Workspace', defaultBinding: 'mod+shift+z' },
  { id: 'workspace.commitChanges', label: 'Commit Staged Changes', category: 'Workspace', defaultBinding: 'mod+shift+enter' },
  { id: 'workspace.exportCsv', label: 'Export Table as CSV', category: 'Workspace', defaultBinding: 'mod+shift+e' },
  { id: 'workspace.refresh', label: 'Refresh Table', category: 'Workspace', defaultBinding: 'mod+shift+r' },
  { id: 'workspace.panelBrowser', label: 'Switch to Browser Panel', category: 'Workspace', defaultBinding: 'mod+1' },
  { id: 'workspace.panelQueries', label: 'Switch to Queries Panel', category: 'Workspace', defaultBinding: 'mod+2' },
  { id: 'workspace.panelWorkflows', label: 'Switch to Workflows Panel', category: 'Workspace', defaultBinding: 'mod+3' },
  { id: 'workspace.panelSchema', label: 'Switch to Schema Panel', category: 'Workspace', defaultBinding: 'mod+4' },
  { id: 'workspace.toggleSidebar', label: 'Toggle Left Sidebar', category: 'Workspace', defaultBinding: 'mod+b' },

  { id: 'schema.createTable', label: 'New Table', category: 'Schema Designer', defaultBinding: 'mod+t' },
  { id: 'schema.autoLayout', label: 'Auto Layout', category: 'Schema Designer', defaultBinding: 'mod+shift+l' },

  { id: 'workflow.run', label: 'Run Workflow', category: 'Workflow', defaultBinding: 'mod+shift+w' },
]
