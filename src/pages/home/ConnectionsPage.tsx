import { useEffect, useMemo, useRef, useState } from 'react'
import {
  useConnections, ConnectionForm, ConnectionDetail, DbTypePickerModal,
  ConnectionExportModal, ConnectionImportModal, readConnectionExportFile,
  ConnectHandshakeDialog, useConnectHandshake,
  StatusBadge, connectionUrl, TYPE_LABEL, EnvBadge,
} from '@/features/connections'
import type { ConnectionExport } from '@/features/connections'
import { useWorkspaces } from '@/features/workspaces'
import { pingConnection } from '@/shared/api/database'
import { listBackupRuns } from '@/features/backup'
import { relativeTime } from '@/shared/lib/recents'
import Button from '@/shared/ui/buttons/Button'
import MenuItem from '@/shared/ui/navigation/MenuItem'
import Select from '@/shared/ui/form/Select'
import { controlClass } from '@/shared/ui/form/Input'
import ConfirmDialog from '@/shared/ui/feedback/ConfirmDialog'
import { useToast } from '@/shared/ui/feedback/Toast'
import {
  CheckIcon,
  CopyIcon,
  DbLogo,
  DownloadIcon,
  EditIcon,
  ExternalLinkIcon,
  InfoIcon,
  PlusIcon,
  TrashIcon,
  UploadIcon,
} from '@/shared/ui/icons'
import SearchInput from '@/shared/ui/form/SearchInput'
import DataTable from '@/shared/ui/table/DataTable'
import type { Column } from '@/shared/ui/table/DataTable'
import { RowActions, RowMenu } from '@/shared/ui/table/RowActions'
import useDataTable from '@/shared/ui/table/useDataTable'
import { PageHeader } from './ui'

// ---- Connections section: list + detail + create/edit forms (thin composition;
// the detail view and db-type picker live in features/connections) ----
export default function ConnectionsPage() {
  const toast = useToast()
  // "Connect" handshakes first and only routes into the console once the
  // database answered; a failure opens ConnectHandshakeDialog with the cause.
  const { connect, connectingId, failure, dismiss, openAnyway } = useConnectHandshake()
  const { connections, loading, addConnection, updateConnection, removeConnection } = useConnections()
  // Owners define connections; members open the ones they've been granted.
  const { current } = useWorkspaces()
  const isOwner = current?.role === 'owner'

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

  // Latest backup per connection, for the table's "Last backup" column.
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
        render: (c) => <span className="block truncate text-[12px]">{dbName(c) || '—'}</span>,
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
          <RowActions>
            {/* The one action worth a word — everything else lives in the menu. */}
            <Button
              variant="primary"
              size="sm"
              disabled={connectingId === c.id}
              onClick={() => openConsole(c)}
            >
              {connectingId === c.id ? 'Connecting…' : 'Connect'}
            </Button>
            <RowMenu label={`Actions for ${c.name}`}>
              {({ close }) => (
                <div className="p-1">
                  <MenuItem onClick={() => { close(); setDetailConn(c) }}>
                    <InfoIcon width={14} height={14} /> Details
                  </MenuItem>
                  {/* Defining a connection is the owner's job; a member uses it. */}
                  {isOwner && (
                    <MenuItem onClick={() => { close(); setFormConn({ mode: 'edit', conn: c }) }}>
                      <EditIcon width={14} height={14} /> Edit
                    </MenuItem>
                  )}
                  <MenuItem onClick={() => { close(); copyUrl(c) }}>
                    <CopyIcon width={14} height={14} /> Copy as URL
                  </MenuItem>
                  {isOwner && (
                    <MenuItem onClick={() => { close(); setExporting(c) }}>
                      <DownloadIcon width={14} height={14} /> Export as JSON
                    </MenuItem>
                  )}
                  {isOwner && (
                    <MenuItem danger onClick={() => { close(); setDeleting(c) }}>
                      <TrashIcon width={14} height={14} /> Delete
                    </MenuItem>
                  )}
                </div>
              )}
            </RowMenu>
          </RowActions>
        ),
      },
    ],
    [statuses, backups, connectingId, isOwner],
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
          desc={isOwner ? 'Manage the databases connected to this workspace.' : 'The databases you can open in this workspace.'}
          action={
            isOwner && (
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
            )
          }
        />

        {/* Search + filters — bare row (same shape as the admin user/workspace lists) */}
        <div className="mb-4 mt-6 flex flex-wrap items-center gap-2">
          <SearchInput
            className="min-w-[220px] flex-1"
            placeholder="Search connections…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Select
            className={`${controlClass} !w-auto min-w-[150px] shrink-0`}
            value={activeEnv}
            onChange={setActiveEnv}
            options={[{ value: 'all', label: 'All environments' }, ...envs.map((e) => ({ value: e, label: e[0].toUpperCase() + e.slice(1) }))]}
          />
          {folders.length > 0 && (
            <Select
              className={`${controlClass} !w-auto min-w-[140px] shrink-0`}
              value={activeFolder}
              onChange={setActiveFolder}
              options={[{ value: 'all', label: 'All folders' }, ...folders.map((f) => ({ value: f, label: f }))]}
            />
          )}
          <Select
            className={`${controlClass} !w-auto min-w-[130px] shrink-0`}
            value={activeType}
            onChange={setActiveType}
            options={[{ value: 'all', label: 'All types' }, ...types.map((t) => ({ value: t, label: TYPE_LABEL[t] || t }))]}
          />
          <Select
            className={`${controlClass} !w-auto min-w-[130px] shrink-0`}
            value={activeStatus}
            onChange={setActiveStatus}
            options={[
              { value: 'all', label: 'All status' },
              { value: 'connected', label: 'Connected' },
              { value: 'offline', label: 'Offline' },
            ]}
          />
          {hasFilters && (
            <Button variant="ghost" size="sm" className="shrink-0" onClick={clearFilters}>
              Clear
            </Button>
          )}
        </div>

        {/* Table */}
        <DataTable
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
