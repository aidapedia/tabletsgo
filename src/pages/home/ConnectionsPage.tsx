import { useEffect, useMemo, useRef, useState } from 'react'
import {
  useConnections, ConnectionForm, ConnectionDetail, DbTypePickerModal,
  ConnectionExportModal, ConnectionImportModal, readConnectionExportFile,
  ConnectHandshakeDialog, useConnectHandshake,
  StatusBadge, connectionUrl, TYPE_LABEL, EnvBadge,
} from '@/features/connections'
import type { ConnectionExport } from '@/features/connections'
import { pingConnection } from '@/shared/api/database'
import { listBackupRuns } from '@/features/backup'
import { relativeTime } from '@/shared/lib/recents'
import Button from '@/shared/ui/buttons/Button'
import IconButton from '@/shared/ui/buttons/IconButton'
import MenuItem from '@/shared/ui/navigation/MenuItem'
import Popover from '@/shared/ui/overlay/Popover'
import Select from '@/shared/ui/form/Select'
import { controlClass } from '@/shared/ui/form/Input'
import ConfirmDialog from '@/shared/ui/feedback/ConfirmDialog'
import { useToast } from '@/shared/ui/feedback/Toast'
import {
  ActivityIcon,
  CheckIcon,
  CopyIcon,
  DatabaseIcon,
  DbLogo,
  DownloadIcon,
  EditIcon,
  ExternalLinkIcon,
  GridIcon,
  InfoIcon,
  MoreVerticalIcon,
  PlusIcon,
  TrashIcon,
  UploadIcon,
} from '@/shared/ui/icons'
import SearchInput from '@/shared/ui/form/SearchInput'
import DataTable from '@/shared/ui/table/DataTable'
import type { Column } from '@/shared/ui/table/DataTable'
import useDataTable from '@/shared/ui/table/useDataTable'
import { PageHeader } from './ui'

// One headline metric with a right-aligned icon medallion.
function StatCard({ icon: Icon, label, value, sub, tone = 'default' }: any) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-card border border-edge bg-card p-5">
      <div className="min-w-0">
        <div className="text-[12px] text-ink-dim">{label}</div>
        <div className="mt-2 text-[26px] font-bold leading-none tracking-[-0.5px]">{value}</div>
        {sub && (
          <div className={`mt-2 truncate text-[12px] ${tone === 'green' ? 'font-semibold text-green' : 'text-ink-faint'}`}>
            {sub}
          </div>
        )}
      </div>
      <span
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${
          tone === 'green' ? 'bg-green/15 text-green' : 'bg-elevated text-ink-dim'
        }`}
      >
        <Icon width={20} height={20} />
      </span>
    </div>
  )
}

// ---- Connections section: list + detail + create/edit forms (thin composition;
// the detail view and db-type picker live in features/connections) ----
export default function ConnectionsPage() {
  const toast = useToast()
  // "Connect" handshakes first and only routes into the console once the
  // database answered; a failure opens ConnectHandshakeDialog with the cause.
  const { connect, connectingId, failure, dismiss, openAnyway } = useConnectHandshake()
  const { connections, loading, addConnection, updateConnection, removeConnection } = useConnections()

  const [detailConn, setDetailConn] = useState<any>(null) // open connection detail view
  const [query, setQuery] = useState('')
  const [activeEnv, setActiveEnv] = useState('all')
  const [activeFolder, setActiveFolder] = useState('all')
  const [activeType, setActiveType] = useState('all')
  const [activeStatus, setActiveStatus] = useState('all')
  const [formConn, setFormConn] = useState<any>(null) // { mode, conn?, type? } — full-page create/edit form
  const [picker, setPicker] = useState(false) // db-type picker open
  const [deleting, setDeleting] = useState<any>(null) // connection pending delete confirmation
  const [exporting, setExporting] = useState<any>(null) // connection whose JSON bundle is being downloaded
  const [importDoc, setImportDoc] = useState<ConnectionExport | null>(null) // parsed file awaiting confirmation
  const importFileRef = useRef<HTMLInputElement>(null)
  const [statuses, setStatuses] = useState<Record<string, string>>({})
  const [backups, setBackups] = useState<Record<string, { ts: number; ok: boolean }>>({})

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

  // Latest backup per card (for "Last backup" + the "Last activity" headline).
  useEffect(() => {
    let alive = true
    connections.forEach((c) => {
      listBackupRuns(c.id, { limit: 1 }).then((page) => {
        const run = page.runs[0]
        if (alive && run) setBackups((b) => ({ ...b, [c.id]: { ts: run.finishedAt || run.startedAt, ok: run.status === 'success' } }))
      })
    })
    return () => {
      alive = false
    }
  }, [connections])

  const envs = useMemo(() => {
    const set = new Set<string>()
    connections.forEach((c) => c.environment && set.add(c.environment))
    return [...set]
  }, [connections])

  const folders = useMemo(() => {
    const set = new Set<string>()
    connections.forEach((c) => c.folder && set.add(c.folder))
    return [...set]
  }, [connections])

  const types = useMemo(() => {
    const set = new Set<string>()
    connections.forEach((c) => c.type && set.add(c.type))
    return [...set]
  }, [connections])

  // Headline metrics.
  const stats = useMemo(() => {
    const total = connections.length
    const connected = connections.filter((c) => statuses[c.id] === 'connected').length
    const pct = total ? Math.round((connected / total) * 100) : 0
    const typeLabels = types.map((t) => TYPE_LABEL[t] || t)
    let last: { ts: number; name: string } | null = null
    connections.forEach((c) => {
      const b = backups[c.id]
      if (b && (!last || b.ts > last.ts)) last = { ts: b.ts, name: c.name }
    })
    return { total, connected, pct, typeLabels, last }
  }, [connections, statuses, backups, types])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return connections.filter((c) => {
      const inEnv = activeEnv === 'all' || c.environment === activeEnv
      const inFolder = activeFolder === 'all' || c.folder === activeFolder
      const inType = activeType === 'all' || c.type === activeType
      const inStatus = activeStatus === 'all' || statuses[c.id] === activeStatus
      const matches =
        !q || c.name.toLowerCase().includes(q) || c.host?.toLowerCase().includes(q) || c.filepath?.toLowerCase().includes(q)
      return inEnv && inFolder && inType && inStatus && matches
    })
  }, [connections, activeEnv, activeFolder, activeType, activeStatus, statuses, query])

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

  // Import: parse the picked file here so a bad file is rejected before the
  // confirmation dialog opens.
  const pickImportFile = async (file: File) => {
    try {
      setImportDoc(await readConnectionExportFile(file))
    } catch (e: any) {
      toast.error(`Import failed: ${e.message}`)
    }
  }

  const openConsole = (conn) => connect(conn)
  const subtitle = (c) => (c.type === 'sqlite' ? c.filepath : c.host)
  const dbName = (c) => (c.type === 'sqlite' ? (c.filepath || '').split('/').pop() : c.database)
  const hasFilters =
    activeEnv !== 'all' || activeFolder !== 'all' || activeType !== 'all' || activeStatus !== 'all' || !!query.trim()

  const clearFilters = () => {
    setQuery('')
    setActiveEnv('all')
    setActiveFolder('all')
    setActiveType('all')
    setActiveStatus('all')
  }

  // Table columns. Everything the row shows is derived here so the table itself
  // stays generic; sorting uses `sortValue` wherever the cell isn't plain text.
  const columns = useMemo<Column<any>[]>(
    () => [
      {
        key: 'name',
        header: 'Connection',
        sortable: true,
        sortValue: (c) => c.name,
        render: (c) => (
          <div className="flex min-w-0 items-center gap-3">
            <DbLogo type={c.type} className="h-9 w-9 shrink-0 rounded-[10px]" />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate font-semibold">{c.name}</span>
                <EnvBadge environment={c.environment} />
              </div>
              <div className="mt-0.5 truncate font-mono text-[11px] text-ink-faint">{subtitle(c) || '—'}</div>
            </div>
          </div>
        ),
      },
      {
        key: 'type',
        header: 'Type',
        sortable: true,
        sortValue: (c) => TYPE_LABEL[c.type] || c.type,
        width: 130,
        render: (c) => <span className="text-ink-dim">{TYPE_LABEL[c.type] || c.type}</span>,
      },
      {
        key: 'database',
        header: 'Database',
        sortable: true,
        sortValue: (c) => dbName(c) || '',
        width: 170,
        className: 'max-[1080px]:hidden',
        render: (c) => <span className="block truncate font-mono text-[12px]">{dbName(c) || '—'}</span>,
      },
      {
        key: 'status',
        header: 'Status',
        sortable: true,
        sortValue: (c) => statuses[c.id] || 'zz', // unknown last
        width: 120,
        render: (c) => <StatusBadge status={statuses[c.id]} />,
      },
      {
        key: 'backup',
        header: 'Last backup',
        sortable: true,
        sortValue: (c) => backups[c.id]?.ts ?? 0,
        width: 150,
        className: 'max-[900px]:hidden',
        render: (c) => {
          const backup = backups[c.id]
          if (!backup) return <span className="text-ink-faint">Never</span>
          return (
            <span className="flex items-center gap-1.5">
              {relativeTime(backup.ts)}
              <span className={backup.ok ? 'text-green' : 'text-red'}>
                <CheckIcon width={13} height={13} />
              </span>
            </span>
          )
        },
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        width: 190,
        render: (c) => (
          // Actions never open the detail view the row click opens.
          <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="primary"
              size="sm"
              icon={ExternalLinkIcon}
              disabled={connectingId === c.id}
              onClick={() => openConsole(c)}
            >
              {connectingId === c.id ? 'Connecting…' : 'Connect'}
            </Button>
            <Popover
              align="right"
              width={170}
              portal // the table body scrolls horizontally — an in-flow panel would be clipped
              trigger={({ open, toggle }) => (
                <IconButton onClick={toggle} active={open} aria-label="Connection actions">
                  <MoreVerticalIcon width={16} height={16} />
                </IconButton>
              )}
            >
              {({ close }) => (
                <div className="p-1">
                  <MenuItem onClick={() => { close(); setDetailConn(c) }}>
                    <InfoIcon width={14} height={14} /> Details
                  </MenuItem>
                  <MenuItem onClick={() => { close(); setFormConn({ mode: 'edit', conn: c }) }}>
                    <EditIcon width={14} height={14} /> Edit
                  </MenuItem>
                  <MenuItem onClick={() => { close(); copyUrl(c) }}>
                    <CopyIcon width={14} height={14} /> Copy as URL
                  </MenuItem>
                  <MenuItem onClick={() => { close(); setExporting(c) }}>
                    <DownloadIcon width={14} height={14} /> Export as JSON
                  </MenuItem>
                  <MenuItem danger onClick={() => { close(); setDeleting(c) }}>
                    <TrashIcon width={14} height={14} /> Delete
                  </MenuItem>
                </div>
              )}
            </Popover>
          </div>
        ),
      },
    ],
    [statuses, backups, connectingId],
  )

  // Client-side sort + paging; changing a filter sends the table back to page 1.
  const table = useDataTable({
    rows: filtered,
    columns,
    pageSize: 10,
    resetKey: `${query}|${activeEnv}|${activeFolder}|${activeType}|${activeStatus}`,
  })

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

  // Export/import + handshake dialogs live outside the list ↔ detail switch
  // below, so both views can open them.
  const modals = (
    <>
      {failure && (
        <ConnectHandshakeDialog
          conn={failure.conn}
          result={failure.result}
          busy={connectingId === failure.conn.id}
          onRetry={() => connect(failure.conn)}
          onEdit={() => {
            dismiss()
            setFormConn({ mode: 'edit', conn: failure.conn })
          }}
          onOpenAnyway={() => openAnyway(failure.conn)}
          onClose={dismiss}
        />
      )}
      {exporting && <ConnectionExportModal conn={exporting} onClose={() => setExporting(null)} />}
      {importDoc && (
        <ConnectionImportModal
          doc={importDoc}
          onClose={() => setImportDoc(null)}
          onImported={(conn) => {
            setImportDoc(null)
            setDetailConn(conn)
          }}
        />
      )}
    </>
  )

  if (detailConn) {
    return (
      <>
        <ConnectionDetail
          conn={detailConn}
          onBack={() => setDetailConn(null)}
          onOpen={openConsole}
          connecting={connectingId === detailConn.id}
          onEdit={(c, tab) => setFormConn({ mode: 'edit', conn: c, tab })}
          onDelete={(c) => setDeleting(c)}
          onExport={(c) => setExporting(c)}
        />
        {modals}
      </>
    )
  }

  return (
    <>
      <div className="w-full">
        <PageHeader
          title="Connections"
          desc="Manage the databases connected to this workspace."
          action={
            <div className="flex items-center gap-2">
              <input
                ref={importFileRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) pickImportFile(f)
                  e.target.value = ''
                }}
              />
              <Button size="lg" icon={UploadIcon} onClick={() => importFileRef.current?.click()}>
                Import
              </Button>
              <Button variant="primary" size="lg" icon={PlusIcon} onClick={() => setPicker(true)}>
                New connection
              </Button>
            </div>
          }
        />

        {/* Headline metrics */}
        <div className="mt-6 grid grid-cols-4 gap-4 max-[1080px]:grid-cols-2 max-[560px]:grid-cols-1">
          <StatCard icon={DatabaseIcon} label="Total connections" value={stats.total} sub="All databases" />
          <StatCard
            icon={CheckIcon}
            label="Connected"
            value={stats.connected}
            sub={`${stats.pct}%`}
            tone="green"
          />
          <StatCard
            icon={GridIcon}
            label="Database types"
            value={stats.typeLabels.length}
            sub={stats.typeLabels.join(', ') || '—'}
          />
          <StatCard
            icon={ActivityIcon}
            label="Last activity"
            value={stats.last ? relativeTime(stats.last.ts) : '—'}
            sub={stats.last?.name || 'No backups yet'}
          />
        </div>

        {/* Search + filters */}
        <div className="mt-6 flex flex-wrap items-center gap-3 rounded-card border border-edge bg-card p-3">
          <div className="min-w-[220px] flex-1">
            <SearchInput
              iconSize={16}
              placeholder="Search connections…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              inputClassName="!py-2.5 !pl-10 !text-[13px]"
            />
          </div>
          <Select
            className={`${controlClass} !w-auto min-w-[150px] !py-2.5`}
            value={activeEnv}
            onChange={setActiveEnv}
            options={[{ value: 'all', label: 'All environments' }, ...envs.map((e) => ({ value: e, label: e[0].toUpperCase() + e.slice(1) }))]}
          />
          {folders.length > 0 && (
            <Select
              className={`${controlClass} !w-auto min-w-[140px] !py-2.5`}
              value={activeFolder}
              onChange={setActiveFolder}
              options={[{ value: 'all', label: 'All folders' }, ...folders.map((f) => ({ value: f, label: f }))]}
            />
          )}
          <Select
            className={`${controlClass} !w-auto min-w-[130px] !py-2.5`}
            value={activeType}
            onChange={setActiveType}
            options={[{ value: 'all', label: 'All types' }, ...types.map((t) => ({ value: t, label: TYPE_LABEL[t] || t }))]}
          />
          <Select
            className={`${controlClass} !w-auto min-w-[130px] !py-2.5`}
            value={activeStatus}
            onChange={setActiveStatus}
            options={[
              { value: 'all', label: 'All status' },
              { value: 'connected', label: 'Connected' },
              { value: 'offline', label: 'Offline' },
            ]}
          />
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Clear
            </Button>
          )}
        </div>

        {/* Table */}
        <DataTable
          className="mt-6"
          columns={columns}
          rowKey={(c) => c.id}
          onRowClick={(c) => setDetailConn(c)}
          loading={loading}
          empty={
            hasFilters ? (
              'No connections match your search.'
            ) : (
              <div className="flex flex-col items-center gap-3">
                <span>No connections yet.</span>
                <Button variant="primary" size="sm" icon={PlusIcon} onClick={() => setPicker(true)}>
                  Add new connection
                </Button>
              </div>
            )
          }
          {...table}
        />
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

      {modals}
    </>
  )
}
