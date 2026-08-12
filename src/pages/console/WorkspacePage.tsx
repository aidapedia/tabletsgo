import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/features/auth'
import { useConnections, ConnectionSwitcherModal } from '@/features/connections'
import { useSettings } from '@/features/settings'
import { useToast } from '@/shared/ui/feedback/Toast'
import Select from '@/shared/ui/form/Select'
import Button from '@/shared/ui/buttons/Button'
import ConfirmDialog from '@/shared/ui/feedback/ConfirmDialog'
import ContextMenu from '@/shared/ui/overlay/ContextMenu'
import {
  getNamespaces,
  listObjects,
  listSchemaMigrations,
  pingConnection,
  recordSchemaMigration,
  rollbackSchema,
  runQuery,
} from '@/shared/api/database'
import {
  buildDropTableRollback,
  rollbackForAddColumn,
  rollbackForCreateTable,
} from '@/features/schema-designer/lib/rollback'
import {
  fetchSaved,
  createSaved,
  deleteSaved,
  renameSaved,
  updateSaved,
  fetchFolders,
  createFolder,
  renameFolder,
  deleteFolder,
  moveFolder,
} from '@/features/workspace/lib/savedQueries'
import SearchInput from '@/shared/ui/form/SearchInput'
import TableView, { makeFilter } from '@/features/workspace/components/TableView'
import CreateTablePanel from '@/features/schema-designer/components/CreateTablePanel'

// Lazy — pulls in the (heavy) CodeMirror editor only when a query tab opens.
const QueryEditor = lazy(() => import('@/features/workspace/components/QueryEditor'))
// Lazy — React Flow again; only load when a workflow tab opens.
const WorkflowEditor = lazy(() => import('@/features/workflow/components/WorkflowEditor'))
// Lazy — recharts + react-grid-layout; only load when a dashboard tab opens.
const DashboardView = lazy(() => import('@/features/dashboard/components/DashboardView'))
// Lazy — CodeMirror again; only load on a Redis connection's console tab.
const RedisConsole = lazy(() => import('@/features/redis/components/RedisConsole'))
import { RedisKeyTree, RedisKeyView } from '@/features/redis'
import IconRail from '@/features/workspace/components/IconRail'
import TabBar from '@/features/workspace/components/TabBar'
import StatusBar from '@/features/workspace/components/StatusBar'
import { formatCombo, useKeymap, useShortcut } from '@/features/keymap'
import SavedQueriesPanel from '@/features/workspace/components/SavedQueriesPanel'
import AnalyzePanel from '@/features/workspace/components/AnalyzePanel'
import AnalyzeFolderPanel from '@/features/workspace/components/AnalyzeFolderPanel'
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
import QueryHistoryView from '@/features/workspace/components/QueryHistoryView'
import SchemaHistoryView from '@/features/schema-designer/components/SchemaHistoryView'
import { fetchHistory, recordHistory, clearHistory, deleteHistory } from '@/features/workspace/lib/queryHistory'
import SaveQueryPanel from '@/shared/ui/SaveQueryPanel'
import ChangesPanel from '@/features/workspace/components/ChangesPanel'
import SchemaView from '@/features/workspace/components/SchemaView'
import FunctionView from '@/features/workspace/components/FunctionView'
import Segmented from '@/shared/ui/form/Segmented'
import Tooltip from '@/shared/ui/overlay/Tooltip'
import Popover from '@/shared/ui/overlay/Popover'
import CommandPalette, { type Command } from '@/shared/ui/overlay/CommandPalette'
import IconButton from '@/shared/ui/buttons/IconButton'
import MenuItem from '@/shared/ui/navigation/MenuItem'
import RowLabel from '@/shared/ui/RowLabel'
import ListRow from '@/shared/ui/ListRow'
import TextButton from '@/shared/ui/buttons/TextButton'
import {
  ChevronRight,
  CloseIcon,
  CodeIcon,
  ColumnsIcon,
  DatabaseIcon,
  DiagramIcon,
  EditIcon,
  EyeIcon,
  FolderPlusIcon,
  GridIcon,
  HistoryIcon,
  KeyIcon,
  MenuIcon,
  MoreVerticalIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  SplitHorizontalIcon,
  SplitVerticalIcon,
  TableIcon,
  TagIcon,
  TerminalIcon,
  TrashIcon,
  WandIcon,
  WorkflowIcon,
} from '@/shared/ui/icons'
import {
  TableFolderList,
  FolderDot,
  fetchTableFolders,
  deleteTableFolder,
} from '@/features/table-folders'
import { TemplatesPanel, TemplateDetailView, TEMPLATES } from '@/features/templates'

const kbd =
  'inline-flex min-w-[20px] items-center justify-center rounded-[5px] border border-edge bg-elevated px-1.5 py-0.5 text-[11px] text-ink-dim'

const DIALECT = { postgresql: 'PostgreSQL', sqlite: 'SQLite', redis: 'Redis' }
let queryCounter = 0
// Stable identity for unfiltered table tabs — TableView keys effects off `filters`.
const EMPTY_FILTERS = []

const centerState =
  'flex h-full flex-col items-center justify-center gap-4 text-ink-faint'

export default function Workspace() {
  const { id } = useParams()
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
  const conn = connections.find((c) => c.id === id)
  const { bindings } = useKeymap()

  // Selected database/schema namespace (for browsing other DBs/schemas).
  const [ns, setNs] = useState({ database: undefined, schema: undefined })
  const [namespaces, setNamespaces] = useState({ databases: [], schemas: [] })
  // Connection augmented with the selected namespace; passed to data views.
  const nsConn = useMemo(() => (conn ? { ...conn, ns } : conn), [conn, ns])

  const [objects, setObjects] = useState([])
  // Table names (a subset of the browsable objects) — used by the table-specific
  // actions (open, edit, empty, delete, browse) that don't apply to views/functions.
  const tables = useMemo(() => objects.filter((o) => o.type === 'table').map((o) => o.name), [objects])
  const [loading, setLoading] = useState(true)
  const [connError, setConnError] = useState(null) // set when the DB is unreachable
  const [reconnecting, setReconnecting] = useState(false) // retry in progress
  const [filter, setFilter] = useState('')
  // Tabs live in one flat list; each carries the editor pane (0 = first,
  // 1 = the split one) it is shown in. `activeByPane` is the focused tab of
  // each pane, `focusedPane` the one new tabs open in and shortcuts act on.
  const [tabs, setTabs] = useState([])
  const [activeByPane, setActiveByPane] = useState([null, null])
  const [focusedPane, setFocusedPane] = useState(0)
  const [splitDir, setSplitDir] = useState(null) // null (no split) | 'vertical' | 'horizontal'
  const [splitRatio, setSplitRatio] = useState(0.5) // pane 0's share of the editor area
  const [creatingTable, setCreatingTable] = useState<any>(false)
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [schemaMigrations, setSchemaMigrations] = useState([])
  const [schemaHistoryLoading, setSchemaHistoryLoading] = useState(false)
  const [rollbackTarget, setRollbackTarget] = useState(null) // migration awaiting rollback confirmation
  const [rollingBack, setRollingBack] = useState(false)
  const [saved, setSaved] = useState([])
  const [folders, setFolders] = useState([])
  const [workflows, setWorkflows] = useState([])
  const [workflowFolders, setWorkflowFolders] = useState([])
  const [dashboards, setDashboards] = useState([])
  const [dashboardFolders, setDashboardFolders] = useState([])
  const [tabMenu, setTabMenu] = useState(null) // { x, y, key } | null
  const [savingQuery, setSavingQuery] = useState(null) // sql string being saved | null
  const [analyzeSql, setAnalyzeSql] = useState(null) // sql string being analyzed | null
  const [analyzeFolder, setAnalyzeFolder] = useState(null) // { name, queries } being analyzed | null
  const [changes, setChanges] = useState([]) // staged (uncommitted) SQL mutations
  const [changesOpen, setChangesOpen] = useState(false)
  const [queryState, setQueryState] = useState({}) // per query tab: key -> { sql, result, error, elapsedMs }
  const [pendingConn, setPendingConn] = useState(null) // connection id awaiting switch confirmation
  const [switcherOpen, setSwitcherOpen] = useState(false) // connection switcher modal
  const [tableAction, setTableAction] = useState(null) // { table, mode: 'empty' | 'delete' } awaiting confirmation
  const [committing, setCommitting] = useState(false)
  const [dataVersion, setDataVersion] = useState(0) // bump to force table reloads
  const [sidebarOpen, setSidebarOpen] = useState(false) // mobile drawer
  const [openGroup, setOpenGroup] = useState('table') // accordion: the one expanded browser section
  const [tablesVisible, setTablesVisible] = useState(true) // left panel visible
  const [panel, setPanel] = useState('browser') // 'browser' | 'queries' | 'workflows' | 'dashboards' | 'templates'
  const [searchOpen, setSearchOpen] = useState(false) // table search toggle
  const [paletteOpen, setPaletteOpen] = useState(false) // ⌘K command palette
  const [tableSort, setTableSort] = useState('az') // 'az' | 'za'
  const [tableFolders, setTableFolders] = useState([]) // per-connection tableFolders (with grouped table names)
  const [creatingTableFolder, setCreatingTableFolder] = useState(null) // { parentId } while naming a new folder | null
  const [keyspaceVersion, setKeyspaceVersion] = useState(0) // bump to re-scan the Redis key tree
  const searchRef = useRef(null)
  const autoOpenedFor = useRef(null) // connection id we've already auto-opened a tab for
  const paneWrapRef = useRef(null) // the editor area, measured while dragging the split divider

  // Redis is schemaless and tableless: no tables/views/functions browser, no
  // schema designer, no table folders — the sidebar shows its keyspace instead,
  // and every write goes through the command console.
  const isRedis = conn?.type === 'redis'

  // Switching connections is destructive: tabs, staged changes and per-tab
  // editor state are all scoped to the current connection. Ask first, then wipe
  // that state and navigate. If there's nothing to lose, switch straight away.
  const requestConnSwitch = (cid) => {
    setSwitcherOpen(false)
    if (cid === id) {
      setSidebarOpen(false)
      return
    }
    if (tabs.length === 0 && changes.length === 0) {
      switchConnection(cid)
    } else {
      setPendingConn(cid)
    }
  }

  const switchConnection = (cid) => {
    setTabs([])
    setActiveByPane([null, null])
    setFocusedPane(0)
    setSplitDir(null)
    setChanges([])
    setQueryState({})
    autoOpenedFor.current = null
    navigate(`/connection/${cid}`)
    setSidebarOpen(false)
  }

  // Rail selects a panel; clicking the active one again collapses it.
  const selectPanel = (p) => {
    if (panel === p && tablesVisible) {
      setTablesVisible(false)
    } else {
      setPanel(p)
      setTablesVisible(true)
    }
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

  // Toggles the left sidebar — the desktop collapse and the mobile slide-over
  // drawer both represent "is the sidebar open", so keep them in sync.
  const toggleSidebar = () => {
    setTablesVisible((v) => !v)
    setSidebarOpen((v) => !v)
  }

  const loadTables = async () => {
    if (!conn) return
    setLoading(true)
    // Verify the database is reachable first; a dead connection prompts the modal.
    const health = await pingConnection(nsConn)
    if (!health.ok) {
      setConnError(health.error || 'Could not connect to the database.')
      setObjects([])
      setLoading(false)
      return
    }
    setConnError(null)
    const objs = await listObjects(nsConn)
    setObjects(objs || [])
    // First time opening this connection with no tabs yet: open a query tab.
    // Otherwise keep whatever tabs/active tab already exist. The ref guards
    // against the effect firing twice (e.g. React StrictMode in dev).
    if (autoOpenedFor.current !== id) {
      autoOpenedFor.current = id
      if (tabs.length === 0) openQuery()
    }
    setLoading(false)
  }

  // Retry from the "connection lost" modal. loadTables re-pings and clears the
  // error on success (closing the modal) or refreshes the message on failure.
  const reconnect = async () => {
    setReconnecting(true)
    await loadTables()
    setReconnecting(false)
  }

  // Heartbeat: while connected, poll so a connection that drops mid-session is
  // detected too (not just on open). Pauses once the modal is up.
  useEffect(() => {
    if (!conn || connError) return
    const iv = setInterval(async () => {
      const health = await pingConnection(nsConn)
      if (!health.ok) setConnError(health.error || 'The database connection was lost.')
    }, 15000)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn, nsConn, connError])

  // Reload the table list when the connection or selected namespace changes.
  useEffect(() => {
    loadTables()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn, ns])

  // Load available databases/schemas and pick sensible defaults per connection.
  useEffect(() => {
    if (!conn) return
    let alive = true
    getNamespaces(conn).then((data) => {
      if (!alive) return
      setNamespaces(data)
      setNs({
        database: data.currentDatabase || conn.database || data.databases?.[0],
        schema: data.schemas?.includes('public') ? 'public' : data.schemas?.[0],
      })
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn])

  const changeDatabase = async (db) => {
    const data = await getNamespaces(conn, db)
    setNamespaces(data)
    setNs({ database: db, schema: data.schemas?.includes('public') ? 'public' : data.schemas?.[0] })
  }
  const changeSchema = (schema) => setNs((p) => ({ ...p, schema }))

  // Load this connection's saved queries, folders, workflows and dashboards from the backend.
  useEffect(() => {
    let alive = true
    fetchSaved(id).then((list) => {
      if (!alive) return
      setSaved(list)
    })
    fetchFolders(id).then((list) => alive && setFolders(list))
    listWorkflows(id).then((list) => {
      if (!alive) return
      setWorkflows(list)
      // Deep link from the workspace-wide Workflow section: open that workflow
      // rather than the default query tab. Claiming the auto-open here is what
      // stops loadTables() from adding an empty query tab on top of it.
      const w = deepLink && list.find((x) => x.id === deepLink)
      if (w) {
        autoOpenedFor.current = id
        setPanel('workflows')
        openWorkflow(w)
      }
    })
    fetchWorkflowFolders(id).then((list) => alive && setWorkflowFolders(list))
    listDashboards(id).then((list) => {
      if (!alive) return
      setDashboards(list)
      // Same deep link as workflows above, from the Dashboard section. The two
      // requests race, so `!deepLink` — not just the auto-open claim — is what
      // makes a URL carrying both resolve the same way every time: workflow wins.
      const d = dashboardLink && !deepLink && list.find((x) => x.id === dashboardLink)
      if (d && autoOpenedFor.current !== id) {
        autoOpenedFor.current = id
        setPanel('dashboards')
        openDashboard(d)
      }
    })
    fetchDashboardFolders(id).then((list) => alive && setDashboardFolders(list))
    fetchTableFolders(id).then((list) => alive && setTableFolders(list))
    return () => {
      alive = false
    }
  }, [id, deepLink, dashboardLink])

  // Esc closes the mobile slide-over sidebar drawer while it's open.
  useEffect(() => {
    if (!sidebarOpen) return
    const onKey = (e) => e.key === 'Escape' && setSidebarOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sidebarOpen])

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

  // Set one pane's focused tab, leaving the other pane's alone.
  const setPaneActive = (pane, key) =>
    setActiveByPane((prev) => (prev[pane] === key ? prev : prev.map((k, i) => (i === pane ? key : k))))

  // Every "open X" funnels through here. A tab that's already open is focused
  // where it lives — in either pane — and optionally patched (`patch`); a new
  // one opens in the focused pane.
  const openTab = (tab, patch?) => {
    const pane = tabs.find((t) => t.key === tab.key)?.pane ?? focusedPane
    setTabs((prev) =>
      prev.some((t) => t.key === tab.key)
        ? patch
          ? prev.map((t) => (t.key === tab.key ? { ...t, ...patch } : t))
          : prev
        : [...prev, { ...tab, pane }]
    )
    setFocusedPane(pane)
    setPaneActive(pane, tab.key)
    setSidebarOpen(false)
  }

  const openTable = (table) => openTab({ key: `table:${table}`, kind: 'table', table, title: table })

  // FK drill-down: show the referenced table filtered by column = value. Reuses
  // the table's existing tab if one is open (re-filtering it) — including when a
  // different FK points at the same table — otherwise opens a new table tab.
  const openTableFiltered = (table, column, value) => {
    const filters = [makeFilter(column, '=', String(value ?? ''))]
    openTab({ key: `table:${table}`, kind: 'table', table, title: table, filters }, { title: table, filters })
  }

  // Table filters live on the tab, not inside TableView — only the active tab is
  // mounted, so tab-local state would be lost on every tab switch.
  const setTabFilters = (key, filters) =>
    setTabs((prev) => prev.map((t) => (t.key === key ? { ...t, filters } : t)))

  const openQuery = (sql?) => {
    queryCounter += 1
    const initialSql = typeof sql === 'string' ? sql : undefined
    const title = `${isRedis ? 'Console' : 'Query'} ${queryCounter}`
    openTab({ key: `query:${queryCounter}`, kind: 'query', title, sql: initialSql })
  }

  // Open one Redis key in its own tab (focus it if already open).
  const openRedisKey = (redisKey) =>
    openTab({ key: `rediskey:${redisKey}`, kind: 'redisKey', redisKey, title: redisKey })

  // Open a saved query in its own identity-bearing tab: title tracks the saved
  // query's name (and stays in sync on rename), focus if already open.
  const openSavedQuery = (q) =>
    openTab({ key: `query:saved:${q.id}`, kind: 'query', title: q.name, sql: q.sql, savedId: q.id })

  const openSchema = (table) =>
    openTab({ key: `schema:${table}`, kind: 'schema', table, title: `${table} · schema` })

  const openFunction = (name) => openTab({ key: `function:${name}`, kind: 'function', name, title: name })

  // Accordion: opening a section collapses the others; clicking the open one closes it.
  const toggleGroup = (type) => setOpenGroup((prev) => (prev === type ? null : type))

  // Data deleted by DELETE FROM can't be reconstructed — not reversible.
  const emptyTable = (table) => {
    addChange({
      kind: 'delete',
      label: `Empty table ${table}`,
      sql: `DELETE FROM "${table}"`,
      table,
      ddl: true,
      reversible: false,
      rollbackSql: null,
    })
    if (!directExecute) toast.info(`Added empty-table to changes — commit to apply.`)
  }
  // Snapshot the table's columns before staging the drop so we can offer a
  // best-effort rollback (a CREATE TABLE that reconstructs it).
  const deleteTable = async (table) => {
    const { rollbackSql, reversible } = await buildDropTableRollback(nsConn, table)
    addChange({ kind: 'delete', label: `Drop table ${table}`, sql: `DROP TABLE "${table}"`, table, ddl: true, reversible, rollbackSql })
    if (!directExecute) toast.info(`Added drop-table to changes — commit to apply.`)
  }

  const newChange = (c) => ({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ts: Date.now(), ...c })

  // With Direct execute on, mutations skip the Changes panel and run right away;
  // otherwise they're staged for a later commit.
  const addChange = (c) => {
    if (directExecute) {
      executeDirect(newChange(c))
      return
    }
    setChanges((prev) => [newChange(c), ...prev])
  }

  // Run a batch of changes (oldest first) against the DB. Stops at the first
  // failure, records any DDL that ran as one schema-version bump, refreshes the
  // views, and prunes deployed drafts. Returns { succeeded, remaining, failure }.
  const runChangeBatch = async (ordered) => {
    const remaining = []
    const succeeded = []
    // Ran without error but matched no rows. Not a failure — but reporting it
    // as "committed" is how an edit that never landed (a row someone else
    // already changed, a stale WHERE) ends up looking like a success.
    const noop = []
    let failure = null
    for (const ch of ordered) {
      if (failure) {
        remaining.push(ch)
        continue
      }
      const res = await runQuery(nsConn, ch.sql, { timeoutMs: queryTimeout * 1000 })
      if (res?.error) {
        failure = res.error
        remaining.push(ch)
      } else {
        succeeded.push(ch)
        if ((ch.kind === 'update' || ch.kind === 'delete') && res?.rowCount === 0) noop.push(ch)
      }
    }
    setDataVersion((v) => v + 1)
    loadTables() // pick up created/dropped tables in the sidebar

    // One schema version bump per batch, covering only the DDL that actually
    // ran successfully in it — plain row edits never touch schemaVersion.
    const ddlSucceeded = succeeded.filter((ch) => ch.ddl)
    if (ddlSucceeded.length) {
      try {
        const { version } = await recordSchemaMigration(nsConn, ddlSucceeded.map((ch) => ({
          sql: ch.sql,
          rollbackSql: ch.rollbackSql ?? null,
          reversible: !!ch.reversible,
          label: ch.label,
        })))
        patchLocalConnection(id, { schemaVersion: version })
        if (tabs.some((t) => t.kind === 'schemaHistory')) loadSchemaHistory()
      } catch (e) {
        toast.error(`Couldn't record schema migration: ${e.message}`)
      }
    }

    return { succeeded, remaining, failure, noop }
  }

  // Direct-execute path: run one change immediately, no staging.
  const executeDirect = async (change) => {
    const { failure, noop } = await runChangeBatch([change])
    if (failure) toast.error(`${change.label} failed: ${failure}`)
    else if (noop.length) toast.info(`${change.label} matched no rows — nothing changed.`)
    else toast.success(`Executed: ${change.label}`)
  }

  // Execute every staged change in order (oldest first). Stop at the first
  // failure, keeping it (and the rest) in the list so they can be retried.
  const commitChanges = async () => {
    if (!changes.length || committing) return
    setCommitting(true)
    const { succeeded, remaining, failure, noop } = await runChangeBatch([...changes].reverse())
    setCommitting(false)
    setChanges(remaining.reverse())

    if (failure) {
      toast.error(`Committed ${succeeded.length}, then failed: ${failure}`)
    } else {
      toast.success(`Committed ${succeeded.length} change${succeeded.length > 1 ? 's' : ''}.`)
      if (noop.length) {
        toast.info(`${noop.length} of them matched no rows — those rows were not changed.`)
      }
      setChangesOpen(false)
    }
  }

  // ---- Query history (persisted on the backend) ----
  const loadHistory = async () => {
    setHistoryLoading(true)
    try {
      setHistory(await fetchHistory(id))
    } finally {
      setHistoryLoading(false)
    }
  }
  // Record one execution; refresh the list if a history tab is open.
  const recordRun = async (entry) => {
    await recordHistory(id, {
      table: entry.table,
      query: entry.sql,
      status: entry.status,
      latency: entry.latency,
      error: entry.error,
      executorId: user?.id,
      executorName: user?.name || user?.username,
    })
    if (tabs.some((t) => t.kind === 'history')) loadHistory()
  }
  const clearHistoryAll = async () => {
    setHistory([])
    await clearHistory(id)
  }
  const deleteHistoryEntries = async (ids) => {
    if (!ids?.length) return
    const drop = new Set(ids)
    setHistory((prev) => prev.filter((h) => !drop.has(h.id)))
    await deleteHistory(id, ids)
  }
  // Open the query-history tab (focus if already open).
  const openHistory = () => openTab({ key: 'history', kind: 'history', title: 'Query history' })

  // ---- Schema history (migration audit trail; opened from the version badge) ----
  const loadSchemaHistory = async () => {
    setSchemaHistoryLoading(true)
    try {
      setSchemaMigrations(await listSchemaMigrations(nsConn))
    } finally {
      setSchemaHistoryLoading(false)
    }
  }
  const openSchemaHistory = () => openTab({ key: 'schema-history', kind: 'schemaHistory', title: 'Schema history' })
  // Restore the schema to migration `m`'s version: the server runs the down SQL
  // for every active version newer than it, marks them rolled back, and resets
  // the connection's schema version to m.version (rather than bumping it).
  const rollbackMigration = async (m) => {
    setRollingBack(true)
    try {
      const { version } = await rollbackSchema(nsConn, m.version)
      patchLocalConnection(id, { schemaVersion: version })
      toast.success(`Rolled back to v${version}.`)
      setDataVersion((v) => v + 1)
      loadTables()
      loadSchemaHistory()
    } catch (e) {
      toast.error(`Rollback failed: ${e.message}`)
    }
    setRollingBack(false)
    setRollbackTarget(null)
  }

  // ---- Workflows (per connection) ----
  // Open a workflow in its own tab; title tracks the workflow name (kept in sync
  // on rename). Focus it if already open.
  const openWorkflow = (w) => openTab({ key: `workflow:${w.id}`, kind: 'workflow', workflowId: w.id, title: w.name })
  const newWorkflow = async (folderId = null) => {
    try {
      const wf = await createWorkflow(id, `Workflow ${workflows.length + 1}`, undefined, folderId)
      setWorkflows((prev) => [{ id: wf.id, name: wf.name, ts: Date.now(), protected: false, scheduleEnabled: false, folderId: folderId || null }, ...prev])
      openWorkflow(wf)
    } catch (e) {
      toast.error(`Couldn't create workflow: ${e.message}`)
    }
  }
  const renameWorkflow = async (wid, name) => {
    const next = name?.trim()
    if (!next) return
    setWorkflows((prev) => prev.map((w) => (w.id === wid ? { ...w, name: next } : w)))
    setTabs((prev) => prev.map((t) => (t.key === `workflow:${wid}` ? { ...t, title: next } : t)))
    try {
      await updateWorkflow(id, wid, { name: next })
    } catch (e) {
      toast.error(`Rename failed: ${e.message}`)
    }
  }
  const removeWorkflow = async (wid) => {
    setWorkflows((prev) => prev.filter((w) => w.id !== wid))
    dropTab(`workflow:${wid}`)
    try {
      await deleteWorkflow(id, wid)
    } catch (e) {
      toast.error(`Delete failed: ${e.message}`)
    }
  }
  const workflowFileRef = useRef(null)
  const importWorkflowFile = async (file) => {
    try {
      const doc = JSON.parse(await file.text())
      if (doc?.kind !== 'workflow' || !doc.graph) throw new Error('Not a workflow export file.')
      const wf = await createWorkflow(id, doc.name || 'Imported workflow', sanitizeGraph(doc.graph))
      setWorkflows((prev) => [{ id: wf.id, name: wf.name, ts: Date.now(), protected: false, scheduleEnabled: false, folderId: null }, ...prev])
      openWorkflow(wf)
    } catch (e) {
      toast.error(`Import failed: ${e.message}`)
    }
  }

  // ---- Workflow folders (nesting capped at 3 levels, enforced server-side) ----
  const addWorkflowFolder = async (name, parentId = null) => {
    const next = name?.trim()
    if (!next) return
    try {
      const folder = await createWorkflowFolder(id, next, parentId)
      setWorkflowFolders((prev) => [...prev, folder])
    } catch (e) {
      toast.error(`Couldn't create folder: ${e.message}`)
    }
  }
  const renameWorkflowFolderById = async (fid, name) => {
    const next = name?.trim()
    if (!next) return
    setWorkflowFolders((prev) => prev.map((f) => (f.id === fid ? { ...f, name: next } : f)))
    try {
      await renameWorkflowFolder(id, fid, next)
    } catch (e) {
      toast.error(`Rename failed: ${e.message}`)
    }
  }
  const removeWorkflowFolder = async (fid) => {
    // Reparent this folder's contents up one level locally, mirroring the server:
    // its subfolders and workflows move to its own parent (root for a top-level folder).
    const parentId = workflowFolders.find((f) => f.id === fid)?.parentId || null
    setWorkflowFolders((prev) =>
      prev.filter((f) => f.id !== fid).map((f) => (f.parentId === fid ? { ...f, parentId } : f))
    )
    setWorkflows((prev) => prev.map((w) => (w.folderId === fid ? { ...w, folderId: parentId } : w)))
    try {
      await deleteWorkflowFolder(id, fid)
    } catch (e) {
      toast.error(`Delete failed: ${e.message}`)
    }
  }
  const moveWorkflowFolderToParent = async (fid, parentId) => {
    const target = parentId || null
    if (fid === target) return
    // Guard against cycles: refuse to nest a folder under its own descendant.
    const parentOf = new Map(workflowFolders.map((f) => [f.id, f.parentId || null]))
    for (let cur = target; cur; cur = parentOf.get(cur)) {
      if (cur === fid) return
    }
    setWorkflowFolders((prev) => prev.map((f) => (f.id === fid ? { ...f, parentId: target } : f)))
    try {
      await moveWorkflowFolder(id, fid, target)
    } catch (e) {
      // Depth-cap or cycle rejection — refresh to resync with the server truth.
      toast.error(`Move failed: ${e.message}`)
      fetchWorkflowFolders(id).then(setWorkflowFolders)
    }
  }
  const moveWorkflowToFolder = async (wid, folderId) => {
    setWorkflows((prev) => prev.map((w) => (w.id === wid ? { ...w, folderId: folderId || null } : w)))
    try {
      await updateWorkflow(id, wid, { folderId: folderId || null })
    } catch (e) {
      toast.error(`Move failed: ${e.message}`)
    }
  }

  // ---- Dashboards (per connection) ----
  // Mirrors the workflow handlers: open in a tab, create, rename, delete,
  // plus import (create a new dashboard from an exported JSON structure).
  const dashboardFileRef = useRef(null)
  const openDashboard = (d) =>
    openTab({ key: `dashboard:${d.id}`, kind: 'dashboard', dashboardId: d.id, title: d.name })
  // ---- Templates (built-in catalog, browse + apply) ----
  // Open a template's detail in its own tab (VSCode-style). Applying creates
  // its workflows + dashboards on this connection, then refreshes the rails.
  const openTemplate = (t) => openTab({ key: `template:${t.id}`, kind: 'template', templateId: t.id, title: t.name })
  const onTemplateApplied = (res) => {
    listWorkflows(id).then(setWorkflows)
    fetchWorkflowFolders(id).then(setWorkflowFolders)
    listDashboards(id).then(setDashboards)
    fetchDashboardFolders(id).then(setDashboardFolders)
    const d = res.dashboards[0]
    if (d) openDashboard(d)
    else if (res.workflows[0]) openWorkflow(res.workflows[0])
  }
  const newDashboard = async (folderId = null) => {
    try {
      const d = await createDashboard(id, `Dashboard ${dashboards.length + 1}`, undefined, folderId)
      setDashboards((prev) => [{ id: d.id, name: d.name, ts: d.ts, folderId: d.folderId ?? null }, ...prev])
      openDashboard(d)
    } catch (e) {
      toast.error(`Couldn't create dashboard: ${e.message}`)
    }
  }
  const renameDashboard = async (did, name) => {
    const next = name?.trim()
    if (!next) return
    setDashboards((prev) => prev.map((d) => (d.id === did ? { ...d, name: next } : d)))
    setTabs((prev) => prev.map((t) => (t.key === `dashboard:${did}` ? { ...t, title: next } : t)))
    try {
      await updateDashboard(id, did, { name: next })
    } catch (e) {
      toast.error(`Rename failed: ${e.message}`)
    }
  }
  // DashboardView renamed it via its settings modal — just sync list + tab.
  const dashboardRenamed = (did, name) => {
    setDashboards((prev) => prev.map((d) => (d.id === did ? { ...d, name } : d)))
    setTabs((prev) => prev.map((t) => (t.key === `dashboard:${did}` ? { ...t, title: name } : t)))
  }
  const removeDashboard = async (did) => {
    setDashboards((prev) => prev.filter((d) => d.id !== did))
    dropTab(`dashboard:${did}`)
    try {
      await deleteDashboard(id, did)
    } catch (e) {
      toast.error(`Delete failed: ${e.message}`)
    }
  }
  const importDashboardFile = async (file) => {
    try {
      const doc = JSON.parse(await file.text())
      if (doc?.kind !== 'dashboard' || !doc.config) throw new Error('Not a dashboard export file.')
      const d = await createDashboard(id, doc.name || 'Imported dashboard', sanitizeConfig(doc.config))
      setDashboards((prev) => [{ id: d.id, name: d.name, ts: d.ts, folderId: d.folderId ?? null }, ...prev])
      openDashboard(d)
    } catch (e) {
      toast.error(`Import failed: ${e.message}`)
    }
  }

  // ---- Dashboard folders (nesting capped at 3 levels, enforced server-side) ----
  const addDashboardFolder = async (name, parentId = null) => {
    const next = name?.trim()
    if (!next) return
    try {
      const folder = await createDashboardFolder(id, next, parentId)
      setDashboardFolders((prev) => [...prev, folder])
    } catch (e) {
      toast.error(`Couldn't create folder: ${e.message}`)
    }
  }
  const renameDashboardFolderById = async (fid, name) => {
    const next = name?.trim()
    if (!next) return
    setDashboardFolders((prev) => prev.map((f) => (f.id === fid ? { ...f, name: next } : f)))
    try {
      await renameDashboardFolder(id, fid, next)
    } catch (e) {
      toast.error(`Rename failed: ${e.message}`)
    }
  }
  const removeDashboardFolder = async (fid) => {
    // Reparent this folder's contents up one level locally, mirroring the server:
    // its subfolders and dashboards move to its own parent (root for a top-level folder).
    const parentId = dashboardFolders.find((f) => f.id === fid)?.parentId || null
    setDashboardFolders((prev) =>
      prev.filter((f) => f.id !== fid).map((f) => (f.parentId === fid ? { ...f, parentId } : f))
    )
    setDashboards((prev) => prev.map((d) => (d.folderId === fid ? { ...d, folderId: parentId } : d)))
    try {
      await deleteDashboardFolder(id, fid)
    } catch (e) {
      toast.error(`Delete failed: ${e.message}`)
    }
  }
  const moveDashboardFolderToParent = async (fid, parentId) => {
    const target = parentId || null
    if (fid === target) return
    // Guard against cycles: refuse to nest a folder under its own descendant.
    const parentOf = new Map(dashboardFolders.map((f) => [f.id, f.parentId || null]))
    for (let cur = target; cur; cur = parentOf.get(cur)) {
      if (cur === fid) return
    }
    setDashboardFolders((prev) => prev.map((f) => (f.id === fid ? { ...f, parentId: target } : f)))
    try {
      await moveDashboardFolder(id, fid, target)
    } catch (e) {
      // Depth-cap or cycle rejection — refresh to resync with the server truth.
      toast.error(`Move failed: ${e.message}`)
      fetchDashboardFolders(id).then(setDashboardFolders)
    }
  }
  const moveDashboardToFolder = async (did, folderId) => {
    setDashboards((prev) => prev.map((d) => (d.id === did ? { ...d, folderId: folderId || null } : d)))
    try {
      await updateDashboard(id, did, { folderId: folderId || null })
    } catch (e) {
      toast.error(`Move failed: ${e.message}`)
    }
  }

  const saveQuery = (sql) => {
    const trimmed = sql.trim()
    if (!trimmed) return
    // Saving a tab opened from a saved query updates it in place — no drawer.
    if (current?.savedId) {
      updateSavedQuery(current.savedId, trimmed)
      return
    }
    setSavingQuery(trimmed)
  }
  const updateSavedQuery = async (sid, sql) => {
    setSaved((prev) => prev.map((s) => (s.id === sid ? { ...s, sql } : s)))
    try {
      await updateSaved(id, sid, { sql })
      toast.success('Query updated.')
    } catch (e) {
      toast.error(`Update failed: ${e.message}`)
    }
  }
  const commitSaveQuery = async (name) => {
    const sqlToSave = savingQuery
    setSavingQuery(null)
    try {
      const entry = await createSaved(id, { name, sql: sqlToSave })
      setSaved((prev) => [entry, ...prev])
      setPanel('queries')
      setTablesVisible(true)
      toast.success(`Saved “${entry.name}”.`)
    } catch (e) {
      toast.error(`Save failed: ${e.message}`)
    }
  }
  const removeSaved = async (sid) => {
    setSaved((prev) => prev.filter((s) => s.id !== sid))
    try {
      await deleteSaved(id, sid)
    } catch (e) {
      toast.error(`Delete failed: ${e.message}`)
    }
  }

  // ---- Folders ----
  const addFolder = async (name, parentId = null) => {
    const next = name?.trim()
    if (!next) return
    try {
      const folder = await createFolder(id, next, parentId)
      setFolders((prev) => [...prev, folder])
    } catch (e) {
      toast.error(`Couldn't create folder: ${e.message}`)
    }
  }
  const renameFolderById = async (fid, name) => {
    const next = name?.trim()
    if (!next) return
    setFolders((prev) => prev.map((f) => (f.id === fid ? { ...f, name: next } : f)))
    try {
      await renameFolder(id, fid, next)
    } catch (e) {
      toast.error(`Rename failed: ${e.message}`)
    }
  }
  const removeFolder = async (fid) => {
    // Reparent this folder's contents up one level locally, mirroring the server:
    // its subfolders and queries move to its own parent (root for a top-level folder).
    const parentId = folders.find((f) => f.id === fid)?.parentId || null
    setFolders((prev) =>
      prev.filter((f) => f.id !== fid).map((f) => (f.parentId === fid ? { ...f, parentId } : f))
    )
    setSaved((prev) => prev.map((s) => (s.folderId === fid ? { ...s, folderId: parentId } : s)))
    try {
      await deleteFolder(id, fid)
    } catch (e) {
      toast.error(`Delete failed: ${e.message}`)
    }
  }
  const moveFolderToParent = async (fid, parentId) => {
    const target = parentId || null
    if (fid === target) return
    // Guard against cycles: refuse to nest a folder under its own descendant.
    const parentOf = new Map(folders.map((f) => [f.id, f.parentId || null]))
    for (let cur = target; cur; cur = parentOf.get(cur)) {
      if (cur === fid) return
    }
    setFolders((prev) => prev.map((f) => (f.id === fid ? { ...f, parentId: target } : f)))
    try {
      await moveFolder(id, fid, target)
    } catch (e) {
      toast.error(`Move failed: ${e.message}`)
    }
  }
  const moveSavedToFolder = async (sid, folderId) => {
    setSaved((prev) => prev.map((s) => (s.id === sid ? { ...s, folderId: folderId || null } : s)))
    try {
      await updateSaved(id, sid, { folderId: folderId || null })
    } catch (e) {
      toast.error(`Move failed: ${e.message}`)
    }
  }

  // Rollback SQL for one staged DDL statement, keyed by its schema-designer mode.
  // Sidebar "Create table" stages directly into Changes.
  const stageTableChanges = (statements, tableName, mode) => {
    statements.forEach((sql) => {
      const rollbackSql = mode === 'edit' ? rollbackForAddColumn(sql, tableName) : rollbackForCreateTable(tableName)
      addChange({
        kind: mode === 'edit' ? 'update' : 'create',
        label: mode === 'edit' ? `Alter table ${tableName}` : `Create table ${tableName}`,
        sql,
        table: tableName,
        ddl: true,
        reversible: true,
        rollbackSql,
      })
    })
    setCreatingTable(false)
  }

  const renameSavedQuery = async (sid, name) => {
    const next = name?.trim()
    if (!next) return
    setSaved((prev) => prev.map((s) => (s.id === sid ? { ...s, name: next } : s)))
    // Keep the matching open saved-query tab's title in sync.
    setTabs((prev) => prev.map((t) => (t.key === `query:saved:${sid}` ? { ...t, title: next } : t)))
    try {
      await renameSaved(id, sid, next)
      toast.success(`Renamed to “${next}”.`)
    } catch (e) {
      toast.error(`Rename failed: ${e.message}`)
    }
  }

  // Persist a query tab's editor state (SQL + result) so it survives tab
  // switches; held until the tab is closed.
  const persistQueryState = (key, snapshot) =>
    setQueryState((p) => ({ ...p, [key]: snapshot }))

  // Re-point each pane's active tab at something that still exists in it (an
  // explicit `want` wins), and fold the split away once its pane runs empty.
  const settlePanes = (list, want = {}) => {
    setActiveByPane((cur) =>
      cur.map((k, p) => {
        const own = list.filter((t) => t.pane === p)
        const target = want[p] ?? k
        if (target && own.some((t) => t.key === target)) return target
        return own.length ? own[own.length - 1].key : null
      })
    )
    if (!list.some((t) => t.pane === 1)) {
      setSplitDir(null)
      setFocusedPane(0)
    }
  }

  // Actually drop a tab (and its query state).
  const dropTab = (key) => {
    if (queryState[key]) setQueryState((p) => { const n = { ...p }; delete n[key]; return n })
    const next = tabs.filter((t) => t.key !== key)
    setTabs(next)
    settlePanes(next)
  }

  const removeTab = (key) => dropTab(key)

  const closeTab = (e, key) => {
    e.stopPropagation()
    removeTab(key)
  }

  // The "close …" menu entries act inside the tab's own pane; the other pane's
  // tabs are a separate group and are never touched.
  const paneOf = (key) => tabs.find((t) => t.key === key)?.pane ?? 0

  const closeTabsToRight = (key) => {
    const p = paneOf(key)
    const idx = tabs.filter((t) => t.pane === p).findIndex((t) => t.key === key)
    if (idx === -1) return
    const doomed = new Set(tabs.filter((t) => t.pane === p).slice(idx + 1).map((t) => t.key))
    const next = tabs.filter((t) => !doomed.has(t.key))
    setTabs(next)
    settlePanes(next, { [p]: key })
  }

  const closeOtherTabs = (key) => {
    const p = paneOf(key)
    const next = tabs.filter((t) => t.pane !== p || t.key === key)
    setTabs(next)
    settlePanes(next, { [p]: key })
  }

  const closeAllTabs = (pane = focusedPane) => {
    const next = tabs.filter((t) => t.pane !== pane)
    setTabs(next)
    settlePanes(next)
  }

  // ---- Split view ----
  // A tab belongs to exactly one pane; moving it there is what creates the
  // split, and the split folds away as soon as the second pane runs empty.
  const moveTabToPane = (key, pane, dir = splitDir || 'vertical') => {
    const next = tabs.map((t) => (t.key === key ? { ...t, pane } : t))
    setTabs(next)
    if (pane === 1) setSplitDir(dir)
    settlePanes(next, { [pane]: key })
    setFocusedPane(pane)
  }

  // Tab-bar / shortcut toggle: split the focused tab off into the second pane,
  // or (when already split) merge everything back into the first one.
  const toggleSplit = (dir = 'vertical') => {
    if (splitDir) {
      if (splitDir !== dir) {
        setSplitDir(dir)
        return
      }
      unsplit()
      return
    }
    const key = activeByPane[0]
    if (key) moveTabToPane(key, 1, dir)
  }

  // Fold the split away without losing work: the second pane's tabs join the first.
  const unsplit = () => {
    const keep = activeByPane[focusedPane] ?? activeByPane[0] ?? activeByPane[1]
    const next = tabs.map((t) => (t.pane === 1 ? { ...t, pane: 0 } : t))
    setTabs(next)
    setSplitDir(null)
    setFocusedPane(0)
    settlePanes(next, { 0: keep })
  }

  // Dropping a tab onto the other pane's strip: move it there, positioned
  // before `anchorKey` (or at the end when the drop landed past the last tab).
  const adoptTab = (pane, key, anchorKey) => {
    const tab = tabs.find((t) => t.key === key)
    if (!tab || tab.pane === pane) return
    const rest = tabs.filter((t) => t.key !== key)
    const at = anchorKey ? rest.findIndex((t) => t.key === anchorKey) : -1
    const next = [...rest]
    next.splice(at === -1 ? next.length : at, 0, { ...tab, pane })
    setTabs(next)
    settlePanes(next, { [pane]: key })
    setFocusedPane(pane)
  }

  // Drag-reorder within one pane's strip: move `fromKey` next to `toKey` (before
  // or after it); `toKey === null` moves it to the end. Both keys belong to the
  // same pane, so reordering the flat list keeps every pane's own order intact.
  const moveTab = (fromKey, toKey, before) => {
    setTabs((prev) => {
      const from = prev.findIndex((t) => t.key === fromKey)
      if (from === -1) return prev
      const next = prev.filter((t) => t.key !== fromKey)
      const at = toKey == null ? next.length : next.findIndex((t) => t.key === toKey)
      next.splice(at === -1 ? next.length : at + (before ? 0 : 1), 0, prev[from])
      return next
    })
  }

  const openTabMenu = (e, key) => {
    e.preventDefault()
    e.stopPropagation()
    setTabMenu({ x: e.clientX, y: e.clientY, key })
  }

  const visibleObjects = objects
    .filter((o) => o.name.toLowerCase().includes(filter.trim().toLowerCase()))
    .sort((a, b) => (tableSort === 'az' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name)))
  // Group into the browser's sections, in display order.
  const objectGroups = [
    { type: 'table', label: 'Tables', items: visibleObjects.filter((o) => o.type === 'table') },
    { type: 'view', label: 'Views', items: visibleObjects.filter((o) => o.type === 'view') },
    { type: 'function', label: 'Functions', items: visibleObjects.filter((o) => o.type === 'function') },
    // Tables also stays visible while it only holds folders (empty ones, or all
    // of their tables filtered out) — otherwise the folder tree would vanish.
  ].filter((g) => g.items.length > 0 || (g.type === 'table' && (tableFolders.length > 0 || creatingTableFolder)))

  // The tab on screen in each pane. `current` is the focused pane's — what
  // tab-scoped actions (save, stage, the sidebar's active row) apply to;
  // `onScreen` is both, since a split shows two tabs at once.
  const tabInPane = (p) => tabs.find((t) => t.key === activeByPane[p])
  const current = tabInPane(focusedPane)
  const onScreen = [tabInPane(0), tabInPane(1)].filter(Boolean)

  // tableName -> its folder (drives the inline dot + the grouped view).
  const folderByTable = useMemo(() => {
    const map = {}
    for (const d of tableFolders) for (const tn of d.tables || []) map[tn] = d
    return map
  }, [tableFolders])

  // Tables shown in the 'folders' view — TableFolderList buckets them into one
  // folder per table folder plus a trailing "Ungrouped" folder.
  const tableObjects = visibleObjects.filter((o) => o.type === 'table')

  // Delete a table folder (optimistic local update).
  const removeTableFolder = async (folderId) => {
    // Mirror the server locally: subfolders and member tables move up one level
    // (to this folder's parent — the root, i.e. ungrouped, for a top-level one).
    const prev = tableFolders
    const gone = tableFolders.find((f) => f.id === folderId)
    const parentId = gone?.parentId || null
    setTableFolders((list) =>
      list
        .filter((f) => f.id !== folderId)
        .map((f) => ({
          ...f,
          parentId: (f.parentId || null) === folderId ? parentId : f.parentId,
          tables: f.id === parentId ? [...f.tables, ...(gone?.tables || [])] : f.tables,
        }))
    )
    try {
      await deleteTableFolder(id, folderId)
    } catch (e) {
      setTableFolders(prev)
      toast.error(`Delete failed: ${e.message}`)
    }
  }

  // One table/view/function sidebar row (used flat and inside table folders).
  // `rowProps` is spread onto the row so the folder view can make it draggable.
  const renderObject = (obj, rowProps = {}) => {
    const active = onScreen.some((t) =>
      obj.type === 'function' ? t.kind === 'function' && t.name === obj.name : t.kind === 'table' && t.table === obj.name
    )
    const Icon = obj.type === 'view' ? EyeIcon : obj.type === 'function' ? CodeIcon : TableIcon
    const onOpen = obj.type === 'function' ? () => openFunction(obj.name) : () => openTable(obj.name)
    const rowFolder = obj.type === 'table' ? folderByTable[obj.name] : null
    return (
      <ListRow
        key={`${obj.type}:${obj.name}`}
        active={active}
        onClick={onOpen}
        icon={<Icon className={`flex-shrink-0 ${active ? 'text-ink' : 'text-ink-faint'}`} />}
        {...rowProps}
      >
        <RowLabel title={obj.type === 'function' && obj.detail ? `${obj.name}(${obj.detail})` : obj.name}>
          {obj.name}
        </RowLabel>
        {rowFolder && (
          <span className="shrink-0 group-hover:hidden" title={rowFolder.name}>
            <FolderDot color={rowFolder.color} size={7} />
          </span>
        )}
        <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
          <Popover
            align="right"
            width={210}
            placement="top"
            portal
            trigger={({ open, toggle }) => (
              <IconButton
                size="sm"
                active={open}
                onClick={toggle}
                aria-label={`${obj.type} actions`}
                className={open ? 'opacity-100' : '!text-ink-faint opacity-0 group-hover:opacity-100'}
              >
                <MoreVerticalIcon width={15} height={15} />
              </IconButton>
            )}
          >
            {({ close }) => (
              <div className="p-1">
                {obj.type === 'function' ? (
                  <>
                    <MenuItem onClick={() => { openFunction(obj.name); close() }}>
                      <CodeIcon width={14} height={14} /> Open definition
                    </MenuItem>
                    <MenuItem onClick={() => { openQuery(`SELECT ${obj.name}();`); close() }}>
                      <CodeIcon width={14} height={14} /> Open in SQL Editor
                    </MenuItem>
                  </>
                ) : obj.type === 'view' ? (
                  <>
                    <MenuItem onClick={() => { openTable(obj.name); close() }}>
                      <TableIcon width={14} height={14} /> Open in new tab
                    </MenuItem>
                    <MenuItem onClick={() => { openQuery(`SELECT * FROM "${obj.name}";`); close() }}>
                      <CodeIcon width={14} height={14} /> Open in SQL Editor
                    </MenuItem>
                    <MenuItem onClick={() => { openSchema(obj.name); close() }}>
                      <ColumnsIcon width={14} height={14} /> View schema
                    </MenuItem>
                  </>
                ) : (
                  <>
                    <MenuItem onClick={() => { openTable(obj.name); close() }}>
                      <TableIcon width={14} height={14} /> Open in new tab
                    </MenuItem>
                    <MenuItem onClick={() => { openQuery(`SELECT * FROM "${obj.name}";`); close() }}>
                      <CodeIcon width={14} height={14} /> Open in SQL Editor
                    </MenuItem>
                    <MenuItem onClick={() => { openSchema(obj.name); close() }}>
                      <ColumnsIcon width={14} height={14} /> View table schema
                    </MenuItem>
                    <MenuItem onClick={() => { setCreatingTable({ table: obj.name }); close() }}>
                      <EditIcon width={14} height={14} /> Edit Table
                    </MenuItem>
                    <div className="my-1 h-px bg-edge" />
                    <MenuItem danger onClick={() => { setTableAction({ table: obj.name, mode: 'empty' }); close() }}>
                      <TrashIcon width={14} height={14} /> Empty Table
                    </MenuItem>
                    <MenuItem danger onClick={() => { setTableAction({ table: obj.name, mode: 'delete' }); close() }}>
                      <TrashIcon width={14} height={14} /> Delete Table
                    </MenuItem>
                  </>
                )}
              </div>
            )}
          </Popover>
        </div>
      </ListRow>
    )
  }

  useShortcut('general.search', () => setPaletteOpen(true))
  useShortcut('general.newTab', () => openQuery())
  useShortcut('workspace.panelBrowser', () => selectPanel('browser'))
  useShortcut('workspace.panelQueries', () => selectPanel('queries'))
  useShortcut('workspace.panelWorkflows', () => selectPanel('workflows'))
  useShortcut('workspace.panelDashboards', () => selectPanel('dashboards'))
  useShortcut('workspace.panelSchema', openSchemaEditorPage)
  useShortcut('workspace.toggleSidebar', toggleSidebar)
  useShortcut('workspace.commitChanges', commitChanges)
  useShortcut('workspace.splitEditor', () => toggleSplit('vertical'))
  useShortcut('workspace.focusOtherPane', () => splitDir && setFocusedPane((p) => (p === 0 ? 1 : 0)))

  // Commands surfaced in the ⌘K palette. `hint` mirrors the action's current
  // keymap binding so the palette stays in sync with user-customized shortcuts.
  // Schema/table entries only exist for the engines that have them; on Redis the
  // palette offers the console and keyspace instead.
  const commands: Command[] = [
    isRedis
      ? { id: 'new-query', group: 'Create', label: 'New Redis console', keywords: 'command redis cli tab', icon: <TerminalIcon width={15} height={15} />, hint: formatCombo(bindings['general.newTab']), run: () => openQuery() }
      : { id: 'new-query', group: 'Create', label: 'New SQL query', keywords: 'sql add query tab', icon: <CodeIcon width={15} height={15} />, hint: formatCombo(bindings['general.newTab']), run: () => openQuery() },
    { id: 'new-workflow', group: 'Create', label: 'New workflow', keywords: 'automation flow', icon: <WorkflowIcon width={15} height={15} />, run: () => newWorkflow() },
    { id: 'new-dashboard', group: 'Create', label: 'New dashboard', keywords: 'charts widgets analytics', icon: <GridIcon width={15} height={15} />, run: () => newDashboard() },
    ...(isRedis
      ? []
      : [{ id: 'new-table', group: 'Create', label: 'New table', keywords: 'create table ddl', icon: <PlusIcon width={15} height={15} />, run: () => setCreatingTable(true) }]),

    isRedis
      ? { id: 'go-browser', group: 'Navigate', label: 'Keyspace', keywords: 'keys redis browse scan', icon: <KeyIcon width={15} height={15} />, hint: formatCombo(bindings['workspace.panelBrowser']), run: () => selectPanel('browser') }
      : { id: 'go-browser', group: 'Navigate', label: 'Browser', keywords: 'tables data browse', icon: <TableIcon width={15} height={15} />, hint: formatCombo(bindings['workspace.panelBrowser']), run: () => selectPanel('browser') },
    { id: 'go-queries', group: 'Navigate', label: 'Saved queries', keywords: 'queries panel', icon: <CodeIcon width={15} height={15} />, hint: formatCombo(bindings['workspace.panelQueries']), run: () => selectPanel('queries') },
    { id: 'go-workflows', group: 'Navigate', label: 'Workflows', keywords: 'automation', icon: <WorkflowIcon width={15} height={15} />, hint: formatCombo(bindings['workspace.panelWorkflows']), run: () => selectPanel('workflows') },
    ...(isRedis
      ? []
      : [{ id: 'go-schema', group: 'Navigate', label: 'Schema editor', keywords: 'designer diagram erd', icon: <DiagramIcon width={15} height={15} />, hint: formatCombo(bindings['workspace.panelSchema']), run: openSchemaEditorPage }]),
    { id: 'go-dashboards', group: 'Navigate', label: 'Dashboards', keywords: 'charts analytics', icon: <GridIcon width={15} height={15} />, hint: formatCombo(bindings['workspace.panelDashboards']), run: () => selectPanel('dashboards') },
    { id: 'go-templates', group: 'Navigate', label: 'Templates', keywords: 'presets starter gallery scaffold', icon: <WandIcon width={15} height={15} />, run: () => selectPanel('templates') },
    { id: 'switch-connection', group: 'Navigate', label: 'Switch connection…', keywords: 'database change connect', icon: <DatabaseIcon width={15} height={15} />, run: () => setSwitcherOpen(true) },

    { id: 'view-history', group: 'View', label: isRedis ? 'Command history' : 'Query history', keywords: 'recent past', icon: <HistoryIcon width={15} height={15} />, run: openHistory },
    ...(isRedis
      ? []
      : [{ id: 'view-schema-history', group: 'View', label: `Schema version history (v${conn.schemaVersion ?? 1})`, keywords: 'migrations audit', icon: <TagIcon width={15} height={15} />, run: openSchemaHistory }]),
    { id: 'view-changes', group: 'View', label: 'View staged changes', keywords: 'commit diff pending', icon: <EditIcon width={15} height={15} />, run: () => setChangesOpen(true) },
    { id: 'split-vertical', group: 'View', label: splitDir === 'vertical' ? 'Unsplit editor' : 'Split editor right', keywords: 'split pane side by side group', icon: <SplitVerticalIcon width={15} height={15} />, hint: formatCombo(bindings['workspace.splitEditor']), run: () => toggleSplit('vertical') },
    { id: 'split-horizontal', group: 'View', label: splitDir === 'horizontal' ? 'Unsplit editor' : 'Split editor down', keywords: 'split pane stacked group', icon: <SplitHorizontalIcon width={15} height={15} />, run: () => toggleSplit('horizontal') },
  ]

  // ---- Editor panes ----
  // Shown when nothing is open at all (an *empty pane* of a split gets the
  // compact placeholder in renderPane instead — it only owns half the area).
  const emptyWorkspace = (
    <div className="flex h-full w-full items-center justify-center overflow-auto p-8">
      <div className="w-full max-w-[560px] text-center">
        <div className="mx-auto flex h-[88px] w-[88px] items-center justify-center rounded-[22px] border border-edge bg-elevated text-ink-faint">
          {isRedis ? <KeyIcon width={34} height={34} /> : <TableIcon width={34} height={34} />}
        </div>
        <h2 className="mt-7 text-2xl font-bold">{isRedis ? 'No key selected' : 'No table selected'}</h2>
        <p className="mx-auto mt-3 max-w-[420px] text-sm leading-relaxed text-ink-dim">
          {isRedis
            ? 'Pick a key from the keyspace tree to inspect its value, or open a console to run any Redis command.'
            : 'Pick a table from the sidebar to browse rows, or start a query to explore your data with SQL.'}
        </p>

        <div className="mt-7 flex items-center justify-center gap-3">
          <Button variant="primary" size="lg" icon={isRedis ? TerminalIcon : CodeIcon} onClick={() => openQuery()}>
            {isRedis ? 'New console' : 'New SQL query'}
          </Button>
          {!isRedis && (
            <Button
              variant="ghost"
              size="lg"
              icon={TableIcon}
              onClick={() => tables[0] && openTable(tables[0])}
              disabled={tables.length === 0}
            >
              Browse tables
            </Button>
          )}
        </div>

        <div className="mt-9">
          <Button variant="ghost" size="lg" icon={HistoryIcon} onClick={openHistory}>
            View query history
          </Button>
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-6 text-[11px] text-ink-faint">
          <span className="flex items-center gap-1.5"><kbd className={kbd}>{formatCombo(bindings['general.search'])}</kbd> Search tables</span>
          <span className="flex items-center gap-1.5"><kbd className={kbd}>{formatCombo(bindings['workspace.runQuery'])}</kbd> Run query</span>
          <span className="flex items-center gap-1.5"><kbd className={kbd}>{formatCombo(bindings['general.newTab'])}</kbd> New query</span>
        </div>
      </div>
    </div>
  )

  // One pane's body: whatever its focused tab shows. Both panes render through
  // here, so a split mounts two tabs at once — every view is keyed by tab key,
  // so the two never share state.
  const renderTabContent = (t) => {
    if (!conn || !t) return null
    switch (t.kind) {
      case 'table':
        return (
          <TableView
            key={`${t.key}:${dataVersion}:${ns.database}:${ns.schema}`}
            conn={nsConn}
            table={t.table}
            onChange={addChange}
            onOpenReference={openTableFiltered}
            filters={t.filters || EMPTY_FILTERS}
            onFiltersChange={(f) => setTabFilters(t.key, f)}
          />
        )
      case 'schema':
        return <SchemaView key={`${t.key}:${dataVersion}:${ns.database}:${ns.schema}`} conn={nsConn} table={t.table} />
      case 'function':
        return <FunctionView key={`${t.key}:${ns.database}:${ns.schema}`} conn={nsConn} name={t.name} />
      case 'query':
        return (
          <Suspense fallback={<div className="flex-1 p-8 text-center text-xs text-ink-faint">Loading editor…</div>}>
            {isRedis ? (
              <RedisConsole
                key={t.key}
                tabKey={t.key}
                conn={nsConn}
                initialCommand={t.sql ?? ''}
                persisted={queryState[t.key]}
                onPersist={persistQueryState}
                onRan={recordRun}
                onSave={saveQuery}
                onMutated={() => setKeyspaceVersion((v) => v + 1)}
              />
            ) : (
              <QueryEditor
                key={t.key}
                tabKey={t.key}
                conn={nsConn}
                dialect={DIALECT[conn.type]}
                initialSql={t.sql ?? ''}
                persisted={queryState[t.key]}
                onPersist={persistQueryState}
                onRan={recordRun}
                onSave={saveQuery}
                onAnalyze={setAnalyzeSql}
              />
            )}
          </Suspense>
        )
      case 'redisKey':
        return (
          <RedisKeyView
            key={`${t.key}:${ns.database}:${keyspaceVersion}`}
            conn={nsConn}
            redisKey={t.redisKey}
            onRunCommand={openQuery}
            onDeleted={(deletedKey) => {
              dropTab(`rediskey:${deletedKey}`)
              setKeyspaceVersion((v) => v + 1)
            }}
          />
        )
      case 'history':
        return (
          <QueryHistoryView
            history={history}
            loading={historyLoading}
            onRefresh={loadHistory}
            onClear={clearHistoryAll}
            onDelete={deleteHistoryEntries}
          />
        )
      case 'schemaHistory':
        return (
          <SchemaHistoryView
            migrations={schemaMigrations}
            loading={schemaHistoryLoading}
            dialect={DIALECT[conn.type]}
            onRefresh={loadSchemaHistory}
            onRollback={setRollbackTarget}
          />
        )
      case 'workflow':
        return (
          <Suspense fallback={<div className="flex-1 p-8 text-center text-xs text-ink-faint">Loading workflow…</div>}>
            <WorkflowEditor key={t.key} conn={conn} workflowId={t.workflowId} />
          </Suspense>
        )
      case 'dashboard':
        return (
          <Suspense fallback={<div className="flex-1 p-8 text-center text-xs text-ink-faint">Loading dashboard…</div>}>
            <DashboardView
              key={`${t.key}:${ns.database}:${ns.schema}`}
              conn={nsConn}
              dashboardId={t.dashboardId}
              onRename={dashboardRenamed}
            />
          </Suspense>
        )
      case 'template': {
        const tpl = TEMPLATES.find((x) => x.id === t.templateId)
        return tpl ? (
          <TemplateDetailView
            key={t.key}
            template={tpl}
            connectionId={id}
            dbType={conn.type}
            onApplied={onTemplateApplied}
          />
        ) : (
          <div className="flex-1 p-8 text-center text-xs text-ink-faint">Template not found.</div>
        )
      }
      default:
        return null
    }
  }

  // Drag the divider to re-balance the two panes (20–80%). The ratio is a flex
  // grow factor, so the same handler works split left/right or top/bottom.
  const startResize = (e) => {
    e.preventDefault()
    const box = paneWrapRef.current?.getBoundingClientRect()
    if (!box) return
    const vertical = splitDir !== 'horizontal'
    const move = (ev) => {
      const r = vertical ? (ev.clientX - box.left) / box.width : (ev.clientY - box.top) / box.height
      setSplitRatio(Math.min(0.8, Math.max(0.2, r)))
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = vertical ? 'col-resize' : 'row-resize'
  }

  const renderPane = (p) => {
    const tab = tabInPane(p)
    return (
      <section
        key={p}
        onMouseDown={() => setFocusedPane(p)}
        style={splitDir ? { flexGrow: p === 0 ? splitRatio : 1 - splitRatio, flexBasis: 0 } : undefined}
        className={`flex min-h-0 min-w-0 flex-col ${splitDir ? '' : 'flex-1'}`}
      >
        <TabBar
          tabs={tabs.filter((t) => t.pane === p)}
          activeTab={activeByPane[p]}
          focused={focusedPane === p}
          onSelect={(key) => {
            setFocusedPane(p)
            setPaneActive(p, key)
          }}
          onClose={closeTab}
          onContextMenu={openTabMenu}
          onReorder={moveTab}
          onAdopt={(key, anchorKey) => adoptTab(p, key, anchorKey)}
          emptyHint={splitDir ? 'Drag a tab here' : 'No open tabs'}
          actions={
            p === 1 ? (
              <Tooltip label="Close split (keeps the tabs)" placement="bottom">
                <IconButton onClick={unsplit} aria-label="Close split">
                  <CloseIcon width={15} height={15} />
                </IconButton>
              </Tooltip>
            ) : (
              <div className="flex gap-1 max-[720px]:hidden">
                <Tooltip label={splitDir === 'vertical' ? 'Unsplit' : 'Split right'} placement="bottom">
                  <IconButton
                    active={splitDir === 'vertical'}
                    onClick={() => toggleSplit('vertical')}
                    aria-label="Split editor right"
                  >
                    <SplitVerticalIcon width={15} height={15} />
                  </IconButton>
                </Tooltip>
                <Tooltip label={splitDir === 'horizontal' ? 'Unsplit' : 'Split down'} placement="bottom">
                  <IconButton
                    active={splitDir === 'horizontal'}
                    onClick={() => toggleSplit('horizontal')}
                    aria-label="Split editor down"
                  >
                    <SplitHorizontalIcon width={15} height={15} />
                  </IconButton>
                </Tooltip>
              </div>
            )
          }
        />
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {tab ? (
            renderTabContent(tab)
          ) : splitDir ? (
            // A pane with nothing in it: compact, since it only owns half the area.
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="text-xs text-ink-faint">Drag a tab here, or start a new one.</p>
              <Button variant="ghost" icon={isRedis ? TerminalIcon : CodeIcon} onClick={() => openQuery()}>
                {isRedis ? 'New console' : 'New SQL query'}
              </Button>
            </div>
          ) : (
            emptyWorkspace
          )}
        </div>
      </section>
    )
  }

  return (
    <div className="flex h-screen bg-bg">
      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 hidden bg-black/50 max-[720px]:block"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Left region: icon rail + tables sidebar (slide-over drawer on mobile) */}
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
          onSchema={openSchemaEditorPage}
          onTemplates={() => selectPanel('templates')}
          onHome={() => navigate('/')}
          onLogout={logout}
          showSchema={!isRedis}
          browserIcon={isRedis ? KeyIcon : undefined}
          browserLabel={isRedis ? 'Keyspace' : undefined}
        />
        <div
          className={`shrink-0 overflow-hidden transition-[width] duration-200 ease-out ${
            tablesVisible ? 'w-[280px]' : 'w-0'
          }`}
        >
        <aside className="flex h-full min-h-0 w-[280px] flex-col border-r border-edge bg-panel">
        {/* Database / schema breadcrumb */}
        <div className="flex items-center gap-0.5 px-3 pt-3">
          <Select
            className="max-w-[110px] rounded px-1.5 py-0.5 text-[11px] font-medium text-ink hover:bg-elevated"
            value={ns.database || ''}
            onChange={changeDatabase}
            options={(namespaces.databases || []).map((d) => ({ value: d, label: d }))}
            placeholder="database"
          />
          {/* Redis has no schemas — only its numbered databases. */}
          {!isRedis && (
            <>
              <span className="text-[11px] text-ink-faint">/</span>
              <Select
                className="max-w-[110px] rounded px-1.5 py-0.5 text-[11px] font-medium text-ink hover:bg-elevated"
                value={ns.schema || ''}
                onChange={changeSchema}
                options={(namespaces.schemas || []).map((s) => ({ value: s, label: s }))}
                placeholder="schema"
              />
            </>
          )}
        </div>
        {panel === 'browser' && isRedis ? (
          <RedisKeyTree
            key={`${id}:${ns.database}:${keyspaceVersion}`}
            conn={nsConn}
            activeKey={current?.kind === 'redisKey' ? current.redisKey : null}
            onOpenKey={openRedisKey}
            onRunCommand={openQuery}
          />
        ) : panel === 'browser' ? (
        <>
        <div className="flex items-center justify-between px-4 pb-2.5 pt-4 text-[11px] font-semibold">
          <span className="text-xs">Tables</span>
          <div className="flex gap-1">
            <Tooltip label="Refresh" placement="bottom">
              <IconButton onClick={loadTables}>
                <RefreshIcon />
              </IconButton>
            </Tooltip>
            <Tooltip label="Search tables" placement="bottom">
              <IconButton
                active={searchOpen}
                onClick={() => {
                  if (searchOpen) setFilter('')
                  setSearchOpen((o) => !o)
                }}
              >
                <SearchIcon width={15} height={15} />
              </IconButton>
            </Tooltip>
            <Tooltip label="New folder" placement="bottom">
              <IconButton
                onClick={() => {
                  setOpenGroup('table')
                  setCreatingTableFolder({ parentId: null })
                }}
                aria-label="New table folder"
              >
                <FolderPlusIcon />
              </IconButton>
            </Tooltip>
            <Tooltip label="Create table" placement="bottom">
              <IconButton onClick={() => setCreatingTable(true)}>
                <PlusIcon width={14} height={14} />
              </IconButton>
            </Tooltip>
          </div>
        </div>

        <div className="px-3.5 pb-2">
          <Segmented
            value={tableSort}
            onChange={setTableSort}
            options={[
              { value: 'az', label: 'A–Z' },
              { value: 'za', label: 'Z–A' },
            ]}
          />
        </div>

        {searchOpen && (
          <SearchInput
            ref={searchRef}
            autoFocus
            className="mx-3.5 mb-2.5"
            placeholder="Search tables…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setFilter('')
                setSearchOpen(false)
              }
            }}
            inputClassName="!rounded-[9px] !text-xs"
          />
        )}

        <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-hidden px-2 pb-2 pt-1">
          {loading && <div className={`${centerState} text-xs`}>Loading…</div>}
          {!loading &&
            objectGroups.map((group) => (
              <div
                key={group.type}
                className={`flex min-h-0 flex-col ${openGroup === group.type ? 'flex-1' : 'shrink-0'}`}
              >
                {/* Accordion section header — always visible so you can jump to
                    Tables / Views / Functions; only the open section's list scrolls. */}
                <TextButton
                  tone="faint"
                  className="w-full shrink-0 rounded-[6px] px-1.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide hover:!text-ink-dim"
                  onClick={() => toggleGroup(group.type)}
                >
                  <ChevronRight
                    width={12}
                    height={12}
                    className={`transition-transform ${openGroup === group.type ? 'rotate-90' : ''}`}
                  />
                  {group.label} <span className="opacity-60">{group.items.length}</span>
                </TextButton>
                {openGroup === group.type && (
                  <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pr-0.5">
                    {group.type === 'table' ? (
                      <TableFolderList
                        connectionId={id}
                        folders={tableFolders}
                        tables={tableObjects}
                        searching={!!filter.trim()}
                        creating={creatingTableFolder}
                        onCreatingChange={setCreatingTableFolder}
                        onChange={setTableFolders}
                        onDelete={removeTableFolder}
                        renderTable={renderObject}
                      />
                    ) : (
                      group.items.map((o) => renderObject(o))
                    )}
                  </div>
                )}
              </div>
            ))}
          {!loading && objectGroups.length === 0 && (
            <div className={`${centerState} text-xs`}>No objects</div>
          )}
        </div>
        </>
        ) : panel === 'workflows' ? (
          <WorkflowsPanel
            workflows={workflows}
            folders={workflowFolders}
            activeId={current?.kind === 'workflow' ? current.workflowId : null}
            onOpen={openWorkflow}
            onNew={newWorkflow}
            onImport={() => workflowFileRef.current?.click()}
            onRename={renameWorkflow}
            onDelete={removeWorkflow}
            onCreateFolder={addWorkflowFolder}
            onRenameFolder={renameWorkflowFolderById}
            onDeleteFolder={removeWorkflowFolder}
            onMoveToFolder={moveWorkflowToFolder}
            onMoveFolder={moveWorkflowFolderToParent}
            onRefresh={() => {
              listWorkflows(id).then(setWorkflows)
              fetchWorkflowFolders(id).then(setWorkflowFolders)
            }}
          />
        ) : panel === 'dashboards' ? (
          <DashboardsPanel
            dashboards={dashboards}
            folders={dashboardFolders}
            activeId={current?.kind === 'dashboard' ? current.dashboardId : null}
            onOpen={openDashboard}
            onNew={newDashboard}
            onImport={() => dashboardFileRef.current?.click()}
            onRename={renameDashboard}
            onDelete={removeDashboard}
            onCreateFolder={addDashboardFolder}
            onRenameFolder={renameDashboardFolderById}
            onDeleteFolder={removeDashboardFolder}
            onMoveToFolder={moveDashboardToFolder}
            onMoveFolder={moveDashboardFolderToParent}
            onRefresh={() => {
              listDashboards(id).then(setDashboards)
              fetchDashboardFolders(id).then(setDashboardFolders)
            }}
          />
        ) : panel === 'templates' ? (
          <TemplatesPanel
            dbType={conn?.type}
            activeId={current?.kind === 'template' ? current.templateId : null}
            onOpen={openTemplate}
          />
        ) : (
          <SavedQueriesPanel
            saved={saved.filter((s) => s.kind !== 'schema')}
            folders={folders}
            onOpenSaved={openSavedQuery}
            onAnalyzeSaved={(s) => setAnalyzeSql(s.sql)}
            onAnalyzeFolder={(f, queries) => setAnalyzeFolder({ name: f.name, queries })}
            onRenameSaved={renameSavedQuery}
            onDeleteSaved={removeSaved}
            onCreateFolder={addFolder}
            onRenameFolder={renameFolderById}
            onDeleteFolder={removeFolder}
            onMoveToFolder={moveSavedToFolder}
            onMoveFolder={moveFolderToParent}
            onNew={() => openQuery()}
            onRefresh={() => {
              fetchSaved(id).then(setSaved)
              fetchFolders(id).then(setFolders)
            }}
          />
        )}
        </aside>
        </div>
      </div>

      {/* Main */}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-edge px-[18px] py-3 max-[720px]:px-3">
          <div className="hidden max-[720px]:block">
            <IconButton size="toolbar" className="!rounded-soft" onClick={() => setSidebarOpen(true)} aria-label="Open tables">
              <MenuIcon />
            </IconButton>
          </div>
          {/* One "New" menu for every creator — the same entries the command
              palette's Create group runs. */}
          <Popover
            width={230}
            trigger={({ open, toggle }) => (
              <Tooltip label="New…" placement="bottom">
                <IconButton size="toolbar" active={open} onClick={toggle} aria-label="Create new">
                  {isRedis ? <TerminalIcon width={16} height={16} /> : <CodeIcon width={16} height={16} />}
                </IconButton>
              </Tooltip>
            )}
          >
            {({ close }) => (
              <div className="p-1">
                {!isRedis && (
                  <MenuItem onClick={() => { setCreatingTable(true); close() }}>
                    <TableIcon width={14} height={14} /> New table
                  </MenuItem>
                )}
                <MenuItem onClick={() => { openQuery(); close() }}>
                  {isRedis ? <TerminalIcon width={14} height={14} /> : <CodeIcon width={14} height={14} />}
                  {isRedis ? 'New console' : 'New SQL query'}
                  <kbd className="ml-auto rounded-[5px] border border-edge bg-elevated px-1.5 py-px text-[11px] text-ink-faint">
                    {formatCombo(bindings['general.newTab'])}
                  </kbd>
                </MenuItem>
                <MenuItem onClick={() => { newWorkflow(); close() }}>
                  <WorkflowIcon width={14} height={14} /> New workflow
                </MenuItem>
                <MenuItem onClick={() => { newDashboard(); close() }}>
                  <GridIcon width={14} height={14} /> New dashboard
                </MenuItem>
              </div>
            )}
          </Popover>
          <input
            ref={dashboardFileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) importDashboardFile(f)
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
              if (f) importWorkflowFile(f)
              e.target.value = ''
            }}
          />
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="relative flex min-w-0 max-w-[560px] flex-1 items-center rounded-[10px] border border-edge bg-elevated py-[9px] pl-10 pr-3.5 text-left text-xs text-ink-faint transition-colors hover:border-edge-strong"
          >
            <SearchIcon width={16} height={16} className="absolute left-3.5 text-ink-faint" />
            <span>Search or run commands…</span>
            <kbd className="absolute right-3 rounded-[5px] border border-edge bg-card px-1.5 py-px text-[11px] text-ink-faint max-[720px]:hidden">
              {formatCombo(bindings['general.search'])}
            </kbd>
          </button>
          <div className="ml-auto flex items-center gap-2">
            {/* Environment + schema version now live in the bottom status bar. */}
            <div className="flex items-center gap-2 max-[720px]:hidden">
              <Tooltip label="Query history" placement="bottom">
                <IconButton size="toolbar" onClick={openHistory} aria-label="Query history">
                  <HistoryIcon width={16} height={16} />
                </IconButton>
              </Tooltip>
            </div>
            {/* Mobile overflow: the history/version entries hidden above. */}
            <div className="hidden max-[720px]:block">
              <Popover
                align="right"
                width={210}
                trigger={({ open, toggle }) => (
                  <IconButton size="toolbar" active={open} onClick={toggle} aria-label="More actions">
                    <MoreVerticalIcon width={16} height={16} />
                  </IconButton>
                )}
              >
                {({ close }) => (
                  <div className="p-1">
                    <MenuItem onClick={() => { openHistory(); close() }}>
                      <HistoryIcon width={14} height={14} /> Query history
                    </MenuItem>
                    <MenuItem onClick={() => { openSchemaHistory(); close() }}>
                      <TagIcon width={14} height={14} /> Schema history (v{conn.schemaVersion ?? 1})
                    </MenuItem>
                  </div>
                )}
              </Popover>
            </div>
            <Button variant="ghost" onClick={() => setChangesOpen(true)} title="View changes">
              <span className="max-[720px]:hidden">Changes</span>
              <span
                className={`rounded-[20px] px-[7px] text-xs ${
                  changes.length > 0 ? 'bg-green text-white' : 'bg-edge text-ink-faint'
                }`}
              >
                {changes.length}
              </span>
            </Button>
          </div>
        </div>

        {/* Editor area: one pane, or two with a draggable divider between. */}
        <div
          ref={paneWrapRef}
          className={`flex min-h-0 flex-1 ${splitDir === 'horizontal' ? 'flex-col' : 'flex-row max-[720px]:flex-col'}`}
        >
          {renderPane(0)}
          {splitDir && (
            <div
              onMouseDown={startResize}
              className={`relative z-10 shrink-0 bg-edge transition-colors hover:bg-green ${
                splitDir === 'horizontal' ? 'h-px cursor-row-resize' : 'w-px cursor-col-resize'
              }`}
            >
              {/* Widen the grab area without widening the line itself. */}
              <span
                className={`absolute ${
                  splitDir === 'horizontal' ? '-inset-y-1.5 inset-x-0' : '-inset-x-1.5 inset-y-0'
                }`}
              />
            </div>
          )}
          {splitDir && renderPane(1)}
        </div>

        {/* Status bar — bottom of the main area only; the rail and sidebar keep
            their full height. */}
        <StatusBar
          conn={conn}
          database={ns.database}
          schema={ns.schema}
          onSchemaHistory={openSchemaHistory}
        />
      </main>

      {tabMenu && (
        <ContextMenu x={tabMenu.x} y={tabMenu.y} width={190} onClose={() => setTabMenu(null)}>
          <MenuItem
            onClick={() => {
              removeTab(tabMenu.key)
              setTabMenu(null)
            }}
          >
            Close
          </MenuItem>
          <MenuItem
            disabled={tabs.filter((t) => t.pane === paneOf(tabMenu.key)).length < 2}
            onClick={() => {
              closeOtherTabs(tabMenu.key)
              setTabMenu(null)
            }}
          >
            Close other tabs
          </MenuItem>
          <MenuItem
            disabled={(() => {
              const own = tabs.filter((t) => t.pane === paneOf(tabMenu.key))
              return own.findIndex((t) => t.key === tabMenu.key) === own.length - 1
            })()}
            onClick={() => {
              closeTabsToRight(tabMenu.key)
              setTabMenu(null)
            }}
          >
            Close tabs to the right
          </MenuItem>
          <MenuItem
            onClick={() => {
              closeAllTabs(paneOf(tabMenu.key))
              setTabMenu(null)
            }}
          >
            Close all tabs
          </MenuItem>
          <div className="my-1 h-px bg-edge" />
          {/* Splitting is just "move this tab to the other pane" — which side it
              lands on is the split's orientation. */}
          {paneOf(tabMenu.key) === 1 || splitDir ? (
            <MenuItem
              onClick={() => {
                moveTabToPane(tabMenu.key, paneOf(tabMenu.key) === 1 ? 0 : 1)
                setTabMenu(null)
              }}
            >
              <SplitVerticalIcon width={14} height={14} /> Move to other group
            </MenuItem>
          ) : (
            <>
              <MenuItem
                onClick={() => {
                  moveTabToPane(tabMenu.key, 1, 'vertical')
                  setTabMenu(null)
                }}
              >
                <SplitVerticalIcon width={14} height={14} /> Split right
              </MenuItem>
              <MenuItem
                onClick={() => {
                  moveTabToPane(tabMenu.key, 1, 'horizontal')
                  setTabMenu(null)
                }}
              >
                <SplitHorizontalIcon width={14} height={14} /> Split down
              </MenuItem>
            </>
          )}
        </ContextMenu>
      )}

      {creatingTable && (
        <CreateTablePanel
          conn={nsConn}
          initialTable={creatingTable?.table}
          onClose={() => setCreatingTable(false)}
          onStage={stageTableChanges}
        />
      )}

      {analyzeSql != null && conn && (
        <AnalyzePanel
          conn={nsConn}
          dialect={DIALECT[conn.type]}
          sql={analyzeSql}
          onClose={() => setAnalyzeSql(null)}
          onOpenInEditor={(ddl) => {
            setAnalyzeSql(null)
            openQuery(ddl)
          }}
        />
      )}

      {analyzeFolder != null && conn && (
        <AnalyzeFolderPanel
          conn={nsConn}
          dialect={DIALECT[conn.type]}
          folderName={analyzeFolder.name}
          queries={analyzeFolder.queries}
          onClose={() => setAnalyzeFolder(null)}
          onOpenInEditor={(ddl) => {
            setAnalyzeFolder(null)
            openQuery(ddl)
          }}
        />
      )}

      {savingQuery != null && (
        <SaveQueryPanel
          sql={savingQuery}
          defaultName={`Query ${saved.length + 1}`}
          onClose={() => setSavingQuery(null)}
          onSave={commitSaveQuery}
        />
      )}

      {changesOpen && (
        <ChangesPanel
          changes={changes}
          committing={committing}
          onCommit={commitChanges}
          onClear={() => setChanges([])}
          onClose={() => setChangesOpen(false)}
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
          title={tableAction.mode === 'empty' ? `Empty table "${tableAction.table}"?` : `Delete table "${tableAction.table}"?`}
          message={
            tableAction.mode === 'empty'
              ? `This deletes every row in "${tableAction.table}". The data cannot be recovered.${directExecute ? ' It runs immediately.' : ' It will be added to staged changes to commit.'}`
              : `This drops the table "${tableAction.table}" and all of its data.${directExecute ? ' It runs immediately.' : ' It will be added to staged changes to commit.'}`
          }
          confirmLabel={tableAction.mode === 'empty' ? 'Empty table' : 'Delete table'}
          cancelLabel="Cancel"
          danger
          onConfirm={() => {
            if (tableAction.mode === 'empty') emptyTable(tableAction.table)
            else deleteTable(tableAction.table)
            setTableAction(null)
          }}
          onCancel={() => setTableAction(null)}
        />
      )}

      {rollbackTarget && (
        <ConfirmDialog
          title={`Roll back to v${rollbackTarget.version}?`}
          message={`This runs the down SQL for every version newer than v${rollbackTarget.version} against your database, marks them rolled back, and resets the schema version to v${rollbackTarget.version}. This cannot be undone automatically.`}
          confirmLabel={rollingBack ? 'Rolling back…' : 'Roll back'}
          cancelLabel="Cancel"
          danger
          onConfirm={() => !rollingBack && rollbackMigration(rollbackTarget)}
          onCancel={() => !rollingBack && setRollbackTarget(null)}
        />
      )}

      {/* Database unreachable — offer to retry (with a spinner) or leave. */}
      {connError && (
        <div className="fixed inset-0 z-[60] flex animate-fade items-center justify-center bg-black/60 p-6 backdrop-blur-[3px]">
          <div className="w-full max-w-[400px] animate-pop rounded-[16px] border border-edge-strong bg-panel p-5">
            <div className="flex items-center gap-2.5">
              {reconnecting && (
                <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-green/30 border-t-green" />
              )}
              <h3 className="text-sm font-bold text-ink">{reconnecting ? 'Reconnecting…' : 'Connection lost'}</h3>
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-ink-dim">
              {reconnecting
                ? `Trying to reach ${conn?.name || 'the database'}…`
                : `Couldn't connect to ${conn?.name || 'the database'}. ${connError}`}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="subtle" size="sm" disabled={reconnecting} onClick={() => navigate('/')}>
                Back to home
              </Button>
              <Button variant="primary" size="sm" disabled={reconnecting} onClick={reconnect}>
                {reconnecting ? (
                  <>
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                    Reconnecting
                  </>
                ) : (
                  'Reconnect'
                )}
              </Button>
            </div>
          </div>
        </div>
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
