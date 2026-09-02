import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/features/auth'
import { useConnections, ConnectionSwitcherModal } from '@/features/connections'
import { useSettings } from '@/features/settings'
import { useKeymap, useShortcut } from '@/features/keymap'
import { RedisKeyTree } from '@/features/redis'
import CreateTablePanel from '@/features/schema-designer/components/CreateTablePanel'
import { TemplatesPanel } from '@/features/templates'
import {
  WorkflowsPanel,
  listWorkflows,
  createWorkflow,
  deleteWorkflow,
  updateWorkflow,
  sanitizeGraph,
  fetchWorkflowFolders,
  createWorkflowFolder,
  renameWorkflowFolder,
  moveWorkflowFolder,
  deleteWorkflowFolder,
} from '@/features/workflow'
import {
  DashboardsPanel,
  listDashboards,
  createDashboard,
  deleteDashboard,
  updateDashboard,
  sanitizeConfig,
  fetchDashboardFolders,
  createDashboardFolder,
  renameDashboardFolder,
  moveDashboardFolder,
  deleteDashboardFolder,
} from '@/features/dashboard'
import Button from '@/shared/ui/buttons/Button'
import ConfirmDialog from '@/shared/ui/feedback/ConfirmDialog'
import CommandPalette from '@/shared/ui/overlay/CommandPalette'
import SaveQueryPanel from '@/shared/ui/SaveQueryPanel'
import { useToast } from '@/shared/ui/feedback/Toast'
import { KeyIcon } from '@/shared/ui/icons'

import IconRail from './IconRail'
import StatusBar from './StatusBar'
import SavedQueriesPanel from './SavedQueriesPanel'
import AnalyzePanel from './AnalyzePanel'
import AnalyzeFolderPanel from './AnalyzeFolderPanel'
import ChangesPanel from './ChangesPanel'
import ConsoleSidebar from './ConsoleSidebar'
import ConsoleToolbar from './ConsoleToolbar'
import ConnectionLostModal from './ConnectionLostModal'
import EditorPanes from './EditorPanes'
import EmptyWorkspace from './EmptyWorkspace'
import ObjectBrowser from './ObjectBrowser'
import TabContent from './TabContent'
import TabContextMenu from './TabContextMenu'
import { makeFilter } from './TableView'
import { DIALECT } from '../lib/dialect'
import { buildConsoleCommands } from '../lib/consoleCommands'
import useConnectionBrowser from '../hooks/useConnectionBrowser'
import useConsoleTabs from '../hooks/useConsoleTabs'
import useQueryHistory from '../hooks/useQueryHistory'
import useResourceLibrary from '../hooks/useResourceLibrary'
import useSavedQueries from '../hooks/useSavedQueries'
import useSchemaHistory from '../hooks/useSchemaHistory'
import useStagedChanges from '../hooks/useStagedChanges'

let queryCounter = 0

const centerState = 'flex h-full flex-col items-center justify-center gap-4 text-ink-faint'

/**
 * The per-connection database console: icon rail, sidebar, tabbed editor panes
 * and status bar — the whole IDE shell for one connection.
 *
 * This component is wiring. Everything it coordinates lives in a hook (tabs and
 * splits, the live database, staged changes, each resource library) or in a
 * component (the sidebar panels, one tab's body, the toolbar), and the job here
 * is to say how they talk to each other — chiefly that every "open X" ends in a
 * tab, and that a change to the database re-reads whatever is showing it.
 */
export default function DatabaseConsole({ connectionId: id }: { connectionId: string }) {
  const navigate = useNavigate()
  // `?workflow=<id>` / `?dashboard=<id>` — a row of the workspace-wide Workflow
  // or Dashboard section landing here. The console keeps its tabs in state, so
  // these are the tabs a URL can ask for; they stay in the address so a refresh
  // reopens the same one. Neither half of the Schema section links here: the
  // diagram lives on its own page (`/schemas/:id`), and a connection's
  // migration trail is a tab on the connection's detail page — a question about
  // the database, answerable without a session on it.
  const [searchParams] = useSearchParams()
  const deepLink = searchParams.get('workflow')
  const dashboardLink = searchParams.get('dashboard')
  const { user, logout } = useAuth()
  const toast = useToast()
  const { connections, patchLocalConnection } = useConnections()
  const { queryTimeout, directExecute } = useSettings()
  const conn = connections.find((c: any) => c.id === id)
  const { bindings } = useKeymap()

  // Redis is schemaless and tableless: no tables/views/functions browser, no
  // schema designer, no table folders — the sidebar shows its keyspace instead,
  // and every write goes through the command console.
  const isRedis = conn?.type === 'redis'

  const [sidebarOpen, setSidebarOpen] = useState(false) // mobile drawer
  const [tablesVisible, setTablesVisible] = useState(true) // left panel visible
  const [panel, setPanel] = useState('browser') // 'browser' | 'queries' | 'workflows' | 'dashboards' | 'templates'
  const [paletteOpen, setPaletteOpen] = useState(false) // ⌘K command palette
  const [switcherOpen, setSwitcherOpen] = useState(false) // connection switcher modal
  const [pendingConn, setPendingConn] = useState<string | null>(null) // id awaiting switch confirmation
  const [creatingTable, setCreatingTable] = useState<any>(false)
  const [tableAction, setTableAction] = useState<any>(null) // { table, mode: 'empty' | 'delete' }
  const [analyzeSql, setAnalyzeSql] = useState<string | null>(null)
  const [analyzeFolder, setAnalyzeFolder] = useState<any>(null) // { name, queries }
  const [dataVersion, setDataVersion] = useState(0) // bump to force table reloads
  const [keyspaceVersion, setKeyspaceVersion] = useState(0) // bump to re-scan the Redis key tree
  const autoOpenedFor = useRef<string | null>(null) // connection we've already auto-opened a tab for
  // The import entries live in the sidebar panels but the hidden inputs they
  // drive are rendered up in the toolbar, so the refs are held here between them.
  const workflowFileRef = useRef<HTMLInputElement>(null)
  const dashboardFileRef = useRef<HTMLInputElement>(null)

  const tabs = useConsoleTabs({ onOpen: () => setSidebarOpen(false) })

  const browser = useConnectionBrowser(conn, {
    // First time opening this connection with no tabs yet: open a query tab.
    // Otherwise keep whatever tabs already exist. The ref guards against the
    // effect firing twice (e.g. React StrictMode in dev) and is also what a
    // deep link claims to stop an empty query tab landing on top of it.
    onReady: () => {
      if (autoOpenedFor.current === id) return
      autoOpenedFor.current = id
      if (tabs.tabs.length === 0) openQuery()
    },
  })
  const { ns, namespaces, nsConn, objects, tables, loading, connError, reconnecting, loadTables } = browser

  const changes = useStagedChanges({
    connectionId: id,
    nsConn,
    queryTimeout,
    directExecute,
    toast,
    patchLocalConnection,
    onDataChanged: () => {
      setDataVersion((v) => v + 1)
      loadTables() // pick up created/dropped tables in the sidebar
    },
    onSchemaRecorded: () => {
      if (tabs.hasTabOfKind('schemaHistory')) schemaHistory.loadSchemaHistory()
    },
  })

  const history = useQueryHistory(id, { user, isOpen: () => tabs.hasTabOfKind('history') })

  const schemaHistory = useSchemaHistory(id, nsConn, {
    toast,
    patchLocalConnection,
    onRolledBack: () => {
      setDataVersion((v) => v + 1)
      loadTables()
    },
  })

  const savedQueries = useSavedQueries(id, {
    toast,
    openTab: tabs.openTab,
    retitleTab: tabs.retitleTab,
    onSaved: () => {
      setPanel('queries')
      setTablesVisible(true)
    },
  })

  const workflows = useResourceLibrary(id, {
    kind: 'workflow',
    label: 'Workflow',
    api: { list: listWorkflows, create: createWorkflow, update: updateWorkflow, remove: deleteWorkflow },
    folderApi: {
      list: fetchWorkflowFolders,
      create: createWorkflowFolder,
      rename: renameWorkflowFolder,
      remove: deleteWorkflowFolder,
      move: moveWorkflowFolder,
    },
    payloadKey: 'graph',
    sanitize: sanitizeGraph,
    row: (w: any, folderId: any) => ({
      id: w.id,
      name: w.name,
      ts: Date.now(),
      protected: false,
      scheduleEnabled: false,
      folderId: folderId || null,
    }),
    toast,
    openTab: tabs.openTab,
    retitleTab: tabs.retitleTab,
    dropTab: tabs.dropTab,
    onLoaded: (list) => {
      // Deep link from the workspace-wide Workflow section: open that workflow
      // rather than the default query tab.
      const w = deepLink && list.find((x) => x.id === deepLink)
      if (w) {
        autoOpenedFor.current = id
        setPanel('workflows')
        workflows.open(w)
      }
    },
  })

  const dashboards = useResourceLibrary(id, {
    kind: 'dashboard',
    label: 'Dashboard',
    api: { list: listDashboards, create: createDashboard, update: updateDashboard, remove: deleteDashboard },
    folderApi: {
      list: fetchDashboardFolders,
      create: createDashboardFolder,
      rename: renameDashboardFolder,
      remove: deleteDashboardFolder,
      move: moveDashboardFolder,
    },
    payloadKey: 'config',
    sanitize: sanitizeConfig,
    row: (d: any) => ({ id: d.id, name: d.name, ts: d.ts, folderId: d.folderId ?? null }),
    toast,
    openTab: tabs.openTab,
    retitleTab: tabs.retitleTab,
    dropTab: tabs.dropTab,
    onLoaded: (list) => {
      // Same deep link as workflows above, from the Dashboard section. The two
      // requests race, so `!deepLink` — not just the auto-open claim — is what
      // makes a URL carrying both resolve the same way every time: workflow wins.
      const d = dashboardLink && !deepLink && list.find((x) => x.id === dashboardLink)
      if (d && autoOpenedFor.current !== id) {
        autoOpenedFor.current = id
        setPanel('dashboards')
        dashboards.open(d)
      }
    },
  })

  // ---- Opening things ----
  const openTable = (table: string) => tabs.openTab({ key: `table:${table}`, kind: 'table', table, title: table })

  // FK drill-down: show the referenced table filtered by column = value. Reuses
  // the table's existing tab if one is open (re-filtering it) — including when a
  // different FK points at the same table — otherwise opens a new table tab.
  const openTableFiltered = (table: string, column: string, value: any) => {
    const filters = [makeFilter(column, '=', String(value ?? ''))]
    tabs.openTab({ key: `table:${table}`, kind: 'table', table, title: table, filters }, { title: table, filters })
  }

  function openQuery(sql?: string) {
    queryCounter += 1
    const initialSql = typeof sql === 'string' ? sql : undefined
    const title = `${isRedis ? 'Console' : 'Query'} ${queryCounter}`
    tabs.openTab({ key: `query:${queryCounter}`, kind: 'query', title, sql: initialSql })
  }

  const openRedisKey = (redisKey: string) =>
    tabs.openTab({ key: `rediskey:${redisKey}`, kind: 'redisKey', redisKey, title: redisKey })

  const openSchema = (table: string) =>
    tabs.openTab({ key: `schema:${table}`, kind: 'schema', table, title: `${table} · schema` })

  const openFunction = (name: string) => tabs.openTab({ key: `function:${name}`, kind: 'function', name, title: name })

  const openHistory = () => tabs.openTab({ key: 'history', kind: 'history', title: 'Query history' })

  const openSchemaHistory = () =>
    tabs.openTab({ key: 'schema-history', kind: 'schemaHistory', title: 'Schema history' })

  // Open a template's detail in its own tab. Applying creates its workflows +
  // dashboards on this connection, then refreshes the rails.
  const openTemplate = (t: any) =>
    tabs.openTab({ key: `template:${t.id}`, kind: 'template', templateId: t.id, title: t.name })

  const onTemplateApplied = (res: any) => {
    workflows.refresh()
    dashboards.refresh()
    const d = res.dashboards[0]
    if (d) dashboards.open(d)
    else if (res.workflows[0]) workflows.open(res.workflows[0])
  }

  // The diagram is not a console tab: it lives on the Schema Editor page, which
  // draws the same live schema from per-connection routes and owns the drafts.
  // The rail entry therefore leaves the console rather than opening a panel —
  // and goes to *this connection's* editor, not the workspace-wide list: the
  // page resolves that address to the newest draft on this database, or an
  // unsaved canvas over its live tables. On a schemaless engine (Redis) there
  // is no diagram to leave for, so the rail hides the entry and this stops the
  // keyboard shortcut reaching it either.
  const openSchemaEditorPage = () => {
    if (isRedis) return
    navigate(`/schemas/connection/${id}`)
  }

  // ---- Sidebar / connection ----
  // Rail selects a panel; clicking the active one again collapses it.
  const selectPanel = (p: string) => {
    if (panel === p && tablesVisible) {
      setTablesVisible(false)
    } else {
      setPanel(p)
      setTablesVisible(true)
    }
  }

  // Toggles the left sidebar — the desktop collapse and the mobile slide-over
  // drawer both represent "is the sidebar open", so keep them in sync.
  const toggleSidebar = () => {
    setTablesVisible((v) => !v)
    setSidebarOpen((v) => !v)
  }

  const switchConnection = (cid: string) => {
    tabs.resetTabs()
    changes.setChanges([])
    autoOpenedFor.current = null
    navigate(`/connection/${cid}`)
    setSidebarOpen(false)
  }

  // Switching connections is destructive: tabs, staged changes and per-tab
  // editor state are all scoped to the current connection. Ask first, then wipe
  // that state and navigate. If there's nothing to lose, switch straight away.
  const requestConnSwitch = (cid: string) => {
    setSwitcherOpen(false)
    if (cid === id) {
      setSidebarOpen(false)
      return
    }
    if (tabs.tabs.length === 0 && changes.changes.length === 0) switchConnection(cid)
    else setPendingConn(cid)
  }

  // Esc closes the mobile slide-over sidebar drawer while it's open.
  useEffect(() => {
    if (!sidebarOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSidebarOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sidebarOpen])

  useShortcut('general.search', () => setPaletteOpen(true))
  useShortcut('general.newTab', () => openQuery())
  useShortcut('workspace.panelBrowser', () => selectPanel('browser'))
  useShortcut('workspace.panelQueries', () => selectPanel('queries'))
  useShortcut('workspace.panelWorkflows', () => selectPanel('workflows'))
  useShortcut('workspace.panelDashboards', () => selectPanel('dashboards'))
  useShortcut('workspace.panelSchema', openSchemaEditorPage)
  useShortcut('workspace.toggleSidebar', toggleSidebar)
  useShortcut('workspace.commitChanges', changes.commitChanges)
  useShortcut('workspace.splitEditor', () => tabs.toggleSplit('vertical'))
  useShortcut('workspace.focusOtherPane', () => tabs.splitDir && tabs.setFocusedPane((p) => (p === 0 ? 1 : 0)))

  if (!conn) {
    return (
      <div className={centerState}>
        <p>Connection not found.</p>
        <Button variant="primary" size="lg" onClick={() => navigate('/')}>
          Back to connections
        </Button>
      </div>
    )
  }

  const { current } = tabs
  const schemaVersion = conn.schemaVersion ?? 1

  const commands = buildConsoleCommands({
    isRedis,
    bindings,
    schemaVersion,
    splitDir: tabs.splitDir,
    actions: {
      newQuery: () => openQuery(),
      newWorkflow: () => workflows.create(),
      newDashboard: () => dashboards.create(),
      newTable: () => setCreatingTable(true),
      selectPanel,
      openSchemaEditor: openSchemaEditorPage,
      switchConnection: () => setSwitcherOpen(true),
      openHistory,
      openSchemaHistory,
      openChanges: () => changes.setChangesOpen(true),
      toggleSplit: tabs.toggleSplit,
    },
  })

  const sidebarPanel =
    panel === 'browser' && isRedis ? (
      <RedisKeyTree
        key={`${id}:${ns.database}:${keyspaceVersion}`}
        conn={nsConn}
        activeKey={current?.kind === 'redisKey' ? current.redisKey : null}
        onOpenKey={openRedisKey}
        onRunCommand={openQuery}
      />
    ) : panel === 'browser' ? (
      <ObjectBrowser
        connectionId={id}
        objects={objects}
        loading={loading}
        onScreen={tabs.onScreen}
        toast={toast}
        onRefresh={loadTables}
        onOpenTable={openTable}
        onOpenSchema={openSchema}
        onOpenFunction={openFunction}
        onOpenQuery={openQuery}
        onEditTable={(table) => setCreatingTable({ table })}
        onTableAction={setTableAction}
        onCreateTable={() => setCreatingTable(true)}
      />
    ) : panel === 'workflows' ? (
      <WorkflowsPanel
        workflows={workflows.items}
        folders={workflows.folders}
        activeId={current?.kind === 'workflow' ? current.workflowId : null}
        onOpen={workflows.open}
        onNew={workflows.create}
        onImport={() => workflowFileRef.current?.click()}
        onRename={workflows.rename}
        onDelete={workflows.remove}
        onCreateFolder={workflows.addFolder}
        onRenameFolder={workflows.renameFolderById}
        onDeleteFolder={workflows.removeFolder}
        onMoveToFolder={workflows.moveToFolder}
        onMoveFolder={workflows.moveFolderToParent}
        onRefresh={workflows.refresh}
      />
    ) : panel === 'dashboards' ? (
      <DashboardsPanel
        dashboards={dashboards.items}
        folders={dashboards.folders}
        activeId={current?.kind === 'dashboard' ? current.dashboardId : null}
        onOpen={dashboards.open}
        onNew={dashboards.create}
        onImport={() => dashboardFileRef.current?.click()}
        onRename={dashboards.rename}
        onDelete={dashboards.remove}
        onCreateFolder={dashboards.addFolder}
        onRenameFolder={dashboards.renameFolderById}
        onDeleteFolder={dashboards.removeFolder}
        onMoveToFolder={dashboards.moveToFolder}
        onMoveFolder={dashboards.moveFolderToParent}
        onRefresh={dashboards.refresh}
      />
    ) : panel === 'templates' ? (
      <TemplatesPanel
        dbType={conn.type}
        activeId={current?.kind === 'template' ? current.templateId : null}
        onOpen={openTemplate}
      />
    ) : (
      <SavedQueriesPanel
        saved={savedQueries.saved.filter((s: any) => s.kind !== 'schema')}
        folders={savedQueries.folders}
        onOpenSaved={savedQueries.openSavedQuery}
        onAnalyzeSaved={(s: any) => setAnalyzeSql(s.sql)}
        onAnalyzeFolder={(f: any, queries: any) => setAnalyzeFolder({ name: f.name, queries })}
        onRenameSaved={savedQueries.renameSavedQuery}
        onDeleteSaved={savedQueries.removeSaved}
        onCreateFolder={savedQueries.addFolder}
        onRenameFolder={savedQueries.renameFolderById}
        onDeleteFolder={savedQueries.removeFolder}
        onMoveToFolder={savedQueries.moveSavedToFolder}
        onMoveFolder={savedQueries.moveFolderToParent}
        onNew={() => openQuery()}
        onRefresh={savedQueries.refresh}
      />
    )

  return (
    <div className="flex h-screen bg-bg">
      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 hidden bg-black/50 max-[720px]:block"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Left region: icon rail + sidebar (slide-over drawer on mobile) */}
      <div
        className={`z-40 flex shrink-0 max-[720px]:fixed max-[720px]:inset-y-0 max-[720px]:left-0 max-[720px]:transition-transform max-[720px]:duration-200 ${
          sidebarOpen ? 'max-[720px]:translate-x-0' : 'max-[720px]:-translate-x-full'
        }`}
      >
        <IconRail
          user={user}
          connections={connections}
          currentId={id}
          onBrowseConnections={() => setSwitcherOpen(true)}
          active={tablesVisible ? panel : ''}
          onBrowser={() => selectPanel('browser')}
          onQueries={() => selectPanel('queries')}
          onWorkflows={() => selectPanel('workflows')}
          onDashboards={() => selectPanel('dashboards')}
          onTemplates={() => selectPanel('templates')}
          onHome={() => navigate('/')}
          onLogout={logout}
          browserIcon={isRedis ? KeyIcon : undefined}
          browserLabel={isRedis ? 'Keyspace' : undefined}
        />
        <ConsoleSidebar
          isRedis={isRedis}
          ns={ns}
          namespaces={namespaces}
          onDatabaseChange={browser.changeDatabase}
          onSchemaChange={browser.changeSchema}
          visible={tablesVisible}
        >
          {sidebarPanel}
        </ConsoleSidebar>
      </div>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ConsoleToolbar
          isRedis={isRedis}
          bindings={bindings}
          schemaVersion={schemaVersion}
          changeCount={changes.changes.length}
          onOpenDrawer={() => setSidebarOpen(true)}
          onCreateTable={() => setCreatingTable(true)}
          onNewQuery={() => openQuery()}
          onNewWorkflow={() => workflows.create()}
          onNewDashboard={() => dashboards.create()}
          onOpenPalette={() => setPaletteOpen(true)}
          onOpenHistory={openHistory}
          onOpenSchemaEditor={openSchemaEditorPage}
          onOpenSchemaHistory={openSchemaHistory}
          onOpenChanges={() => changes.setChangesOpen(true)}
          filePickers={
            <>
              <input
                ref={dashboardFileRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) dashboards.importFile(f)
                  e.target.value = ''
                }}
              />
              <input
                ref={workflowFileRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) workflows.importFile(f)
                  e.target.value = ''
                }}
              />
            </>
          }
        />

        <EditorPanes
          tabs={tabs}
          isRedis={isRedis}
          onNewQuery={() => openQuery()}
          empty={
            <EmptyWorkspace
              isRedis={isRedis}
              tables={tables}
              bindings={bindings}
              onNewQuery={() => openQuery()}
              onBrowseTables={() => tables[0] && openTable(tables[0])}
              onOpenHistory={openHistory}
            />
          }
          renderContent={(t) => (
            <TabContent
              tab={t}
              conn={conn}
              nsConn={nsConn}
              connectionId={id}
              isRedis={isRedis}
              dataVersion={dataVersion}
              keyspaceVersion={keyspaceVersion}
              queryState={tabs.queryState}
              history={{
                list: history.history,
                loading: history.historyLoading,
                onRefresh: history.loadHistory,
                onClear: history.clearHistoryAll,
                onDelete: history.deleteHistoryEntries,
              }}
              schemaHistory={{
                migrations: schemaHistory.schemaMigrations,
                loading: schemaHistory.schemaHistoryLoading,
                onRefresh: schemaHistory.loadSchemaHistory,
                onRollback: schemaHistory.setRollbackTarget,
              }}
              onStage={changes.addChange}
              onOpenReference={openTableFiltered}
              onFiltersChange={tabs.setTabFilters}
              onPersist={tabs.persistQueryState}
              onRan={history.recordRun}
              onSaveQuery={savedQueries.saveQuery}
              onAnalyze={setAnalyzeSql}
              onNewQuery={openQuery}
              onKeyspaceMutated={() => setKeyspaceVersion((v) => v + 1)}
              onKeyDeleted={(deletedKey) => {
                tabs.dropTab(`rediskey:${deletedKey}`)
                setKeyspaceVersion((v) => v + 1)
              }}
              onDashboardRenamed={dashboards.renamedExternally}
              onTemplateApplied={onTemplateApplied}
            />
          )}
        />

        {/* Status bar — bottom of the main area only; the rail and sidebar keep
            their full height. */}
        <StatusBar conn={conn} database={ns.database} schema={ns.schema} onSchemaHistory={openSchemaHistory} />
      </main>

      {tabs.tabMenu && (
        <TabContextMenu
          menu={tabs.tabMenu}
          tabs={tabs.tabs}
          splitDir={tabs.splitDir}
          paneOf={tabs.paneOf}
          onClose={() => tabs.setTabMenu(null)}
          onCloseTab={tabs.removeTab}
          onCloseOthers={tabs.closeOtherTabs}
          onCloseToRight={tabs.closeTabsToRight}
          onCloseAll={tabs.closeAllTabs}
          onMoveToPane={tabs.moveTabToPane}
        />
      )}

      {creatingTable && (
        <CreateTablePanel
          conn={nsConn}
          initialTable={creatingTable?.table}
          onClose={() => setCreatingTable(false)}
          onStage={(statements: string[], tableName: string, mode: string) => {
            changes.stageTableChanges(statements, tableName, mode)
            setCreatingTable(false)
          }}
        />
      )}

      {analyzeSql != null && (
        <AnalyzePanel
          conn={nsConn}
          dialect={DIALECT[conn.type]}
          sql={analyzeSql}
          onClose={() => setAnalyzeSql(null)}
          onOpenInEditor={(ddl: string) => {
            setAnalyzeSql(null)
            openQuery(ddl)
          }}
        />
      )}

      {analyzeFolder != null && (
        <AnalyzeFolderPanel
          conn={nsConn}
          dialect={DIALECT[conn.type]}
          folderName={analyzeFolder.name}
          queries={analyzeFolder.queries}
          onClose={() => setAnalyzeFolder(null)}
          onOpenInEditor={(ddl: string) => {
            setAnalyzeFolder(null)
            openQuery(ddl)
          }}
        />
      )}

      {savedQueries.savingQuery != null && (
        <SaveQueryPanel
          sql={savedQueries.savingQuery}
          defaultName={`Query ${savedQueries.saved.length + 1}`}
          onClose={() => savedQueries.setSavingQuery(null)}
          onSave={savedQueries.commitSaveQuery}
        />
      )}

      {changes.changesOpen && (
        <ChangesPanel
          changes={changes.changes}
          committing={changes.committing}
          onCommit={changes.commitChanges}
          onClear={() => changes.setChanges([])}
          onClose={() => changes.setChangesOpen(false)}
        />
      )}

      {pendingConn && (
        <ConfirmDialog
          title="Switch connection?"
          message="Changing connection will close all open tabs and discard any staged changes for this connection."
          confirmLabel="Switch connection"
          cancelLabel="Stay here"
          danger
          onConfirm={() => {
            switchConnection(pendingConn)
            setPendingConn(null)
          }}
          onCancel={() => setPendingConn(null)}
        />
      )}

      {tableAction && (
        <ConfirmDialog
          title={
            tableAction.mode === 'empty'
              ? `Empty table "${tableAction.table}"?`
              : `Delete table "${tableAction.table}"?`
          }
          message={
            tableAction.mode === 'empty'
              ? `This deletes every row in "${tableAction.table}". The data cannot be recovered.${directExecute ? ' It runs immediately.' : ' It will be added to staged changes to commit.'}`
              : `This drops the table "${tableAction.table}" and all of its data.${directExecute ? ' It runs immediately.' : ' It will be added to staged changes to commit.'}`
          }
          confirmLabel={tableAction.mode === 'empty' ? 'Empty table' : 'Delete table'}
          cancelLabel="Cancel"
          danger
          onConfirm={() => {
            if (tableAction.mode === 'empty') changes.emptyTable(tableAction.table)
            else changes.deleteTable(tableAction.table)
            setTableAction(null)
          }}
          onCancel={() => setTableAction(null)}
        />
      )}

      {schemaHistory.rollbackTarget && (
        <ConfirmDialog
          title={`Roll back to v${schemaHistory.rollbackTarget.version}?`}
          message={`This runs the down SQL for every version newer than v${schemaHistory.rollbackTarget.version} against your database, marks them rolled back, and resets the schema version to v${schemaHistory.rollbackTarget.version}. This cannot be undone automatically.`}
          confirmLabel={schemaHistory.rollingBack ? 'Rolling back…' : 'Roll back'}
          cancelLabel="Cancel"
          danger
          onConfirm={() => !schemaHistory.rollingBack && schemaHistory.rollbackMigration(schemaHistory.rollbackTarget)}
          onCancel={() => !schemaHistory.rollingBack && schemaHistory.setRollbackTarget(null)}
        />
      )}

      {connError && (
        <ConnectionLostModal
          name={conn?.name}
          error={connError}
          reconnecting={reconnecting}
          onReconnect={browser.reconnect}
          onLeave={() => navigate('/')}
        />
      )}

      {switcherOpen && (
        <ConnectionSwitcherModal
          connections={connections}
          currentId={id}
          onSelect={requestConnSwitch}
          onClose={() => setSwitcherOpen(false)}
        />
      )}

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} />
    </div>
  )
}
