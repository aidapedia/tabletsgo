import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { useConnections } from '../context/ConnectionsContext.jsx'
import ConnectionModal from '../components/ConnectionModal.jsx'
import {
  DatabaseIcon,
  DbLogo,
  EditIcon,
  FolderIcon,
  Logo,
  LogoutIcon,
  MenuIcon,
  MoreVerticalIcon,
  SearchIcon,
  TrashIcon,
} from '../components/icons.jsx'
import Popover from '../components/ui/Popover.jsx'
import Tooltip from '../components/ui/Tooltip.jsx'
import { envDotColor } from '../ui.js'

const menuRow =
  'flex w-full items-center gap-2.5 rounded px-2.5 py-2 text-left text-[12px] text-ink-dim transition-colors hover:bg-card-hover hover:text-ink'

// Database types offered when creating a connection.
const DB_CATALOG = [
  { id: 'postgresql', label: 'PostgreSQL', desc: 'Open-source relational database', available: true },
  { id: 'sqlite', label: 'SQLite', desc: 'Embedded file-based database', available: true },
  { id: 'mysql', label: 'MySQL', desc: 'Popular relational database', available: false },
  { id: 'mariadb', label: 'MariaDB', desc: 'MySQL-compatible database', available: false },
  { id: 'mongodb', label: 'MongoDB', desc: 'Document NoSQL database', available: false },
  { id: 'redis', label: 'Redis', desc: 'In-memory key-value store', available: false },
]

export default function Connections() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const { connections, loading, addConnection, updateConnection, removeConnection } = useConnections()

  const [query, setQuery] = useState('')
  const [activeFolder, setActiveFolder] = useState('All')
  const [modal, setModal] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(false) // mobile drawer

  const folders = useMemo(() => {
    const set = new Set()
    connections.forEach((c) => c.folder && set.add(c.folder))
    return ['All', ...set]
  }, [connections])

  const filtered = useMemo(() => {
    return connections.filter((c) => {
      const inFolder = activeFolder === 'All' || c.folder === activeFolder
      const q = query.trim().toLowerCase()
      const matches =
        !q ||
        c.name.toLowerCase().includes(q) ||
        c.host?.toLowerCase().includes(q) ||
        c.filepath?.toLowerCase().includes(q)
      return inFolder && matches
    })
  }, [connections, activeFolder, query])

  const handleSave = (data) => {
    if (modal?.mode === 'edit') {
      updateConnection(modal.conn.id, data)
    } else {
      addConnection(data)
    }
    setModal(null)
  }

  const handleDelete = (conn) => {
    if (window.confirm(`Delete connection "${conn.name}"?`)) {
      removeConnection(conn.id)
    }
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

      {/* Sidebar (slide-over drawer on mobile) */}
      <aside
        className={`z-40 flex w-[320px] shrink-0 flex-col border-r border-edge bg-panel max-[720px]:fixed max-[720px]:inset-y-0 max-[720px]:left-0 max-[720px]:w-[280px] max-[720px]:shadow-[8px_0_30px_-10px_rgba(0,0,0,0.7)] max-[720px]:transition-transform max-[720px]:duration-200 ${
          sidebarOpen ? 'max-[720px]:translate-x-0' : 'max-[720px]:-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-center gap-2.5 px-5 py-5">
          <Logo className="h-7 w-7" />
          <span className="text-[17px] font-bold tracking-[-0.3px]">
            Tabl<span className="text-green">et</span>sgo
          </span>
        </div>

        <div className="px-4">
          <div className="relative">
            <SearchIcon width={15} height={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              type="text"
              placeholder="Search connections…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full rounded-soft border border-edge bg-elevated py-2.5 pl-9 pr-3 text-xs text-ink outline-none focus:border-green-dim"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2 px-4 pt-3.5">
          {folders.map((f) => (
            <button
              key={f}
              onClick={() => setActiveFolder(f)}
              className={`inline-flex items-center gap-1.5 rounded-[9px] border px-3 py-1.5 text-[11px] font-medium transition-all ${
                activeFolder === f
                  ? 'border-edge-strong bg-card-hover text-ink'
                  : 'border-edge bg-elevated text-ink-dim hover:text-ink'
              }`}
            >
              {f !== 'All' && <FolderIcon width={12} height={12} />}
              {f}
            </button>
          ))}
        </div>

        <div className="mt-3.5 min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          {loading ? (
            <div className="px-2 py-8 text-center text-xs text-ink-faint">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="px-2 py-8 text-center text-xs text-ink-faint">
              {connections.length === 0 ? 'No connections yet.' : 'No matches.'}
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {filtered.map((conn) => (
                <div
                  key={conn.id}
                  className="group flex cursor-pointer items-center gap-3 rounded-soft border border-transparent px-2.5 py-2.5 transition-all hover:border-edge-strong hover:bg-card-hover"
                  onClick={() => {
                    setSidebarOpen(false)
                    navigate(`/connection/${conn.id}`)
                  }}
                >
                  <DbLogo type={conn.type} className="h-9 w-9 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[13px] font-semibold">
                      <span className="truncate">{conn.name}</span>
                      {conn.environment && conn.environment !== 'local' && (
                        <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-medium text-ink-dim">
                          <span className={`h-2 w-2 rounded-full ${envDotColor[conn.environment] || ''}`} />
                          {conn.environment[0].toUpperCase() + conn.environment.slice(1)}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-ink-dim">
                      {conn.type} · {conn.type === 'sqlite' ? conn.filepath : `${conn.host}:${conn.port}`}
                    </div>
                  </div>
                  <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                    <Popover
                      align="right"
                      width={150}
                      trigger={({ open, toggle }) => (
                        <button
                          onClick={toggle}
                          aria-label="Connection actions"
                          className={`flex h-7 w-7 items-center justify-center rounded-[7px] transition-colors ${
                            open
                              ? 'bg-elevated text-ink opacity-100'
                              : 'text-ink-dim opacity-0 hover:bg-elevated hover:text-ink group-hover:opacity-100 max-[720px]:opacity-100'
                          }`}
                        >
                          <MoreVerticalIcon width={16} height={16} />
                        </button>
                      )}
                    >
                      {({ close }) => (
                        <div className="p-1">
                          <button
                            className={menuRow}
                            onClick={() => {
                              setModal({ mode: 'edit', conn })
                              close()
                            }}
                          >
                            <EditIcon width={14} height={14} /> Edit
                          </button>
                          <button
                            className={`${menuRow} hover:!text-red`}
                            onClick={() => {
                              close()
                              handleDelete(conn)
                            }}
                          >
                            <TrashIcon width={14} height={14} /> Delete
                          </button>
                        </div>
                      )}
                    </Popover>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 border-t border-edge px-4 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-green text-[11px] font-bold text-white">
            {user?.name?.[0]?.toUpperCase() || 'A'}
          </div>
          <span className="flex-1 text-[11px] text-ink-faint">v1.0.0</span>
          <Tooltip label="Sign out" placement="top">
            <button
              onClick={logout}
              className="flex h-8 w-8 items-center justify-center rounded-[9px] text-ink-dim hover:bg-elevated hover:text-ink"
              aria-label="Sign out"
            >
              <LogoutIcon />
            </button>
          </Tooltip>
        </div>
      </aside>

      {/* Main content — database type grid */}
      <main className="min-w-0 flex-1 overflow-y-auto">
        {/* Mobile top bar */}
        <div className="hidden items-center gap-3 border-b border-edge px-4 py-3 max-[720px]:flex">
          <button
            onClick={() => setSidebarOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-soft text-ink-dim hover:bg-elevated hover:text-ink"
            aria-label="Open connections"
          >
            <MenuIcon />
          </button>
          <Logo className="h-6 w-6" />
          <span className="text-sm font-bold tracking-[-0.3px]">
            Tabl<span className="text-green">et</span>sgo
          </span>
        </div>

        <div className="mx-auto max-w-[860px] px-10 py-12 max-[720px]:px-5 max-[720px]:py-8">
          <h1 className="text-[22px] font-bold tracking-[-0.4px] max-[720px]:text-lg">Create a new connection</h1>
          <p className="mt-2 text-[13px] text-ink-dim">Choose a database type to get started.</p>

          <div className="mt-7 grid grid-cols-3 gap-3.5 max-[860px]:grid-cols-2 max-[520px]:grid-cols-1">
            {DB_CATALOG.map((db) => (
              <button
                key={db.id}
                disabled={!db.available}
                onClick={() => db.available && setModal({ mode: 'new', type: db.id })}
                className={`group relative flex flex-col items-start gap-3.5 rounded-card border p-4 text-left transition-all ${
                  db.available
                    ? 'border-edge bg-card hover:-translate-y-px hover:border-edge-strong hover:bg-card-hover'
                    : 'cursor-not-allowed border-edge bg-card/40 opacity-60'
                }`}
              >
                {db.available ? (
                  <DbLogo type={db.id} className="h-11 w-11" />
                ) : (
                  <div className="flex h-11 w-11 items-center justify-center rounded-[11px] bg-elevated text-ink-faint">
                    <DatabaseIcon />
                  </div>
                )}
                <div>
                  <div className="text-[13px] font-semibold">{db.label}</div>
                  <div className="mt-0.5 text-[11px] leading-relaxed text-ink-dim">{db.desc}</div>
                </div>
                {!db.available && (
                  <span className="absolute right-3 top-3 rounded-[6px] border border-edge bg-elevated px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-ink-faint">
                    Soon
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </main>

      {modal && (
        <ConnectionModal
          initial={modal.mode === 'edit' ? modal.conn : null}
          initialType={modal.type}
          onClose={() => setModal(null)}
          onSave={handleSave}
        />
      )}
    </div>
  )
}
