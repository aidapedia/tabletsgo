import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  useConnections, ConnectionForm, ConnectionDetail, DbTypePickerModal,
  StatusBadge, connectionUrl, TYPE_LABEL,
} from '@/features/connections'
import { pingConnection } from '@/shared/api/database'
import Button from '@/shared/ui/buttons/Button'
import IconButton from '@/shared/ui/buttons/IconButton'
import MenuItem from '@/shared/ui/navigation/MenuItem'
import Popover from '@/shared/ui/overlay/Popover'
import ConfirmDialog from '@/shared/ui/feedback/ConfirmDialog'
import { useToast } from '@/shared/ui/feedback/Toast'
import {
  CopyIcon,
  DatabaseIcon,
  DbLogo,
  EditIcon,
  ExternalLinkIcon,
  FolderIcon,
  MoreVerticalIcon,
  PlusIcon,
  TrashIcon,
} from '@/shared/ui/icons'
import SearchInput from '@/shared/ui/form/SearchInput'
import EmptyState from '@/shared/ui/feedback/EmptyState'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import { PageHeader } from './ui'

// A filter chip built from the shared Button — bordered when selected.
function FilterChip({ active, onClick, icon, children }: any) {
  return (
    <Button variant={active ? 'ghost' : 'subtle'} size="sm" icon={icon} onClick={onClick}>
      {children}
    </Button>
  )
}

// ---- Connections section: list + detail + create/edit forms (thin composition;
// the detail view and db-type picker live in features/connections) ----
export default function ConnectionsPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const { connections, loading, addConnection, updateConnection, removeConnection } = useConnections()

  const [detailConn, setDetailConn] = useState<any>(null) // open connection detail view
  const [query, setQuery] = useState('')
  const [activeFolder, setActiveFolder] = useState('All')
  const [activeType, setActiveType] = useState('all')
  const [formConn, setFormConn] = useState<any>(null) // { mode, conn?, type? } — full-page create/edit form
  const [picker, setPicker] = useState(false) // db-type picker open
  const [deleting, setDeleting] = useState<any>(null) // connection pending delete confirmation
  const [statuses, setStatuses] = useState<Record<string, string>>({})

  // Keep the open detail view in sync with the latest connection data (e.g. after an edit).
  useEffect(() => {
    if (!detailConn) return
    const latest = connections.find((c) => c.id === detailConn.id)
    if (!latest) setDetailConn(null)
    else if (latest !== detailConn) setDetailConn(latest)
  }, [connections])

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
    if (formConn?.mode === 'edit') updateConnection(formConn.conn.id, data)
    else addConnection(data)
    setFormConn(null)
  }

  const confirmDelete = () => {
    const conn = deleting
    setDeleting(null)
    if (!conn) return
    removeConnection(conn.id)
    if (detailConn?.id === conn.id) setDetailConn(null)
  }

  const copyUrl = (conn) => {
    navigator.clipboard?.writeText(connectionUrl(conn))
    toast.success('Connection URL copied to clipboard.')
  }

  const openConsole = (conn) => navigate(`/connection/${conn.id}`)
  const subtitle = (c) => (c.type === 'sqlite' ? c.filepath : c.host)

  if (formConn) {
    return (
      <ConnectionForm
        initial={formConn.mode === 'edit' ? formConn.conn : null}
        initialType={formConn.type}
        initialTab={formConn.tab}
        onClose={() => setFormConn(null)}
        onSave={handleSave}
      />
    )
  }

  if (detailConn) {
    return (
      <ConnectionDetail
        conn={detailConn}
        onBack={() => setDetailConn(null)}
        onOpen={openConsole}
        onEdit={(c, tab) => setFormConn({ mode: 'edit', conn: c, tab })}
      />
    )
  }

  return (
    <>
      <div className="w-full">
        <PageHeader
          title="Connections"
          desc="Manage the databases connected to this workspace."
          action={
            <Button variant="primary" size="lg" icon={PlusIcon} onClick={() => setPicker(true)}>
              New connection
            </Button>
          }
        />

        {/* Search + filters */}
        <div className="mt-6 flex flex-col gap-3">
          <SearchInput
            iconSize={16}
            placeholder="Search connections…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            inputClassName="!py-2.5 !pl-10 !text-[13px]"
          />
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
          <LoadingState className="py-20 text-center" />
        ) : (
          <div className="mt-6 grid grid-cols-3 gap-4 max-[1080px]:grid-cols-2 max-[720px]:grid-cols-1">
            {filtered.map((conn) => (
              <div
                key={conn.id}
                onClick={() => setDetailConn(conn)}
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

                {/* Hover actions */}
                <div className="absolute bottom-3 right-3" onClick={(e) => e.stopPropagation()}>
                  <Popover
                    align="right"
                    width={170}
                    trigger={({ open, toggle }) => (
                      <IconButton
                        onClick={toggle}
                        active={open}
                        aria-label="Connection actions"
                        className={open ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}
                      >
                        <MoreVerticalIcon width={16} height={16} />
                      </IconButton>
                    )}
                  >
                    {({ close }) => (
                      <div className="p-1">
                        <MenuItem onClick={() => { openConsole(conn); close() }}>
                          <ExternalLinkIcon width={14} height={14} /> Connect
                        </MenuItem>
                        <MenuItem onClick={() => { setDetailConn(conn); close() }}>
                          <DatabaseIcon width={14} height={14} /> Open details
                        </MenuItem>
                        <div className="my-1 h-px bg-edge" />
                        <MenuItem onClick={() => { setFormConn({ mode: 'edit', conn }); close() }}>
                          <EditIcon width={14} height={14} /> Edit
                        </MenuItem>
                        <MenuItem onClick={() => { copyUrl(conn); close() }}>
                          <CopyIcon width={14} height={14} /> Copy as URL
                        </MenuItem>
                        <MenuItem danger onClick={() => { close(); setDeleting(conn) }}>
                          <TrashIcon width={14} height={14} /> Delete
                        </MenuItem>
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
          <EmptyState className="py-16">No connections match your search.</EmptyState>
        )}
      </div>

      {/* DB-type picker */}
      {picker && (
        <DbTypePickerModal
          onClose={() => setPicker(false)}
          onPick={(typeId) => {
            setFormConn({ mode: 'new', type: typeId })
            setPicker(false)
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete connection?"
          message={`Delete connection "${deleting.name}"? Its saved queries, workflows and history will be removed too.`}
          confirmLabel="Delete"
          cancelLabel="Cancel"
          danger
          onConfirm={confirmDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </>
  )
}
