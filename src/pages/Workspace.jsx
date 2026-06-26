import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useConnections } from '../context/ConnectionsContext.jsx'
import { listTables } from '../db/sqlite.js'
import { addRecent, loadRecents, relativeTime, saveRecents } from '../recents.js'
import TableView from '../components/workspace/TableView.jsx'
import QueryEditor from '../components/workspace/QueryEditor.jsx'
import CreateTableModal from '../components/workspace/CreateTableModal.jsx'
import { btnGhost, btnPrimary, connIcon, envDotColor } from '../ui.js'
import {
  ChevronLeft,
  CloseIcon,
  CodeIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  TableIcon,
} from '../components/icons.jsx'

const kbd =
  'inline-flex min-w-[20px] items-center justify-center rounded-[5px] border border-edge bg-elevated px-1.5 py-0.5 text-[11px] text-ink-dim'

const ABBR = { postgresql: 'PG', sqlite: 'SQ', redis: 'R' }
const DIALECT = { postgresql: 'PostgreSQL', sqlite: 'SQLite', redis: 'Redis' }
let queryCounter = 0

const iconMini =
  'flex h-[28px] w-[28px] items-center justify-center rounded-[7px] text-ink-dim hover:bg-elevated hover:text-ink'
const btnSql =
  'inline-flex items-center justify-center gap-2 rounded-soft border border-edge bg-elevated px-3.5 py-2 text-[11px] font-semibold text-ink whitespace-nowrap transition-all duration-150 hover:bg-card-hover hover:border-edge-strong'
const centerState =
  'flex h-full flex-col items-center justify-center gap-4 text-ink-faint'
const menuItem =
  'flex w-full items-center px-3 py-1.5 text-left text-xs text-ink-dim transition-colors hover:bg-card-hover hover:text-ink disabled:cursor-not-allowed disabled:text-ink-faint disabled:hover:bg-transparent disabled:hover:text-ink-faint'

export default function Workspace() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { connections } = useConnections()
  const conn = connections.find((c) => c.id === id)

  const [tables, setTables] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [tabs, setTabs] = useState([])
  const [activeTab, setActiveTab] = useState(null)
  const [creatingTable, setCreatingTable] = useState(false)
  const [recents, setRecents] = useState(() => loadRecents(id))
  const [tabMenu, setTabMenu] = useState(null) // { x, y, key } | null
  const searchRef = useRef(null)

  const loadTables = async () => {
    if (!conn) return
    setLoading(true)
    const t = await listTables(conn)
    setTables(t || [])
    // Open the first table by default if none open
    if (t?.length && tabs.length === 0) {
      const first = { key: `table:${t[0]}`, kind: 'table', table: t[0], title: t[0] }
      setTabs([first])
      setActiveTab(first.key)
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
        searchRef.current?.focus()
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
  }

  const openQuery = (sql) => {
    queryCounter += 1
    const key = `query:${queryCounter}`
    const initialSql = typeof sql === 'string' ? sql : undefined
    setTabs((prev) => [...prev, { key, kind: 'query', title: `Query ${queryCounter}`, sql: initialSql }])
    setActiveTab(key)
  }

  const pushRecent = (entry) => setRecents((r) => addRecent(id, r, entry))
  const clearRecents = () => {
    saveRecents(id, [])
    setRecents([])
  }

  const handleTableCreated = async (tableName) => {
    setCreatingTable(false)
    await loadTables()
    openTable(tableName)
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

  const visibleTables = tables.filter((t) =>
    t.toLowerCase().includes(filter.trim().toLowerCase())
  )

  const current = tabs.find((t) => t.key === activeTab)

  return (
    <div className="grid h-screen grid-cols-[280px_1fr] bg-bg max-[720px]:grid-cols-1">
      {/* Sidebar */}
      <aside className="flex min-h-0 flex-col border-r border-edge bg-panel max-[720px]:hidden">
        <div className="flex items-center gap-2.5 border-b border-edge px-4 py-4">
          <div className={connIcon(conn.type, 'h-[30px] w-[30px] text-[13px] font-extrabold')}>
            {ABBR[conn.type]}
          </div>
          <span className="flex-1 truncate text-[13px] font-bold">{conn.name}</span>
          {conn.environment && conn.environment !== 'local' && (
            <span className={`h-[9px] w-[9px] rounded-full ${envDotColor[conn.environment] || ''}`} />
          )}
          <button
            className="flex h-[30px] w-[30px] items-center justify-center rounded-[8px] text-ink-dim hover:bg-elevated hover:text-ink"
            onClick={() => navigate('/')}
            title="Back to connections"
          >
            <ChevronLeft />
          </button>
        </div>

        <div className="flex items-center justify-between px-4 pb-2.5 pt-4 text-[11px] font-semibold">
          <span className="text-xs">Tables</span>
          <div className="flex gap-1">
            <button className={iconMini} title="Refresh" onClick={loadTables}>
              <RefreshIcon />
            </button>
            <button className={iconMini} title="Create table" onClick={() => setCreatingTable(true)}>
              <PlusIcon width={14} height={14} />
            </button>
          </div>
        </div>

        <div className="relative mx-3.5 my-2.5">
          <SearchIcon width={15} height={15} className="absolute left-[11px] top-1/2 -translate-y-1/2 text-ink-faint" />
          <input
            ref={searchRef}
            placeholder="Search tables…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full rounded-[9px] border border-edge bg-elevated py-2 pl-[34px] pr-3 text-xs text-ink outline-none focus:border-green-dim"
          />
        </div>

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
                  <TableIcon className={`flex-shrink-0 ${active ? 'text-green' : 'text-ink-faint'}`} />
                  <span className="flex-1 truncate">{t}</span>
                </button>
              )
            })}
          {!loading && visibleTables.length === 0 && (
            <div className={`${centerState} text-xs`}>No tables</div>
          )}
        </div>
      </aside>

      {/* Main */}
      <main className="flex min-h-0 min-w-0 flex-col">
        <div className="flex items-center gap-3.5 border-b border-edge px-[18px] py-3">
          <button className={btnSql} onClick={() => openQuery()}>
            <CodeIcon /> SQL Query
          </button>
          <div className="relative flex max-w-[560px] flex-1 items-center">
            <SearchIcon width={16} height={16} className="absolute left-3.5 text-ink-faint" />
            <input
              placeholder="Search or run commands…"
              className="w-full rounded-[10px] border border-edge bg-elevated py-[9px] pl-10 pr-3.5 text-xs text-ink outline-none"
            />
            <kbd className="absolute right-3 rounded-[5px] border border-edge bg-card px-1.5 py-px text-[11px] text-ink-faint">⌘K</kbd>
          </div>
          <div className="ml-auto flex items-center gap-2 rounded-[10px] border border-edge bg-elevated px-3 py-[7px] text-xs font-semibold text-ink-dim">
            Changes <span className="rounded-[20px] bg-green-dim px-[7px] text-xs text-green-bright">0</span>
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
                    ? 'bg-elevated text-ink'
                    : 'text-ink-dim hover:bg-elevated/50 hover:text-ink'
                }`}
              >
                {active && (
                  <span className="absolute inset-x-0 top-0 h-[2px] rounded-t-[8px] bg-green" />
                )}
                {t.kind === 'query' ? (
                  <CodeIcon className={active ? 'text-green' : 'text-ink-faint'} />
                ) : (
                  <TableIcon className={active ? 'text-green' : 'text-ink-faint'} />
                )}
                <span>{t.title}</span>
                <button
                  className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded text-ink-faint opacity-70 transition-colors hover:bg-card-hover hover:text-ink group-hover/tab:opacity-100"
                  onClick={(e) => closeTab(e, t.key)}
                  title="Close tab"
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
            <TableView key={current.key} conn={conn} table={current.table} />
          )}
          {conn && current?.kind === 'query' && (
            <QueryEditor
              key={current.key}
              conn={conn}
              dialect={DIALECT[conn.type]}
              initialSql={current.sql ?? 'SELECT * FROM events LIMIT 10;'}
              onRan={pushRecent}
            />
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
        <CreateTableModal
          conn={conn}
          onClose={() => setCreatingTable(false)}
          onCreated={handleTableCreated}
        />
      )}
    </div>
  )
}
