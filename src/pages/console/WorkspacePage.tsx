import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '@/features/auth'
import { useConnections } from '@/features/connections'
import { useToast } from '@/shared/ui/feedback/Toast'
import Select from '@/shared/ui/form/Select'
import Button from '@/shared/ui/buttons/Button'
import ConfirmDialog from '@/shared/ui/feedback/ConfirmDialog'
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
} from '@/features/workspace/lib/savedQueries'
import { draftToItems } from '@/shared/lib/schemaDraft'
import SearchInput from '@/shared/ui/form/SearchInput'
import TableView from '@/features/workspace/components/TableView'
import CreateTablePanel from '@/features/schema-designer/components/CreateTablePanel'
import SchemaPanel from '@/features/schema-designer/components/SchemaPanel'

// Lazy — pulls in the (heavy) CodeMirror editor only when a query tab opens.
const QueryEditor = lazy(() => import('@/features/workspace/components/QueryEditor'))
// Lazy — React Flow is heavy; only load when the schema editor opens.
const SchemaEditor = lazy(() => import('@/features/schema-designer/components/SchemaEditor'))
// Lazy — React Flow again; only load when a workflow tab opens.
const WorkflowEditor = lazy(() => import('@/features/workflow/components/WorkflowEditor'))
import IconRail from '@/features/workspace/components/IconRail'
import { formatCombo, useKeymap, useShortcut } from '@/features/keymap'
import SavedQueriesPanel from '@/features/workspace/components/SavedQueriesPanel'
import { WorkflowsPanel, listWorkflows, createWorkflow, deleteWorkflow, updateWorkflow } from '@/features/workflow'
import QueryHistoryView from '@/features/workspace/components/QueryHistoryView'
import SchemaHistoryView from '@/features/schema-designer/components/SchemaHistoryView'
import { fetchHistory, recordHistory, clearHistory, deleteHistory } from '@/features/workspace/lib/queryHistory'
import SaveQueryPanel from '@/shared/ui/SaveQueryPanel'
import ChangesPanel from '@/features/workspace/components/ChangesPanel'
import SchemaView from '@/features/workspace/components/SchemaView'
import FunctionView from '@/features/workspace/components/FunctionView'
import Segmented from '@/shared/ui/navigation/Segmented'
import Tooltip from '@/shared/ui/overlay/Tooltip'
import Popover from '@/shared/ui/overlay/Popover'
import IconButton from '@/shared/ui/buttons/IconButton'
import MenuItem from '@/shared/ui/navigation/MenuItem'
import TextButton from '@/shared/ui/buttons/TextButton'
import {
  ChevronRight,
  CloseIcon,
  CodeIcon,
  ColumnsIcon,
  DiagramIcon,
  EditIcon,
  EyeIcon,
  HistoryIcon,
  MenuIcon,
  MoreVerticalIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  TableIcon,
  TrashIcon,
  WorkflowIcon,
} from '@/shared/ui/icons'

const kbd =
  'inline-flex min-w-[20px] items-center justify-center rounded-[5px] border border-edge bg-elevated px-1.5 py-0.5 text-[11px] text-ink-dim'

const DIALECT = { postgresql: 'PostgreSQL', sqlite: 'SQLite', redis: 'Redis' }
let queryCounter = 0

const centerState =
  'flex h-full flex-col items-center justify-center gap-4 text-ink-faint'

export default function Workspace() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const toast = useToast()
  const { connections, patchLocalConnection } = useConnections()
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
  const [tabs, setTabs] = useState([])
  const [activeTab, setActiveTab] = useState(null)
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
  const [tabMenu, setTabMenu] = useState(null) // { x, y, key } | null
  const [savingQuery, setSavingQuery] = useState(null) // sql string being saved | null
  const [changes, setChanges] = useState([]) // staged (uncommitted) SQL mutations
  const [changesOpen, setChangesOpen] = useState(false)
  const [schemaPending, setSchemaPending] = useState({}) // per schema-editor tab: key -> items[]
  const [queryState, setQueryState] = useState({}) // per query tab: key -> { sql, result, error, elapsedMs }
  const [closingTab, setClosingTab] = useState(null) // tab key awaiting close confirmation
  const [pendingConn, setPendingConn] = useState(null) // connection id awaiting switch confirmation
  const [committing, setCommitting] = useState(false)
  const [dataVersion, setDataVersion] = useState(0) // bump to force table reloads
  const [sidebarOpen, setSidebarOpen] = useState(false) // mobile drawer
  const [openGroup, setOpenGroup] = useState('table') // accordion: the one expanded browser section
  const [tablesVisible, setTablesVisible] = useState(true) // left panel visible
  const [panel, setPanel] = useState('browser') // 'browser' | 'queries' | 'workflows'
  const [searchOpen, setSearchOpen] = useState(false) // table search toggle
  const [tableSort, setTableSort] = useState('az') // 'az' | 'za'
  const searchRef = useRef(null)
  const autoOpenedFor = useRef(null) // connection id we've already auto-opened a tab for

  // Switching connections is destructive: tabs, staged changes and per-tab
  // editor state are all scoped to the current connection. Ask first, then wipe
  // that state and navigate. If there's nothing to lose, switch straight away.
  const requestConnSwitch = (cid) => {
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
    setActiveTab(null)
    setChanges([])
    setQueryState({})
    setSchemaPending({})
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

  // Load this connection's saved queries, folders and workflows from the backend.
  useEffect(() => {
    let alive = true
    fetchSaved(id).then((list) => alive && setSaved(list))
    fetchFolders(id).then((list) => alive && setFolders(list))
    listWorkflows(id).then((list) => alive && setWorkflows(list))
    return () => {
      alive = false
    }
  }, [id])

  // Esc closes the mobile slide-over sidebar drawer while it's open.
  useEffect(() => {
    if (!sidebarOpen) return
    const onKey = (e) => e.key === 'Escape' && setSidebarOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sidebarOpen])

  useEffect(() => {
    if (!tabMenu) return
    const close = () => setTabMenu(null)
    const onKey = (e) => e.key === 'Escape' && close()
    window.addEventListener('click', close)
    window.addEventListener('contextmenu', close)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('contextmenu', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [tabMenu])

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

  const openTable = (table) => {
    const key = `table:${table}`
    setTabs((prev) => (prev.some((t) => t.key === key) ? prev : [...prev, { key, kind: 'table', table, title: table }]))
    setActiveTab(key)
    setSidebarOpen(false)
  }

  // FK drill-down: show the referenced table filtered by column = value. Reuses
  // the table's existing tab if one is open (re-filtering it) — including when a
  // different FK points at the same table — otherwise opens a new table tab.
  const openTableFiltered = (table, column, value) => {
    const key = `table:${table}`
    const initialFilter = { col: column, value }
    setTabs((prev) =>
      prev.some((t) => t.key === key)
        ? prev.map((t) => (t.key === key ? { ...t, title: table, initialFilter } : t))
        : [...prev, { key, kind: 'table', table, title: table, initialFilter }]
    )
    setActiveTab(key)
    setSidebarOpen(false)
  }

  const openQuery = (sql?) => {
    queryCounter += 1
    const key = `query:${queryCounter}`
    const initialSql = typeof sql === 'string' ? sql : undefined
    setTabs((prev) => [...prev, { key, kind: 'query', title: `Query ${queryCounter}`, sql: initialSql }])
    setActiveTab(key)
    setSidebarOpen(false)
  }

  // Open a saved query in its own identity-bearing tab: title tracks the saved
  // query's name (and stays in sync on rename), focus if already open.
  const openSavedQuery = (q) => {
    const key = `query:saved:${q.id}`
    setTabs((prev) =>
      prev.some((t) => t.key === key) ? prev : [...prev, { key, kind: 'query', title: q.name, sql: q.sql, savedId: q.id }]
    )
    setActiveTab(key)
    setSidebarOpen(false)
  }

  const openSchema = (table) => {
    const key = `schema:${table}`
    setTabs((prev) =>
      prev.some((t) => t.key === key) ? prev : [...prev, { key, kind: 'schema', table, title: `${table} · schema` }]
    )
    setActiveTab(key)
    setSidebarOpen(false)
  }

  const openFunction = (name) => {
    const key = `function:${name}`
    setTabs((prev) => (prev.some((t) => t.key === key) ? prev : [...prev, { key, kind: 'function', name, title: name }]))
    setActiveTab(key)
    setSidebarOpen(false)
  }

  // Accordion: opening a section collapses the others; clicking the open one closes it.
  const toggleGroup = (type) => setOpenGroup((prev) => (prev === type ? null : type))

  // Generic "Schema editor" scratch tab — focus it if already open.
  const openSchemaEditor = () => {
    const key = 'schema-editor'
    setTabs((prev) => (prev.some((t) => t.key === key) ? prev : [...prev, { key, kind: 'schemaEditor', title: 'Schema Editor' }]))
    setActiveTab(key)
    setSidebarOpen(false)
  }

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
    toast.info(`Added empty-table to changes — commit to apply.`)
  }
  // Snapshot the table's columns before staging the drop so we can offer a
  // best-effort rollback (a CREATE TABLE that reconstructs it).
  const deleteTable = async (table) => {
    const { rollbackSql, reversible } = await buildDropTableRollback(nsConn, table)
    addChange({ kind: 'delete', label: `Drop table ${table}`, sql: `DROP TABLE "${table}"`, table, ddl: true, reversible, rollbackSql })
    toast.info(`Added drop-table to changes — commit to apply.`)
  }

  const addChange = (c) =>
    setChanges((prev) => [{ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ts: Date.now(), ...c }, ...prev])

  // Execute every staged change in order (oldest first). Stop at the first
  // failure, keeping it (and the rest) in the list so they can be retried.
  const commitChanges = async () => {
    if (!changes.length || committing) return
    setCommitting(true)
    const ordered = [...changes].reverse()
    const remaining = []
    const succeeded = []
    let failure = null
    for (const ch of ordered) {
      if (failure) {
        remaining.push(ch)
        continue
      }
      const res = await runQuery(nsConn, ch.sql)
      if (res?.error) {
        failure = res.error
        remaining.push(ch)
      } else {
        succeeded.push(ch)
      }
    }
    setCommitting(false)
    setChanges(remaining.reverse())
    setDataVersion((v) => v + 1)
    loadTables() // pick up created/dropped tables in the sidebar

    // One schema version bump per commit, covering only the DDL that actually
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

    if (failure) {
      toast.error(`Committed ${succeeded.length}, then failed: ${failure}`)
    } else {
      toast.success(`Committed ${succeeded.length} change${succeeded.length > 1 ? 's' : ''}.`)
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
  const openHistory = () => {
    const key = 'history'
    setTabs((prev) => (prev.some((t) => t.key === key) ? prev : [...prev, { key, kind: 'history', title: 'Query history' }]))
    setActiveTab(key)
    setSidebarOpen(false)
  }

  // ---- Schema history (migration audit trail; opened from the version badge) ----
  const loadSchemaHistory = async () => {
    setSchemaHistoryLoading(true)
    try {
      setSchemaMigrations(await listSchemaMigrations(nsConn))
    } finally {
      setSchemaHistoryLoading(false)
    }
  }
  const openSchemaHistory = () => {
    const key = 'schema-history'
    setTabs((prev) =>
      prev.some((t) => t.key === key) ? prev : [...prev, { key, kind: 'schemaHistory', title: 'Schema history' }]
    )
    setActiveTab(key)
    setSidebarOpen(false)
  }
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
  const openWorkflow = (w) => {
    const key = `workflow:${w.id}`
    setTabs((prev) =>
      prev.some((t) => t.key === key) ? prev : [...prev, { key, kind: 'workflow', workflowId: w.id, title: w.name }]
    )
    setActiveTab(key)
    setSidebarOpen(false)
  }
  const newWorkflow = async () => {
    try {
      const wf = await createWorkflow(id, `Workflow ${workflows.length + 1}`)
      setWorkflows((prev) => [{ id: wf.id, name: wf.name, ts: Date.now(), protected: false, scheduleEnabled: false }, ...prev])
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
  const addFolder = async (name) => {
    const next = name?.trim()
    if (!next) return
    try {
      const folder = await createFolder(id, next)
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
    // Detach the folder's queries back to the root locally, mirroring the server.
    setFolders((prev) => prev.filter((f) => f.id !== fid))
    setSaved((prev) => prev.map((s) => (s.folderId === fid ? { ...s, folderId: null } : s)))
    try {
      await deleteFolder(id, fid)
    } catch (e) {
      toast.error(`Delete failed: ${e.message}`)
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
  const rollbackFor = async (sql, table, mode) => {
    if (mode === 'delete') return buildDropTableRollback(nsConn, table)
    if (mode === 'edit') return { rollbackSql: rollbackForAddColumn(sql, table), reversible: true }
    return { rollbackSql: rollbackForCreateTable(table), reversible: true }
  }

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

  // Label + Changes-panel "kind" for a staged schema-editor item, by mode.
  const schemaItemMeta = (mode, table) => {
    switch (mode) {
      case 'edit': return { kind: 'update', label: `Alter table ${table}` }
      case 'delete': return { kind: 'delete', label: `Drop table ${table}` }
      case 'fk-add': return { kind: 'update', label: `Add foreign key on ${table}` }
      case 'fk-drop': return { kind: 'update', label: `Drop foreign key on ${table}` }
      case 'fk-edit': return { kind: 'update', label: `Update foreign key on ${table}` }
      default: return { kind: 'create', label: `Create table ${table}` }
    }
  }

  // Schema editor "Stage commit" — push its collected pending items into Changes.
  // FK-mode edits (fk-add/fk-drop/fk-edit) carry their own rollback SQL from
  // SchemaEditor, since they're diagram-driven constraint statements the
  // generic column-add/create-table rollback builders can't parse. `delete`
  // (drop table from the canvas) needs a live column snapshot to build its
  // rollback when one isn't already provided, so this staging step is async.
  const stageSchemaItems = async (items) => {
    for (const i of items) {
      const { rollbackSql, reversible } =
        i.rollbackSql !== undefined ? { rollbackSql: i.rollbackSql, reversible: i.rollbackSql != null } : await rollbackFor(i.sql, i.table, i.mode)
      const { kind, label } = schemaItemMeta(i.mode, i.table)
      addChange({ kind, label, sql: i.sql, table: i.table, ddl: true, reversible, rollbackSql })
    }
  }

  // Schema editor "Save as draft" — store the SQL in Saved Queries (schema kind).
  const saveSchemaDraft = async (items, name) => {
    const tabKey = activeTab // the schema-editor tab that triggered the save
    try {
      const entry = await createSaved(id, { name, sql: items.map((i) => i.sql).join('\n'), kind: 'schema' })
      setSaved((prev) => [entry, ...prev])
      // Link the active schema-editor tab to the saved draft: re-key it so it
      // dedupes with the draft, its title tracks the name, and it keeps its
      // pending items as the draft's working state.
      const newKey = `schema:${entry.id}`
      setSchemaPending((p) => {
        const n = { ...p, [newKey]: items }
        if (tabKey && tabKey !== newKey) delete n[tabKey]
        return n
      })
      setTabs((prev) => prev.map((t) => (t.key === tabKey ? { ...t, key: newKey, title: name } : t)))
      setActiveTab((cur) => (cur === tabKey ? newKey : cur))
      toast.success(`Saved draft “${name}”.`)
    } catch (e) {
      toast.error(`Save failed: ${e.message}`)
    }
  }

  // Open a saved schema draft in its own tab (focus if already open; keep its edits).
  const openSchemaDraft = (q) => {
    const key = `schema:${q.id}`
    setTabs((prev) => {
      if (prev.some((t) => t.key === key)) return prev
      // Seed this tab's pending changes from the draft, once.
      setSchemaPending((p) => ({ ...p, [key]: draftToItems(q.sql) }))
      return [...prev, { key, kind: 'schemaEditor', title: q.name }]
    })
    setActiveTab(key)
    setSidebarOpen(false)
  }

  const renameSavedQuery = async (sid, name) => {
    const next = name?.trim()
    if (!next) return
    setSaved((prev) => prev.map((s) => (s.id === sid ? { ...s, name: next } : s)))
    // Keep the matching open schema-editor / saved-query tab's title in sync.
    setTabs((prev) =>
      prev.map((t) => (t.key === `schema:${sid}` || t.key === `query:saved:${sid}` ? { ...t, title: next } : t))
    )
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

  // Actually drop a tab (and its pending schema changes / query state).
  const dropTab = (key) => {
    if (schemaPending[key]) setSchemaPending((p) => { const n = { ...p }; delete n[key]; return n })
    if (queryState[key]) setQueryState((p) => { const n = { ...p }; delete n[key]; return n })
    setTabs((prev) => {
      const next = prev.filter((t) => t.key !== key)
      if (activeTab === key) setActiveTab(next.length ? next[next.length - 1].key : null)
      return next
    })
  }

  const removeTab = (key) => {
    // Confirm before closing a schema-editor tab that has unsaved changes.
    if (schemaPending[key]?.length) setClosingTab(key)
    else dropTab(key)
  }

  const closeTab = (e, key) => {
    e.stopPropagation()
    removeTab(key)
  }

  const closeTabsToRight = (key) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.key === key)
      if (idx === -1) return prev
      const next = prev.slice(0, idx + 1)
      if (!next.some((t) => t.key === activeTab)) setActiveTab(key)
      return next
    })
  }

  const closeAllTabs = () => {
    setTabs([])
    setActiveTab(null)
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
  ].filter((g) => g.items.length > 0)

  const current = tabs.find((t) => t.key === activeTab)

  useShortcut('general.search', () => {
    setPanel('browser')
    setTablesVisible(true)
    setSearchOpen(true)
    setTimeout(() => searchRef.current?.focus(), 0)
  })
  useShortcut('general.newTab', () => openQuery())
  useShortcut('workspace.panelBrowser', () => selectPanel('browser'))
  useShortcut('workspace.panelQueries', () => selectPanel('queries'))
  useShortcut('workspace.panelWorkflows', () => selectPanel('workflows'))
  useShortcut('workspace.panelSchema', () => selectPanel('schema'))
  useShortcut('workspace.toggleSidebar', toggleSidebar)
  useShortcut('workspace.commitChanges', commitChanges)

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
        className={`z-40 flex shrink-0 max-[720px]:fixed max-[720px]:inset-y-0 max-[720px]:left-0 max-[720px]:shadow-[8px_0_30px_-10px_rgba(0,0,0,0.7)] max-[720px]:transition-transform max-[720px]:duration-200 ${
          sidebarOpen ? 'max-[720px]:translate-x-0' : 'max-[720px]:-translate-x-full'
        }`}
      >
        <IconRail
          user={user}
          connections={connections}
          currentId={id}
          onSelectConnection={requestConnSwitch}
          active={tablesVisible ? panel : ''}
          onBrowser={() => selectPanel('browser')}
          onQueries={() => selectPanel('queries')}
          onWorkflows={() => selectPanel('workflows')}
          onSchema={() => selectPanel('schema')}
          onHome={() => navigate('/')}
          onLogout={logout}
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
          <span className="text-[11px] text-ink-faint">/</span>
          <Select
            className="max-w-[110px] rounded px-1.5 py-0.5 text-[11px] font-medium text-ink hover:bg-elevated"
            value={ns.schema || ''}
            onChange={changeSchema}
            options={(namespaces.schemas || []).map((s) => ({ value: s, label: s }))}
            placeholder="schema"
          />
        </div>
        {panel === 'browser' ? (
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
                    {group.items.map((obj) => {
                  const active =
                    obj.type === 'function'
                      ? current?.kind === 'function' && current.name === obj.name
                      : current?.kind === 'table' && current.table === obj.name
                  const Icon = obj.type === 'view' ? EyeIcon : obj.type === 'function' ? CodeIcon : TableIcon
                  const onOpen = obj.type === 'function' ? () => openFunction(obj.name) : () => openTable(obj.name)
                  return (
                    <div
                      key={`${obj.type}:${obj.name}`}
                      onClick={onOpen}
                      className={`group flex w-full cursor-pointer items-center gap-2 rounded-[7px] px-2.5 py-1.5 text-left text-xs ${
                        active ? 'bg-card-hover text-ink' : 'text-ink-dim hover:bg-elevated hover:text-ink'
                      }`}
                    >
                      <Icon className={`flex-shrink-0 ${active ? 'text-ink' : 'text-ink-faint'}`} />
                      <span
                        className="flex-1 truncate"
                        title={obj.type === 'function' && obj.detail ? `${obj.name}(${obj.detail})` : obj.name}
                      >
                        {obj.name}
                      </span>
                      <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                        <Popover
                          align="right"
                          width={210}
                          trigger={({ open, toggle }) => (
                            <IconButton
                              size="sm"
                              active={open}
                              onClick={toggle}
                              aria-label={`${group.label} actions`}
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
                                  <MenuItem danger onClick={() => { emptyTable(obj.name); close() }}>
                                    <TrashIcon width={14} height={14} /> Empty Table
                                  </MenuItem>
                                  <MenuItem danger onClick={() => { deleteTable(obj.name); close() }}>
                                    <TrashIcon width={14} height={14} /> Delete Table
                                  </MenuItem>
                                </>
                              )}
                            </div>
                          )}
                        </Popover>
                      </div>
                    </div>
                  )
                    })}
                  </div>
                )}
              </div>
            ))}
          {!loading && visibleObjects.length === 0 && (
            <div className={`${centerState} text-xs`}>No objects</div>
          )}
        </div>
        </>
        ) : panel === 'workflows' ? (
          <WorkflowsPanel
            workflows={workflows}
            activeId={current?.kind === 'workflow' ? current.workflowId : null}
            onOpen={openWorkflow}
            onNew={newWorkflow}
            onRename={renameWorkflow}
            onDelete={removeWorkflow}
            onRefresh={() => listWorkflows(id).then(setWorkflows)}
          />
        ) : panel === 'schema' ? (
          <SchemaPanel
            drafts={saved.filter((s) => s.kind === 'schema')}
            onOpenDraft={openSchemaDraft}
            onNewSchema={openSchemaEditor}
            onRenameDraft={renameSavedQuery}
            onDeleteDraft={removeSaved}
            onRefreshDrafts={() => fetchSaved(id).then(setSaved)}
          />
        ) : (
          <SavedQueriesPanel
            saved={saved.filter((s) => s.kind !== 'schema')}
            folders={folders}
            onOpenSaved={openSavedQuery}
            onRenameSaved={renameSavedQuery}
            onDeleteSaved={removeSaved}
            onCreateFolder={addFolder}
            onRenameFolder={renameFolderById}
            onDeleteFolder={removeFolder}
            onMoveToFolder={moveSavedToFolder}
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
          <Tooltip label="New SQL query" placement="bottom">
            <IconButton size="toolbar" onClick={() => openQuery()} aria-label="New SQL query">
              <CodeIcon width={16} height={16} />
            </IconButton>
          </Tooltip>
          <div className="relative flex max-w-[560px] flex-1 items-center">
            <SearchIcon width={16} height={16} className="absolute left-3.5 text-ink-faint" />
            <input
              placeholder="Search or run commands…"
              className="w-full rounded-[10px] border border-edge bg-elevated py-[9px] pl-10 pr-3.5 text-xs text-ink outline-none"
            />
            <kbd className="absolute right-3 rounded-[5px] border border-edge bg-card px-1.5 py-px text-[11px] text-ink-faint">⌘K</kbd>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Tooltip label="Schema version history" placement="bottom">
              <button
                type="button"
                onClick={openSchemaHistory}
                className="rounded-[20px] border border-edge bg-elevated px-[9px] py-1 text-[11px] font-medium text-ink-faint transition-colors hover:border-edge-strong hover:text-ink"
              >
                v{conn.schemaVersion ?? 1}
              </button>
            </Tooltip>
            <Tooltip label="Query history" placement="bottom">
              <IconButton size="toolbar" onClick={openHistory} aria-label="Query history">
                <HistoryIcon width={16} height={16} />
              </IconButton>
            </Tooltip>
            <Button variant="ghost" onClick={() => setChangesOpen(true)} title="View changes">
              Changes
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

        <div className="flex items-stretch gap-1 overflow-x-auto border-b border-edge bg-panel px-1.5 pt-1.5">
          {tabs.map((t) => {
            const active = activeTab === t.key
            return (
              <div
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                onContextMenu={(e) => openTabMenu(e, t.key)}
                className={`group/tab relative flex cursor-pointer items-center gap-2.5 whitespace-nowrap rounded-t-[8px] px-3.5 py-2.5 text-xs transition-colors ${
                  active
                    ? 'bg-elevated font-medium text-ink'
                    : 'text-ink-dim hover:bg-elevated/40 hover:text-ink'
                }`}
              >
                {active && <span className="absolute inset-x-0 bottom-0 h-[2px] bg-green" />}
                {t.kind === 'query' ? (
                  <CodeIcon className={active ? 'text-ink' : 'text-ink-faint'} />
                ) : t.kind === 'schema' ? (
                  <ColumnsIcon className={active ? 'text-ink' : 'text-ink-faint'} />
                ) : t.kind === 'schemaEditor' ? (
                  <DiagramIcon className={active ? 'text-ink' : 'text-ink-faint'} />
                ) : t.kind === 'history' ? (
                  <HistoryIcon className={active ? 'text-ink' : 'text-ink-faint'} />
                ) : t.kind === 'schemaHistory' ? (
                  <HistoryIcon className={active ? 'text-ink' : 'text-ink-faint'} />
                ) : t.kind === 'function' ? (
                  <CodeIcon className={active ? 'text-ink' : 'text-ink-faint'} />
                ) : t.kind === 'workflow' ? (
                  <WorkflowIcon className={active ? 'text-ink' : 'text-ink-faint'} />
                ) : (
                  <TableIcon className={active ? 'text-ink' : 'text-ink-faint'} />
                )}
                <span>{t.title}</span>
                <IconButton
                  size="xs"
                  className="shrink-0 !text-ink-faint opacity-70 group-hover/tab:opacity-100"
                  onClick={(e) => closeTab(e, t.key)}
                  aria-label="Close tab"
                >
                  <CloseIcon width={13} height={13} />
                </IconButton>
              </div>
            )
          })}
          {tabs.length === 0 && <div className="px-3 py-2.5 text-[11px] text-ink-faint">No open tabs</div>}
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          {conn && current?.kind === 'table' && (
            <TableView
              key={`${current.key}:${dataVersion}:${ns.database}:${ns.schema}`}
              conn={nsConn}
              table={current.table}
              onChange={addChange}
              onOpenReference={openTableFiltered}
              initialFilter={current.initialFilter}
            />
          )}
          {conn && current?.kind === 'schema' && (
            <SchemaView key={`${current.key}:${dataVersion}:${ns.database}:${ns.schema}`} conn={nsConn} table={current.table} />
          )}
          {conn && current?.kind === 'function' && (
            <FunctionView key={`${current.key}:${ns.database}:${ns.schema}`} conn={nsConn} name={current.name} />
          )}
          {conn && current?.kind === 'schemaEditor' && (
            <Suspense fallback={<div className="flex-1 p-8 text-center text-xs text-ink-faint">Loading schema…</div>}>
              <SchemaEditor
                key={`${current.key}:${dataVersion}:${ns.database}:${ns.schema}`}
                conn={nsConn}
                changes={changes}
                pending={schemaPending[current.key] || []}
                onPendingChange={(items) => setSchemaPending((p) => ({ ...p, [current.key]: items }))}
                onStageItems={stageSchemaItems}
                onSaveDraft={saveSchemaDraft}
                onOpenTable={openTable}
                onOpenSchema={openSchema}
              />
            </Suspense>
          )}
          {conn && current?.kind === 'query' && (
            <Suspense fallback={<div className="flex-1 p-8 text-center text-xs text-ink-faint">Loading editor…</div>}>
              <QueryEditor
                key={current.key}
                tabKey={current.key}
                conn={nsConn}
                dialect={DIALECT[conn.type]}
                initialSql={current.sql ?? ''}
                persisted={queryState[current.key]}
                onPersist={persistQueryState}
                onRan={recordRun}
                onSave={saveQuery}
              />
            </Suspense>
          )}
          {conn && current?.kind === 'history' && (
            <QueryHistoryView
              history={history}
              loading={historyLoading}
              onRefresh={loadHistory}
              onClear={clearHistoryAll}
              onDelete={deleteHistoryEntries}
            />
          )}
          {conn && current?.kind === 'schemaHistory' && (
            <SchemaHistoryView
              migrations={schemaMigrations}
              loading={schemaHistoryLoading}
              dialect={DIALECT[conn.type]}
              onRefresh={loadSchemaHistory}
              onRollback={setRollbackTarget}
            />
          )}
          {conn && current?.kind === 'workflow' && (
            <Suspense fallback={<div className="flex-1 p-8 text-center text-xs text-ink-faint">Loading workflow…</div>}>
              <WorkflowEditor key={current.key} conn={conn} workflowId={current.workflowId} />
            </Suspense>
          )}
          {!current && (
            <div className="flex h-full w-full items-center justify-center overflow-auto p-8">
              <div className="w-full max-w-[560px] text-center">
                <div className="mx-auto flex h-[88px] w-[88px] items-center justify-center rounded-[22px] border border-edge bg-elevated text-ink-faint">
                  <TableIcon width={34} height={34} />
                </div>
                <h2 className="mt-7 text-2xl font-bold">No table selected</h2>
                <p className="mx-auto mt-3 max-w-[420px] text-sm leading-relaxed text-ink-dim">
                  Pick a table from the sidebar to browse rows, or start a query to explore your data with SQL.
                </p>

                <div className="mt-7 flex items-center justify-center gap-3">
                  <Button variant="primary" size="lg" icon={CodeIcon} onClick={() => openQuery()}>
                    New SQL query
                  </Button>
                  <Button
                    variant="ghost"
                    size="lg"
                    icon={TableIcon}
                    onClick={() => tables[0] && openTable(tables[0])}
                    disabled={tables.length === 0}
                  >
                    Browse tables
                  </Button>
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
          )}
        </div>
      </main>

      {tabMenu && (
        <div
          className="fixed z-[60] min-w-[190px] overflow-hidden rounded-soft border border-edge-strong bg-elevated py-1 shadow-[0_12px_34px_-10px_rgba(0,0,0,0.75)]"
          style={{
            left: Math.min(tabMenu.x, window.innerWidth - 200),
            top: Math.min(tabMenu.y, window.innerHeight - 120),
          }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <MenuItem
            onClick={() => {
              removeTab(tabMenu.key)
              setTabMenu(null)
            }}
          >
            Close
          </MenuItem>
          <MenuItem
            disabled={tabs.findIndex((t) => t.key === tabMenu.key) === tabs.length - 1}
            onClick={() => {
              closeTabsToRight(tabMenu.key)
              setTabMenu(null)
            }}
          >
            Close tabs to the right
          </MenuItem>
          <div className="my-1 h-px bg-edge" />
          <MenuItem
            onClick={() => {
              closeAllTabs()
              setTabMenu(null)
            }}
          >
            Close all tabs
          </MenuItem>
        </div>
      )}

      {creatingTable && (
        <CreateTablePanel
          conn={nsConn}
          initialTable={creatingTable?.table}
          onClose={() => setCreatingTable(false)}
          onStage={stageTableChanges}
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

      {closingTab && (
        <ConfirmDialog
          title="Discard unsaved changes?"
          message="This schema editor tab has unsaved changes that will be lost if you close it."
          confirmLabel="Close tab"
          cancelLabel="Keep editing"
          danger
          onConfirm={() => {
            dropTab(closingTab)
            setClosingTab(null)
          }}
          onCancel={() => setClosingTab(null)}
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
          <div className="w-full max-w-[400px] animate-pop rounded-[16px] border border-edge-strong bg-panel p-5 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]">
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
    </div>
  )
}
