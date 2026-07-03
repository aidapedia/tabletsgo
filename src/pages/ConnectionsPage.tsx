import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/features/auth'
import { useConnections } from '@/features/connections'
import { pingConnection } from '@/shared/api/database'
import ConnectionModal from '@/features/connections/components/ConnectionModal'
import { WorkspaceSwitcher } from '@/features/workspaces'
import Button from '@/shared/ui/Button'
import Popover from '@/shared/ui/Popover'
import { useToast } from '@/shared/ui/Toast'
import {
  CloseIcon,
  CopyIcon,
  DatabaseIcon,
  DbLogo,
  EditIcon,
  FolderIcon,
  Logo,
  LogoutIcon,
  MoreVerticalIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  TrashIcon,
} from '@/shared/ui/icons'

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

const STATUS = {
  checking: { dot: 'bg-ink-faint animate-pulse', text: 'text-ink-faint', label: 'Checking…' },
  connected: { dot: 'bg-green', text: 'text-ink-dim', label: 'Connected' },
  offline: { dot: 'bg-red', text: 'text-ink-dim', label: 'Offline' },
}

const TYPE_LABEL = Object.fromEntries(DB_CATALOG.map((d) => [d.id, d.label]))

// Build a copyable connection URL / string for a connection.
function connectionUrl(c) {
  if (c.type === 'sqlite') return `sqlite://${c.filepath || ''}`
  const cred = c.auth === 'none' ? '' : `${encodeURIComponent(c.username || '')}${c.password ? ':' + encodeURIComponent(c.password) : ''}`
  const auth = cred ? `${cred}@` : ''
  const db = c.database ? `/${c.database}` : ''
  const ssl = c.sslmode && c.sslmode !== 'disable' ? `?sslmode=${c.sslmode}` : ''
  return `postgresql://${auth}${c.host || ''}${c.port ? ':' + c.port : ''}${db}${ssl}`
}

// A filter chip built from the shared Button — bordered when selected, plain
// (subtle) when not, keeping the app's rounded-soft shape.
function FilterChip({ active, onClick, icon, children }: any) {
  return (
    <Button variant={active ? 'ghost' : 'subtle'} size="sm" icon={icon} onClick={onClick}>
      {children}
    </Button>
  )
}

function StatusBadge({ status }: { status?: string }) {
  const s = STATUS[status] || STATUS.checking
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${s.text}`}>
      <span className={`h-2 w-2 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  )
}

// Avatar → account menu (user settings + sign out).
function AccountMenu({ user, onSettings, onLogout }) {
  return (
    <Popover
      align="right"
      width={220}
      trigger={({ open, toggle }) => (
        <button
          onClick={toggle}
          aria-label="Account"
          className={`flex h-9 w-9 items-center justify-center rounded-full bg-green text-[13px] font-bold text-white transition-opacity hover:opacity-90 ${
            open ? 'ring-2 ring-green/40' : ''
          }`}
        >
          {user?.name?.[0]?.toUpperCase() || 'A'}
        </button>
      )}
    >
      {({ close }) => (
        <div className="p-1.5">
          <div className="px-2 py-1.5">
            <div className="truncate text-[12px] font-semibold text-ink">{user?.name || 'Account'}</div>
            <div className="truncate text-[11px] text-ink-faint">{user?.email}</div>
          </div>
          <div className="my-1 h-px bg-edge" />
          <button className={menuRow} onClick={() => { onSettings(); close() }}>
            <SettingsIcon width={14} height={14} /> Settings
          </button>
          <button className={`${menuRow} hover:!text-red`} onClick={() => { onLogout(); close() }}>
            <LogoutIcon width={14} height={14} /> Sign out
          </button>
        </div>
      )}
    </Popover>
  )
}

export default function Connections() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const { connections, loading, addConnection, updateConnection, removeConnection } = useConnections()

  const [query, setQuery] = useState('')
  const [activeFolder, setActiveFolder] = useState('All')
  const [activeType, setActiveType] = useState('all') // 'all' | connection type id
  const [modal, setModal] = useState(null) // { mode, conn?, type? }
  const [picker, setPicker] = useState(false) // db-type picker open
  const [statuses, setStatuses] = useState({}) // { [id]: 'checking'|'connected'|'offline' }

  // Live connectivity per card.
  useEffect(() => {
    let alive = true
    connections.forEach((c) => {
      setStatuses((s) => ({ ...s, [c.id]: 'checking' }))
      pingConnection(c).then((r) => {
        if (alive) setStatuses((s) => ({ ...s, [c.id]: r.ok ? 'connected' : 'offline' }))
      })
    })
    return () => {
      alive = false
    }
  }, [connections])

  const folders = useMemo(() => {
    const set = new Set<string>()
    connections.forEach((c) => c.folder && set.add(c.folder))
    return ['All', ...set]
  }, [connections])

  // Distinct database types present, for the type filter.
  const types = useMemo(() => {
    const set = new Set<string>()
    connections.forEach((c) => c.type && set.add(c.type))
    return [...set]
  }, [connections])

  const filtered = useMemo(() => {
    return connections.filter((c) => {
      const inFolder = activeFolder === 'All' || c.folder === activeFolder
      const inType = activeType === 'all' || c.type === activeType
      const q = query.trim().toLowerCase()
      const matches =
        !q || c.name.toLowerCase().includes(q) || c.host?.toLowerCase().includes(q) || c.filepath?.toLowerCase().includes(q)
      return inFolder && inType && matches
    })
  }, [connections, activeFolder, activeType, query])

  const handleSave = (data) => {
    if (modal?.mode === 'edit') updateConnection(modal.conn.id, data)
    else addConnection(data)
    setModal(null)
  }

  const handleDelete = (conn) => {
    if (window.confirm(`Delete connection "${conn.name}"?`)) removeConnection(conn.id)
  }

  const copyUrl = (conn) => {
    navigator.clipboard?.writeText(connectionUrl(conn))
    toast.success('Connection URL copied to clipboard.')
  }

  const subtitle = (c) => (c.type === 'sqlite' ? c.filepath : c.host)

  return (
    <div className="min-h-screen bg-bg">
      {/* Top bar: brand + workspace switcher (left) · account (right) */}
      <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-edge bg-panel/80 px-6 py-3 backdrop-blur max-[600px]:px-4">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex shrink-0 items-center gap-2">
            <Logo className="h-7 w-7" />
            <span className="text-[16px] font-bold tracking-[-0.3px] max-[600px]:hidden">
              Tabl<span className="text-green">et</span>sgo
            </span>
          </div>
          <div className="w-[220px] max-[600px]:w-[150px]">
            <WorkspaceSwitcher />
          </div>
        </div>
        <AccountMenu user={user} onSettings={() => navigate('/settings')} onLogout={logout} />
      </header>

      <main className="mx-auto max-w-[1080px] px-6 py-10 max-[600px]:px-4 max-[600px]:py-7">
        {/* Heading + primary action */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[26px] font-bold tracking-[-0.5px] max-[600px]:text-[22px]">Connections</h1>
            <p className="mt-1.5 text-[13px] text-ink-dim">Manage the databases connected to this workspace.</p>
          </div>
          <Button variant="primary" size="lg" icon={PlusIcon} className="shrink-0" onClick={() => setPicker(true)}>
            New connection
          </Button>
        </div>

        {/* Search + filters */}
        <div className="mt-6 flex flex-col gap-3">
          <div className="relative">
            <SearchIcon width={16} height={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              type="text"
              placeholder="Search connections…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full rounded-soft border border-edge bg-elevated py-2.5 pl-10 pr-3 text-[13px] text-ink outline-none focus:border-green-dim"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {folders.map((f) => (
              <FilterChip key={f} active={activeFolder === f} icon={f !== 'All' ? FolderIcon : undefined} onClick={() => setActiveFolder(f)}>
                {f}
              </FilterChip>
            ))}
            {types.length > 1 && (
              <>
                <span className="mx-1 h-5 w-px shrink-0 bg-edge" />
                <FilterChip active={activeType === 'all'} onClick={() => setActiveType('all')}>
                  All types
                </FilterChip>
                {types.map((t) => (
                  <FilterChip key={t} active={activeType === t} onClick={() => setActiveType(t)}>
                    {TYPE_LABEL[t] || t}
                  </FilterChip>
                ))}
              </>
            )}
          </div>
        </div>

        {/* Cards */}
        {loading ? (
          <div className="py-20 text-center text-xs text-ink-faint">Loading…</div>
        ) : (
          <div className="mt-6 grid grid-cols-2 gap-4 max-[720px]:grid-cols-1">
            {filtered.map((conn) => (
              <div
                key={conn.id}
                onClick={() => navigate(`/connection/${conn.id}`)}
                className="group relative flex cursor-pointer flex-col rounded-card border border-edge bg-card p-5 transition-all hover:-translate-y-px hover:border-edge-strong hover:bg-card-hover"
              >
                <div className="flex items-start justify-between">
                  <DbLogo type={conn.type} className="h-11 w-11 shrink-0" />
                  <StatusBadge status={statuses[conn.id]} />
                </div>
                <div className="mt-4">
                  <div className="truncate text-[15px] font-bold">{conn.name}</div>
                  <div className="mt-0.5 truncate font-mono text-[12px] text-ink-faint">
                    {conn.type} · {subtitle(conn)}
                  </div>
                </div>

                {/* Hover actions (bottom-right, out of the way of the status badge) */}
                <div className="absolute bottom-3 right-3" onClick={(e) => e.stopPropagation()}>
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
                            : 'text-ink-dim opacity-0 hover:bg-elevated hover:text-ink group-hover:opacity-100'
                        }`}
                      >
                        <MoreVerticalIcon width={16} height={16} />
                      </button>
                    )}
                  >
                    {({ close }) => (
                      <div className="p-1">
                        <button className={menuRow} onClick={() => { setModal({ mode: 'edit', conn }); close() }}>
                          <EditIcon width={14} height={14} /> Edit
                        </button>
                        <button className={menuRow} onClick={() => { copyUrl(conn); close() }}>
                          <CopyIcon width={14} height={14} /> Copy as URL
                        </button>
                        <button className={`${menuRow} hover:!text-red`} onClick={() => { close(); handleDelete(conn) }}>
                          <TrashIcon width={14} height={14} /> Delete
                        </button>
                      </div>
                    )}
                  </Popover>
                </div>
              </div>
            ))}

            {/* Add-connection card */}
            {activeFolder === 'All' && activeType === 'all' && !query.trim() && (
              <button
                onClick={() => setPicker(true)}
                className="flex min-h-[132px] flex-col items-center justify-center gap-3 rounded-card border border-dashed border-edge-strong text-ink-dim transition-colors hover:border-green-dim hover:text-ink"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-[12px] bg-elevated text-green">
                  <PlusIcon width={20} height={20} />
                </span>
                <span className="text-[13px] font-medium">New connection</span>
              </button>
            )}
          </div>
        )}

        {!loading && connections.length > 0 && filtered.length === 0 && (
          <div className="py-16 text-center text-xs text-ink-faint">No connections match your search.</div>
        )}
      </main>

      {/* DB-type picker */}
      {picker && (
        <div
          className="fixed inset-0 z-50 flex animate-fade items-center justify-center bg-black/60 p-6 backdrop-blur-[3px]"
          onMouseDown={() => setPicker(false)}
        >
          <div
            className="w-full max-w-[680px] animate-pop rounded-[16px] border border-edge-strong bg-panel p-6 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-[18px] font-bold">Create a new connection</h2>
                <p className="mt-1 text-[13px] text-ink-dim">Choose a database type to get started.</p>
              </div>
              <button
                onClick={() => setPicker(false)}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-soft text-ink-dim hover:bg-elevated hover:text-ink"
              >
                <CloseIcon />
              </button>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-3 max-[560px]:grid-cols-2 max-[400px]:grid-cols-1">
              {DB_CATALOG.map((db) => (
                <button
                  key={db.id}
                  disabled={!db.available}
                  onClick={() => {
                    if (!db.available) return
                    setModal({ mode: 'new', type: db.id })
                    setPicker(false)
                  }}
                  className={`group relative flex flex-col items-start gap-3 rounded-card border p-4 text-left transition-all ${
                    db.available
                      ? 'border-edge bg-card hover:-translate-y-px hover:border-edge-strong hover:bg-card-hover'
                      : 'cursor-not-allowed border-edge bg-card/40 opacity-60'
                  }`}
                >
                  {db.available ? (
                    <DbLogo type={db.id} className="h-10 w-10" />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-[11px] bg-elevated text-ink-faint">
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
        </div>
      )}

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
