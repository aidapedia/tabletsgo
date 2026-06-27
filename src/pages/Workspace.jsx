import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { useConnections } from '../context/ConnectionsContext.jsx'
import { useToast } from '../components/ui/Toast.jsx'
import { listTables, runQuery } from '../db/sqlite.js'
import { addRecent, loadRecents, relativeTime, saveRecents } from '../recents.js'
import { loadSaved, persistSaved } from '../savedQueries.js'
import TableView from '../components/workspace/TableView.jsx'
import CreateTablePanel from '../components/workspace/CreateTablePanel.jsx'

// Lazy — pulls in the (heavy) CodeMirror editor only when a query tab opens.
const QueryEditor = lazy(() => import('../components/workspace/QueryEditor.jsx'))
import IconRail from '../components/workspace/IconRail.jsx'
import SavedQueriesPanel from '../components/workspace/SavedQueriesPanel.jsx'
import SaveQueryPanel from '../components/workspace/SaveQueryPanel.jsx'
import ChangesPanel from '../components/workspace/ChangesPanel.jsx'
import Segmented from '../components/ui/Segmented.jsx'
import Tooltip from '../components/ui/Tooltip.jsx'
import { btnGhost, btnPrimary, iconMini } from '../ui.js'
import {
  ChevronLeft,
  CloseIcon,
  CodeIcon,
  MenuIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  TableIcon,
} from '../components/icons.jsx'

const kbd =
  'inline-flex min-w-[20px] items-center justify-center rounded-[5px] border border-edge bg-elevated px-1.5 py-0.5 text-[11px] text-ink-dim'

const DIALECT = { postgresql: 'PostgreSQL', sqlite: 'SQLite', redis: 'Redis' }
let queryCounter = 0

const btnSql =
  'inline-flex items-center justify-center gap-2 rounded-soft border border-edge bg-elevated px-3.5 py-2 text-[11px] font-semibold text-ink whitespace-nowrap transition-all duration-150 hover:bg-card-hover hover:border-edge-strong'
const centerState =
  'flex h-full flex-col items-center justify-center gap-4 text-ink-faint'
const menuItem =
  'flex w-full items-center px-3 py-1.5 text-left text-xs text-ink-dim transition-colors hover:bg-card-hover hover:text-ink disabled:cursor-not-allowed disabled:text-ink-faint disabled:hover:bg-transparent disabled:hover:text-ink-faint'

export default function Workspace() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const toast = useToast()
  const { connections } = useConnections()
  const conn = connections.find((c) => c.id === id)

  const [tables, setTables] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [tabs, setTabs] = useState([])
  const [activeTab, setActiveTab] = useState(null)
  const [creatingTable, setCreatingTable] = useState(false)
  const [recents, setRecents] = useState(() => loadRecents(id))
  const [saved, setSaved] = useState(() => loadSaved(id))
  const [tabMenu, setTabMenu] = useState(null) // { x, y, key } | null
  const [savingQuery, setSavingQuery] = useState(null) // sql string being saved | null
  const [changes, setChanges] = useState([]) // staged (uncommitted) SQL mutations
  const [changesOpen, setChangesOpen] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [dataVersion, setDataVersion] = useState(0) // bump to force table reloads
  const [sidebarOpen, setSidebarOpen] = useState(false) // mobile drawer
  const [tablesVisible, setTablesVisible] = useState(true) // left panel visible
  const [panel, setPanel] = useState('browser') // 'browser' | 'queries'
  const [searchOpen, setSearchOpen] = useState(false) // table search toggle
  const [tableSort, setTableSort] = useState('az') // 'az' | 'za'
  const searchRef = useRef(null)
  const autoOpenedFor = useRef(null) // connection id we've already auto-opened a tab for

  // Rail selects a panel; clicking the active one again collapses it.
  const selectPanel = (p) => {
    if (panel === p && tablesVisible) {
      setTablesVisible(false)
    } else {
      setPanel(p)
      setTablesVisible(true)
    }
  }

  const loadTables = async () => {
    if (!conn) return
    setLoading(true)
    const t = await listTables(conn)
    setTables(t || [])
    // First time opening this connection with no tabs yet: open a query tab.
    // Otherwise keep whatever tabs/active tab already exist. The ref guards
    // against the effect firing twice (e.g. React StrictMode in dev).
    if (autoOpenedFor.current !== id) {
      autoOpenedFor.current = id
      if (tabs.length === 0) openQuery()
    }
    setLoading(false)
  }

  useEffect(() => {
    loadTables()
  }, [conn])

  useEffect(() => {
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.key === 'k') {
        e.preventDefault()
        setPanel('browser')
        setTablesVisible(true)
        setSearchOpen(true)
        setTimeout(() => searchRef.current?.focus(), 0)
      } else if (e.key === 'n') {
        e.preventDefault()
        openQuery()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
        <button className={btnPrimary} onClick={() => navigate('/')}>
          Back to connections
        </button>
      </div>
    )
  }

  const openTable = (table) => {
    const key = `table:${table}`
    setTabs((prev) => (prev.some((t) => t.key === key) ? prev : [...prev, { key, kind: 'table', table, title: table }]))
    setActiveTab(key)
    setSidebarOpen(false)
  }

  const openQuery = (sql) => {
    queryCounter += 1
    const key = `query:${queryCounter}`
    const initialSql = typeof sql === 'string' ? sql : undefined
    setTabs((prev) => [...prev, { key, kind: 'query', title: `Query ${queryCounter}`, sql: initialSql }])
    setActiveTab(key)
    setSidebarOpen(false)
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
    let okCount = 0
    let failure = null
    for (const ch of ordered) {
      if (failure) {
        remaining.push(ch)
        continue
      }
      const res = await runQuery(conn, ch.sql)
      if (res?.error) {
        failure = res.error
        remaining.push(ch)
      } else {
        okCount++
      }
    }
    setCommitting(false)
    setChanges(remaining.reverse())
    setDataVersion((v) => v + 1)
    loadTables() // pick up created/dropped tables in the sidebar
    if (failure) {
      toast.error(`Committed ${okCount}, then failed: ${failure}`)
    } else {
      toast.success(`Committed ${okCount} change${okCount > 1 ? 's' : ''}.`)
      setChangesOpen(false)
    }
  }

  const pushRecent = (entry) => setRecents((r) => addRecent(id, r, entry))
  const clearRecents = () => {
    saveRecents(id, [])
    setRecents([])
  }

  const saveQuery = (sql) => {
    if (!sql.trim()) return
    setSavingQuery(sql.trim())
  }
  const commitSaveQuery = (name) => {
    const entry = { id: `${Date.now()}`, name, sql: savingQuery, ts: Date.now() }
    const next = [entry, ...saved]
    setSaved(next)
    persistSaved(id, next)
    setSavingQuery(null)
    setPanel('queries')
    setTablesVisible(true)
    toast.success(`Saved “${entry.name}”.`)
  }
  const removeSaved = (sid) => {
    const next = saved.filter((s) => s.id !== sid)
    setSaved(next)
    persistSaved(id, next)
  }

  const stageCreateTable = (sql, tableName) => {
    addChange({ kind: 'create', label: `Create table ${tableName}`, sql, table: tableName })
    setCreatingTable(false)
  }

  const removeTab = (key) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.key !== key)
      if (activeTab === key) setActiveTab(next.length ? next[next.length - 1].key : null)
      return next
    })
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

  const visibleTables = tables
    .filter((t) => t.toLowerCase().includes(filter.trim().toLowerCase()))
    .sort((a, b) => (tableSort === 'az' ? a.localeCompare(b) : b.localeCompare(a)))

  const current = tabs.find((t) => t.key === activeTab)

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
          onSelectConnection={(cid) => {
            navigate(`/connection/${cid}`)
            setSidebarOpen(false)
          }}
          active={tablesVisible ? panel : ''}
          onBrowser={() => selectPanel('browser')}
          onQueries={() => selectPanel('queries')}
          onHome={() => navigate('/')}
          onSettings={() => navigate('/settings')}
          onProfile={logout}
        />
        <div
          className={`shrink-0 overflow-hidden transition-[width] duration-200 ease-out ${
            tablesVisible ? 'w-[280px]' : 'w-0'
          }`}
        >
        <aside className="flex h-full min-h-0 w-[280px] flex-col border-r border-edge bg-panel">
        {panel === 'browser' ? (
        <>
        <div className="flex items-center justify-between px-4 pb-2.5 pt-4 text-[11px] font-semibold">
          <span className="text-xs">Tables</span>
          <div className="flex gap-1">
            <Tooltip label="Refresh" placement="bottom">
              <button className={iconMini} onClick={loadTables}>
                <RefreshIcon />
              </button>
            </Tooltip>
            <Tooltip label="Search tables" placement="bottom">
              <button
                className={`${iconMini} ${searchOpen ? 'bg-elevated text-ink' : ''}`}
                onClick={() => {
                  if (searchOpen) setFilter('')
                  setSearchOpen((o) => !o)
                }}
              >
                <SearchIcon width={15} height={15} />
              </button>
            </Tooltip>
            <Tooltip label="Create table" placement="bottom">
              <button className={iconMini} onClick={() => setCreatingTable(true)}>
                <PlusIcon width={14} height={14} />
              </button>
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
          <div className="relative mx-3.5 mb-2.5">
            <SearchIcon width={15} height={15} className="absolute left-[11px] top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              ref={searchRef}
              autoFocus
              placeholder="Search tables…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setFilter('')
                  setSearchOpen(false)
                }
              }}
              className="w-full rounded-[9px] border border-edge bg-elevated py-2 pl-[34px] pr-3 text-xs text-ink outline-none focus:border-green-dim"
            />
          </div>
        )}

        <div className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 pb-4 pt-1">
          {loading && <div className={`${centerState} text-xs`}>Loading…</div>}
          {!loading &&
            visibleTables.map((t) => {
              const active = current?.kind === 'table' && current.table === t
              return (
                <button
                  key={t}
                  onClick={() => openTable(t)}
                  className={`flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2.5 text-left text-xs ${
                    active ? 'bg-card-hover text-ink' : 'text-ink-dim hover:bg-elevated hover:text-ink'
                  }`}
                >
                  <TableIcon className={`flex-shrink-0 ${active ? 'text-ink' : 'text-ink-faint'}`} />
                  <span className="flex-1 truncate">{t}</span>
                </button>
              )
            })}
          {!loading && visibleTables.length === 0 && (
            <div className={`${centerState} text-xs`}>No tables</div>
          )}
        </div>
        </>
        ) : (
          <SavedQueriesPanel
            saved={saved}
            recents={recents}
            onOpen={(sql) => openQuery(sql)}
            onDeleteSaved={removeSaved}
            onNew={() => openQuery()}
            onRefresh={() => {
              setRecents(loadRecents(id))
              setSaved(loadSaved(id))
            }}
            onClear={clearRecents}
          />
        )}
        </aside>
        </div>
      </div>

      {/* Main */}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-edge px-[18px] py-3 max-[720px]:px-3">
          <button
            className="hidden h-[34px] w-[34px] items-center justify-center rounded-soft text-ink-dim hover:bg-elevated hover:text-ink max-[720px]:flex"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open tables"
          >
            <MenuIcon />
          </button>
          <button className={btnSql} onClick={() => openQuery()}>
            <CodeIcon /> <span className="max-[480px]:hidden">SQL Query</span>
          </button>
          <div className="relative flex max-w-[560px] flex-1 items-center">
            <SearchIcon width={16} height={16} className="absolute left-3.5 text-ink-faint" />
            <input
              placeholder="Search or run commands…"
              className="w-full rounded-[10px] border border-edge bg-elevated py-[9px] pl-10 pr-3.5 text-xs text-ink outline-none"
            />
            <kbd className="absolute right-3 rounded-[5px] border border-edge bg-card px-1.5 py-px text-[11px] text-ink-faint">⌘K</kbd>
          </div>
          <button
            onClick={() => setChangesOpen(true)}
            title="View changes"
            className={`ml-auto flex items-center gap-2 rounded-[10px] border px-3 py-[7px] text-xs font-semibold transition-colors ${
              changes.length > 0
                ? 'border-green-dim bg-green/10 text-green-bright hover:bg-green/15'
                : 'border-edge bg-elevated text-ink-dim hover:text-ink'
            }`}
          >
            Changes
            <span
              className={`rounded-[20px] px-[7px] text-xs ${
                changes.length > 0 ? 'bg-green text-white' : 'bg-edge text-ink-faint'
              }`}
            >
              {changes.length}
            </span>
          </button>
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
                    ? 'bg-elevated text-ink'
                    : 'text-ink-dim hover:bg-elevated/50 hover:text-ink'
                }`}
              >
                {active && (
                  <span className="absolute inset-x-0 top-0 h-[2px] rounded-t-[8px] bg-ink" />
                )}
                {t.kind === 'query' ? (
                  <CodeIcon className={active ? 'text-ink' : 'text-ink-faint'} />
                ) : (
                  <TableIcon className={active ? 'text-ink' : 'text-ink-faint'} />
                )}
                <span>{t.title}</span>
                <button
                  className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded text-ink-faint opacity-70 transition-colors hover:bg-card-hover hover:text-ink group-hover/tab:opacity-100"
                  onClick={(e) => closeTab(e, t.key)}
                  aria-label="Close tab"
                >
                  <CloseIcon width={13} height={13} />
                </button>
              </div>
            )
          })}
          {tabs.length === 0 && <div className="px-3 py-2.5 text-[11px] text-ink-faint">No open tabs</div>}
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          {conn && current?.kind === 'table' && (
            <TableView key={`${current.key}:${dataVersion}`} conn={conn} table={current.table} onChange={addChange} />
          )}
          {conn && current?.kind === 'query' && (
            <Suspense fallback={<div className="flex-1 p-8 text-center text-xs text-ink-faint">Loading editor…</div>}>
              <QueryEditor
                key={current.key}
                conn={conn}
                dialect={DIALECT[conn.type]}
                initialSql={current.sql ?? ''}
                onRan={pushRecent}
                onSave={saveQuery}
              />
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
                  <button className={btnPrimary} onClick={() => openQuery()}>
                    <CodeIcon /> New SQL query
                  </button>
                  <button
                    className={btnGhost}
                    onClick={() => tables[0] && openTable(tables[0])}
                    disabled={tables.length === 0}
                  >
                    <TableIcon width={16} height={16} /> Browse tables
                  </button>
                </div>

                {recents.length > 0 && (
                  <div className="mt-10 text-left">
                    <div className="mb-2.5 flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-dim">Recent queries</span>
                      <button className="text-[11px] text-ink-faint hover:text-ink" onClick={clearRecents}>
                        Clear
                      </button>
                    </div>
                    <div className="flex flex-col gap-2.5">
                      {recents.map((q, i) => (
                        <button
                          key={i}
                          onClick={() => openQuery(q.sql)}
                          className="group flex items-center gap-3 rounded-card border border-edge bg-card px-4 py-3 text-left transition-all hover:border-edge-strong hover:bg-card-hover"
                        >
                          <CodeIcon className="flex-shrink-0 text-ink-faint" />
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-mono text-[13px] text-ink">{q.sql}</div>
                            <div className="mt-1 text-[11px] text-ink-faint">
                              {relativeTime(q.ts)}
                              {q.rows != null && ` · ${q.rows.toLocaleString()} rows`}
                            </div>
                          </div>
                          <ChevronLeft className="flex-shrink-0 rotate-180 text-ink-faint opacity-0 transition-opacity group-hover:opacity-100" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-10 flex flex-wrap items-center justify-center gap-6 text-[11px] text-ink-faint">
                  <span className="flex items-center gap-1.5"><kbd className={kbd}>⌘K</kbd> Search tables</span>
                  <span className="flex items-center gap-1.5"><kbd className={kbd}>⌘↵</kbd> Run query</span>
                  <span className="flex items-center gap-1.5"><kbd className={kbd}>⌘N</kbd> New query</span>
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
          <button
            className={menuItem}
            onClick={() => {
              removeTab(tabMenu.key)
              setTabMenu(null)
            }}
          >
            Close
          </button>
          <button
            className={menuItem}
            disabled={tabs.findIndex((t) => t.key === tabMenu.key) === tabs.length - 1}
            onClick={() => {
              closeTabsToRight(tabMenu.key)
              setTabMenu(null)
            }}
          >
            Close tabs to the right
          </button>
          <div className="my-1 h-px bg-edge" />
          <button
            className={menuItem}
            onClick={() => {
              closeAllTabs()
              setTabMenu(null)
            }}
          >
            Close all tabs
          </button>
        </div>
      )}

      {creatingTable && (
        <CreateTablePanel
          conn={conn}
          onClose={() => setCreatingTable(false)}
          onStage={stageCreateTable}
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
    </div>
  )
}
