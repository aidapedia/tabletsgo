// Public API for the table-folders feature: a connection's tables grouped by
// the generic folders tree (type='table'), each folder carrying an optional
// color. A table belongs to at most one folder; folders nest 3 levels deep.
// Drives the console sidebar's folder view and the schema-diagram regions.
// (Replaced the old "domains" feature — meta migration v5 folded every domain
// into the folders tree, keeping its id, name and color.)
export { default as TableFolderList } from './components/TableFolderList'
export { default as TableFolderPickerPanel } from './components/TableFolderPickerPanel'
export { default as TableFolderQuickMenu } from './components/TableFolderQuickMenu'
export { default as TableFolderEditPanel } from './components/TableFolderEditPanel'
export { default as FolderDot } from './components/FolderDot'
export {
  fetchTableFolders,
  createTableFolder,
  updateTableFolder,
  deleteTableFolder,
  setTableFolder,
} from './lib/api'
export { withTableAssignment } from './lib/assign'
export { folderParentPath, foldersInTreeOrder } from './lib/tree'
export { FOLDER_COLORS, MAX_TABLE_FOLDER_DEPTH } from './types'
export type { TableFolder } from './types'
