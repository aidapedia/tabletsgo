import type { Command } from '@/shared/ui/overlay/CommandPalette'
import { formatCombo } from '@/features/keymap'
import {
  CodeIcon,
  DatabaseIcon,
  DiagramIcon,
  EditIcon,
  GridIcon,
  HistoryIcon,
  KeyIcon,
  PlusIcon,
  SplitHorizontalIcon,
  SplitVerticalIcon,
  TableIcon,
  TagIcon,
  TerminalIcon,
  WandIcon,
  WorkflowIcon,
} from '@/shared/ui/icons'

type Actions = {
  newQuery: () => void
  newWorkflow: () => void
  newDashboard: () => void
  newTable: () => void
  selectPanel: (panel: string) => void
  openSchemaEditor: () => void
  switchConnection: () => void
  openHistory: () => void
  openSchemaHistory: () => void
  openChanges: () => void
  toggleSplit: (dir: 'vertical' | 'horizontal') => void
}

/**
 * The ⌘K palette's entries.
 *
 * `hint` mirrors the action's current keymap binding so the palette stays in
 * sync with user-customized shortcuts. Schema and table entries only exist for
 * the engines that have them: on Redis the palette offers the console and the
 * keyspace instead, rather than listing actions that would do nothing.
 */
export function buildConsoleCommands({
  isRedis,
  bindings,
  schemaVersion,
  splitDir,
  actions: a,
}: {
  isRedis: boolean
  bindings: any
  schemaVersion: number
  splitDir: 'vertical' | 'horizontal' | null
  actions: Actions
}): Command[] {
  const hint = (action: string) => formatCombo(bindings[action])

  return [
    isRedis
      ? { id: 'new-query', group: 'Create', label: 'New Redis console', keywords: 'command redis cli tab', icon: <TerminalIcon width={15} height={15} />, hint: hint('general.newTab'), run: a.newQuery }
      : { id: 'new-query', group: 'Create', label: 'New SQL query', keywords: 'sql add query tab', icon: <CodeIcon width={15} height={15} />, hint: hint('general.newTab'), run: a.newQuery },
    { id: 'new-workflow', group: 'Create', label: 'New workflow', keywords: 'automation flow', icon: <WorkflowIcon width={15} height={15} />, run: a.newWorkflow },
    { id: 'new-dashboard', group: 'Create', label: 'New dashboard', keywords: 'charts widgets analytics', icon: <GridIcon width={15} height={15} />, run: a.newDashboard },
    ...(isRedis
      ? []
      : [{ id: 'new-table', group: 'Create', label: 'New table', keywords: 'create table ddl', icon: <PlusIcon width={15} height={15} />, run: a.newTable }]),

    isRedis
      ? { id: 'go-browser', group: 'Navigate', label: 'Keyspace', keywords: 'keys redis browse scan', icon: <KeyIcon width={15} height={15} />, hint: hint('workspace.panelBrowser'), run: () => a.selectPanel('browser') }
      : { id: 'go-browser', group: 'Navigate', label: 'Browser', keywords: 'tables data browse', icon: <TableIcon width={15} height={15} />, hint: hint('workspace.panelBrowser'), run: () => a.selectPanel('browser') },
    { id: 'go-queries', group: 'Navigate', label: 'Saved queries', keywords: 'queries panel', icon: <CodeIcon width={15} height={15} />, hint: hint('workspace.panelQueries'), run: () => a.selectPanel('queries') },
    { id: 'go-workflows', group: 'Navigate', label: 'Workflows', keywords: 'automation', icon: <WorkflowIcon width={15} height={15} />, hint: hint('workspace.panelWorkflows'), run: () => a.selectPanel('workflows') },
    ...(isRedis
      ? []
      : [{ id: 'go-schema', group: 'Navigate', label: 'Schema editor', keywords: 'designer diagram erd', icon: <DiagramIcon width={15} height={15} />, hint: hint('workspace.panelSchema'), run: a.openSchemaEditor }]),
    { id: 'go-dashboards', group: 'Navigate', label: 'Dashboards', keywords: 'charts analytics', icon: <GridIcon width={15} height={15} />, hint: hint('workspace.panelDashboards'), run: () => a.selectPanel('dashboards') },
    { id: 'go-templates', group: 'Navigate', label: 'Templates', keywords: 'presets starter gallery scaffold', icon: <WandIcon width={15} height={15} />, run: () => a.selectPanel('templates') },
    { id: 'switch-connection', group: 'Navigate', label: 'Switch connection…', keywords: 'database change connect', icon: <DatabaseIcon width={15} height={15} />, run: a.switchConnection },

    { id: 'view-history', group: 'View', label: isRedis ? 'Command history' : 'Query history', keywords: 'recent past', icon: <HistoryIcon width={15} height={15} />, run: a.openHistory },
    ...(isRedis
      ? []
      : [{ id: 'view-schema-history', group: 'View', label: `Schema version history (v${schemaVersion})`, keywords: 'migrations audit', icon: <TagIcon width={15} height={15} />, run: a.openSchemaHistory }]),
    { id: 'view-changes', group: 'View', label: 'View staged changes', keywords: 'commit diff pending', icon: <EditIcon width={15} height={15} />, run: a.openChanges },
    { id: 'split-vertical', group: 'View', label: splitDir === 'vertical' ? 'Unsplit editor' : 'Split editor right', keywords: 'split pane side by side group', icon: <SplitVerticalIcon width={15} height={15} />, hint: hint('workspace.splitEditor'), run: () => a.toggleSplit('vertical') },
    { id: 'split-horizontal', group: 'View', label: splitDir === 'horizontal' ? 'Unsplit editor' : 'Split editor down', keywords: 'split pane stacked group', icon: <SplitHorizontalIcon width={15} height={15} />, run: () => a.toggleSplit('horizontal') },
  ]
}
