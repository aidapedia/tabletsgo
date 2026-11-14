import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  useConnections, DbTypePickerModal,
  ConnectionExportModal, ConnectionImportModal, readConnectionExportFile,
  ConnectHandshakeDialog, useConnectHandshake,
  StatusBadge, connectionUrl, TYPE_LABEL, EnvBadge, ConnectionCard,
} from '@/features/connections'
import type { ConnectionExport } from '@/features/connections'
import { useWorkspaces, can } from '@/features/workspaces'
import { useAuth } from '@/features/auth'
import { pingConnection } from '@/shared/api/database'
import { listBackupRuns } from '@/features/backup'
import { relativeTime } from '@/shared/lib/recents'
import MenuItem from '@/shared/ui/navigation/MenuItem'
import { toast } from 'sonner'
import {
  CheckIcon,
  CopyIcon,
  DbLogo,
  DownloadIcon,
  EditIcon,
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
import useListView from '@/shared/ui/table/useListView'
import ViewToggle from '@/shared/ui/table/ViewToggle'
import PageHeader from '@/shared/ui/page/PageHeader'
import { Button } from '@/shared/ui/button'
import OptionSelect from '@/shared/ui/form/OptionSelect'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'

// ---- `/connections`: the list. Detail and the create/edit form are their own
// routes (ConnectionDetailPage / ConnectionFormPage) so both are linkable. ----
export default function ConnectionsPage() {
  const navigate = useNavigate()
  // "Connect" handshakes first and only routes into the console once the
  // database answered; a failure opens ConnectHandshakeDialog with the cause.
  const { connect, connectingId, failure, dismiss, openAnyway } = useConnectHandshake()
  const { connections, loading, removeConnection } = useConnections()
  const { current } = useWorkspaces()
  const { user } = useAuth()
  // Two different questions. Creating a connection is a workspace-wide
  // capability; editing or deleting an existing one also passes for whoever owns
  // that particular connection, which is what lets a member run their own.
  const canCreate = can(current, 'connections.create')
  const canManageAll = can(current, 'connections.manage')
  const canManageConn = (c: any) => canManageAll || (!!user && c.ownerId === user.id)

  const [query, setQuery] = useState('')
  const [activeEnv, setActiveEnv] = useState('all')
  const [activeFolder, setActiveFolder] = useState('all')
  const [activeType, setActiveType] = useState('all')
  const [activeStatus, setActiveStatus] = useState('all')
  const [view, setView] = useListView('connections')
  const [picker, setPicker] = useState(false) // db-type picker open
  const [deleting, setDeleting] = useState<any>(null) // connection pending delete confirmation
  const [exporting, setExporting] = useState<any>(null) // connection whose JSON bundle is being downloaded
  const [importDoc, setImportDoc] = useState<ConnectionExport | null>(null) // parsed file awaiting confirmation
  const importFileRef = useRef<HTMLInputElement>(null)
  const [statuses, setStatuses] = useState<Record<string, string>>({})
  const [backups, setBackups] = useState<Record<string, { ts: number; ok: boolean }>>({})

  // Live connectivity per row.
  useEffect(() => {
    let alive = true
    connections.forEach((c) => {
      // Its database is turned off on this instance — nothing to probe.
      if (c.locked) return setStatuses((s) => ({ ...s, [c.id]: 'locked' }))
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

  const confirmDelete = () => {
    const conn = deleting
    setDeleting(null)
    if (conn) removeConnection(conn.id).catch((error) => toast.error(error.message || 'Could not delete the connection.'))
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

  const openDetail = (conn) => navigate(`/connections/${conn.id}`)
  const openEdit = (conn) => navigate(`/connections/${conn.id}/edit`)
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

  // The last-backup cell and the action strip, shared by the table and the grid.
  const renderBackup = (c) => {
    const backup = backups[c.id]
    if (!backup) return <span className="text-faint">Never</span>
    return (
      <span className="flex items-center gap-1.5">
        {relativeTime(backup.ts)}
        <span className={backup.ok ? 'text-primary' : 'text-destructive'}>
          <CheckIcon width={13} height={13} />
        </span>
      </span>
    )
  }

  const renderActions = (c) => (
    <RowActions>
      {/* The one action worth a word — everything else lives in the menu. */}
      <Button
        variant="default"
        size="sm"
        disabled={connectingId === c.id || c.locked}
        title={c.locked ? `${TYPE_LABEL[c.type] || c.type} is turned off on this instance` : undefined}
        onClick={() => connect(c)}
      >
        {connectingId === c.id ? 'Connecting…' : 'Connect'}
      </Button>
      <RowMenu label={`Actions for ${c.name}`}>
        {({ close }) => (
          <div className="p-1">
            <MenuItem onClick={() => { close(); openDetail(c) }}>
              <InfoIcon width={14} height={14} /> Details
            </MenuItem>
            {/* Changing the connection *record* — whoever manages every
                connection here, or whoever owns this one. */}
            {/* A locked connection can only be deleted — editing or exporting
                it is refused until its database is turned back on. */}
            {canManageConn(c) && !c.locked && (
              <MenuItem onClick={() => { close(); openEdit(c) }}>
                <EditIcon width={14} height={14} /> Edit
              </MenuItem>
            )}
            <MenuItem onClick={() => { close(); copyUrl(c) }}>
              <CopyIcon width={14} height={14} /> Copy as URL
            </MenuItem>
            {canManageConn(c) && !c.locked && (
              <MenuItem onClick={() => { close(); setExporting(c) }}>
                <DownloadIcon width={14} height={14} /> Export as JSON
              </MenuItem>
            )}
            {canManageConn(c) && (
              <MenuItem danger onClick={() => { close(); setDeleting(c) }}>
                <TrashIcon width={14} height={14} /> Delete
              </MenuItem>
            )}
          </div>
        )}
      </RowMenu>
    </RowActions>
  )

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
              <div className="mt-0.5 truncate font-mono text-[11px] text-faint">{subtitle(c) || '—'}</div>
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
        render: (c) => <span className="text-muted-foreground">{TYPE_LABEL[c.type] || c.type}</span>,
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
        render: renderBackup,
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        width: 190,
        render: renderActions,
      },
    ],
    [statuses, backups, connectingId, canManageAll, user?.id],
  )

  // Client-side sort + paging; changing a filter sends the table back to page 1.
  const table = useDataTable({
    rows: filtered,
    columns,
    pageSize: 10,
    resetKey: `${query}|${activeEnv}|${activeFolder}|${activeType}|${activeStatus}`,
    view,
  })

  return (
    <>
      <div className="w-full">
        <PageHeader
          title="Connections"
          desc={canCreate ? 'Manage the databases connected to this workspace.' : 'The databases you can open in this workspace.'}
          action={
            canCreate && (
              <>
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
                <Button variant="outline" size="lg" onClick={() => importFileRef.current?.click()}>
                  <UploadIcon width={15} height={15} />
                  Restore
                </Button>
                <Button variant="default" size="lg" onClick={() => setPicker(true)}>
                  <PlusIcon width={15} height={15} />
                  New connection
                </Button>
              </>
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
          <OptionSelect
            className="!w-auto min-w-[150px] shrink-0"
            value={activeEnv}
            onChange={setActiveEnv}
            options={[{ value: 'all', label: 'All environments' }, ...envs.map((e) => ({ value: e, label: e[0].toUpperCase() + e.slice(1) }))]}
          />
          {folders.length > 0 && (
            <OptionSelect
              className="!w-auto min-w-[140px] shrink-0"
              value={activeFolder}
              onChange={setActiveFolder}
              options={[{ value: 'all', label: 'All folders' }, ...folders.map((f) => ({ value: f, label: f }))]}
            />
          )}
          <OptionSelect
            className="!w-auto min-w-[130px] shrink-0"
            value={activeType}
            onChange={setActiveType}
            options={[{ value: 'all', label: 'All types' }, ...types.map((t) => ({ value: t, label: TYPE_LABEL[t] || t }))]}
          />
          <OptionSelect
            className="!w-auto min-w-[130px] shrink-0"
            value={activeStatus}
            onChange={setActiveStatus}
            options={[
              { value: 'all', label: 'All status' },
              { value: 'connected', label: 'Connected' },
              { value: 'offline', label: 'Offline' },
            ]}
          />
          {hasFilters && (
            <Button variant="outline" size="sm" className="shrink-0" onClick={clearFilters}>
              Clear
            </Button>
          )}
          <ViewToggle value={view} onChange={setView} />
        </div>

        <DataTable
          columns={columns}
          rowKey={(c) => c.id}
          onRowClick={openDetail}
          loading={loading}
          renderCard={(c) => (
            <ConnectionCard
              conn={c}
              status={statuses[c.id]}
              lastBackup={renderBackup(c)}
              actions={renderActions(c)}
              onClick={() => openDetail(c)}
            />
          )}
          empty={
            hasFilters ? (
              'No connections match your search.'
            ) : (
              <div className="flex flex-col items-center gap-3">
                <span>No connections yet.</span>
                <Button variant="default" size="sm" onClick={() => setPicker(true)}>
                  <PlusIcon width={15} height={15} />
                  Add new connection
                </Button>
              </div>
            )
          }
          {...table}
        />
      </div>

      {/* DB-type picker — a shortcut into the form route with the engine chosen. */}
      {picker && (
        <DbTypePickerModal
          onClose={() => setPicker(false)}
          onPick={(typeId) => {
            setPicker(false)
            navigate(`/connections/new?type=${typeId}`)
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete connection?"
          description={`Delete connection "${deleting.name}"? Its saved queries, workflows and history will be removed too.`}
          confirmLabel="Delete"
          cancelLabel="Cancel"
          destructive
          onConfirm={confirmDelete}
          onCancel={() => setDeleting(null)}
        />
      )}

      {exporting && <ConnectionExportModal conn={exporting} onClose={() => setExporting(null)} />}

      {importDoc && (
        <ConnectionImportModal
          doc={importDoc}
          onClose={() => setImportDoc(null)}
          onImported={(conn) => {
            setImportDoc(null)
            navigate(`/connections/${conn.id}`)
          }}
        />
      )}

      {failure && (
        <ConnectHandshakeDialog
          conn={failure.conn}
          result={failure.result}
          busy={connectingId === failure.conn.id}
          onRetry={() => connect(failure.conn)}
          onEdit={() => {
            dismiss()
            openEdit(failure.conn)
          }}
          onOpenAnyway={() => openAnyway(failure.conn)}
          onClose={dismiss}
        />
      )}
    </>
  )
}
