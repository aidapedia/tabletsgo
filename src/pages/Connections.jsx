import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { useConnections } from '../context/ConnectionsContext.jsx'
import ConnectionModal from '../components/ConnectionModal.jsx'
import { EditIcon, FolderIcon, PlusIcon, SearchIcon, TrashIcon } from '../components/icons.jsx'
import { btnPrimary, connIcon, envDotColor } from '../ui.js'

const ABBR = { postgresql: 'PG', sqlite: 'SQ', redis: 'R' }

const iconBtn =
  'flex h-[34px] w-[34px] items-center justify-center rounded-[9px] border border-edge bg-elevated text-ink-dim hover:text-ink hover:border-edge-strong'

export default function Connections() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const { connections, loading, addConnection, updateConnection, removeConnection } = useConnections()

  const [query, setQuery] = useState('')
  const [activeFolder, setActiveFolder] = useState('All')
  const [modal, setModal] = useState(null)

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

  const handleDelete = (e, conn) => {
    e.stopPropagation()
    if (window.confirm(`Delete connection "${conn.name}"?`)) {
      removeConnection(conn.id)
    }
  }

  return (
    <div className="mx-auto max-w-[1000px] px-8 py-12 max-[720px]:px-4 max-[720px]:py-8">
      <div className="mb-6 flex justify-end">
        <div
          className="relative flex h-10 w-10 cursor-pointer items-center justify-center rounded-[11px] bg-green text-xs font-bold text-white"
          title={user?.name}
          onClick={logout}
        >
          {user?.name?.[0]?.toUpperCase() || 'A'}
          <span className="absolute -bottom-0.5 -right-0.5 h-[13px] w-[13px] rounded-full border-2 border-bg bg-green" />
        </div>
      </div>

      <div className="mb-7 flex items-center justify-between">
        <h1 className="text-[28px] font-bold tracking-[-0.5px]">Saved Connections</h1>
        <div className="flex gap-3">
          <button className={btnPrimary} onClick={() => setModal({ mode: 'new' })}>
            New <PlusIcon width={14} height={14} />
          </button>
        </div>
      </div>

      <div className="relative mb-[22px]">
        <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-faint" />
        <input
          type="text"
          placeholder="Search by name or hostname…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-card border border-edge bg-elevated py-3.5 pl-[46px] pr-4 text-[13px] text-ink outline-none focus:border-green-dim"
        />
      </div>

      <div className="mb-[22px] flex flex-wrap items-center gap-2.5">
        {folders.map((f) => (
          <button
            key={f}
            onClick={() => setActiveFolder(f)}
            className={`inline-flex items-center gap-[7px] rounded-[10px] border px-4 py-[9px] text-xs font-medium transition-all ${
              activeFolder === f
                ? 'border-edge-strong bg-card-hover text-ink'
                : 'border-transparent bg-elevated text-ink-dim hover:text-ink'
            }`}
          >
            {f !== 'All' && <FolderIcon />}
            {f}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="px-5 py-[70px] text-center text-ink-faint">
          <h3 className="mb-2 text-[17px] text-ink-dim">Loading connections…</h3>
        </div>
      ) : filtered.length === 0 ? (
        <div className="px-5 py-[70px] text-center text-ink-faint">
          <h3 className="mb-2 text-base text-ink-dim">No connections found</h3>
          <p className="mb-[22px] text-[13px]">
            {connections.length === 0
              ? 'Add your first SQLite or PostgreSQL connection to get started.'
              : 'Try a different search or folder.'}
          </p>
          <button className={btnPrimary} onClick={() => setModal({ mode: 'new' })}>
            New Connection <PlusIcon width={14} height={14} />
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((conn) => (
            <div
              key={conn.id}
              className="group flex cursor-pointer items-center gap-4 rounded-card border border-edge bg-card px-[18px] py-4 transition-all hover:-translate-y-px hover:border-edge-strong hover:bg-card-hover"
              onClick={() => navigate(`/connection/${conn.id}`)}
            >
              <div className={connIcon(conn.type, 'h-[46px] w-[46px] text-xs font-extrabold')}>
                {ABBR[conn.type]}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2.5 text-sm font-bold">
                  {conn.name}
                  {conn.environment && conn.environment !== 'local' && (
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-ink-dim">
                      <span className={`h-[9px] w-[9px] rounded-full ${envDotColor[conn.environment] || ''}`} />
                      {conn.environment[0].toUpperCase() + conn.environment.slice(1)}
                    </span>
                  )}
                </div>
                <div className="mt-1 text-xs text-ink-dim">
                  {conn.type} •{' '}
                  {conn.type === 'sqlite' ? conn.filepath : `${conn.host}:${conn.port}`}
                </div>
              </div>
              <div className="flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 max-[720px]:opacity-100">
                <button
                  className={iconBtn}
                  title="Edit"
                  onClick={(e) => {
                    e.stopPropagation()
                    setModal({ mode: 'edit', conn })
                  }}
                >
                  <EditIcon />
                </button>
                <button
                  className={`${iconBtn} hover:!text-red hover:!border-red/40`}
                  title="Delete"
                  onClick={(e) => handleDelete(e, conn)}
                >
                  <TrashIcon />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-[60px] border-t border-edge pt-7 text-center text-ink-faint">
        <div className="mb-[18px] text-xs">Version 1.0.0</div>
        <div className="flex items-center justify-center gap-[18px] text-xs text-ink-dim">
          <button className="hover:text-green" onClick={logout}>Sign Out</button>
        </div>
      </div>

      {modal && (
        <ConnectionModal
          initial={modal.mode === 'edit' ? modal.conn : null}
          onClose={() => setModal(null)}
          onSave={handleSave}
        />
      )}
    </div>
  )
}
