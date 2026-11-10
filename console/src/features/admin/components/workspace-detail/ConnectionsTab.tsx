import { useEffect, useState } from 'react'
import SearchInput from '@/shared/ui/form/SearchInput'
import Segmented from '@/shared/ui/form/Segmented'
import { DbLogo } from '@/shared/ui/icons'
import DataTable, { type Column } from '@/shared/ui/table/DataTable'
import useDataTable from '@/shared/ui/table/useDataTable'
import useListView from '@/shared/ui/table/useListView'
import ViewToggle from '@/shared/ui/table/ViewToggle'
import { TYPE_LABEL } from '@/shared/config/databaseTypes'
import { listWorkspaceConnectionsAs, type AdminWorkspaceConnection } from '../../api'
import { capitalize, formatDate } from './ui'
import { Badge } from '@/shared/ui/badge'

const engineLabel = (type: string) => TYPE_LABEL[type] || type

const hourLabel = (hour: number) => `${String(hour).padStart(2, '0')}:00`

function backupLabel({ backup }: AdminWorkspaceConnection) {
  if (!backup) return 'Off'
  if (backup.consecutiveFailures === 1) return 'Last run failed'
  if (backup.consecutiveFailures > 1) return `Failed ${backup.consecutiveFailures} runs in a row`
  return backup.frequency === 'hourly' ? 'Hourly' : `Daily, ${hourLabel(backup.hourOfDay)} UTC`
}

/** What each connection is, never what's in it: there is deliberately no way in from here. */
export default function ConnectionsTab({ workspaceId }: { workspaceId: string }) {
  const [rows, setRows] = useState<AdminWorkspaceConnection[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [engine, setEngine] = useState('all')

  useEffect(() => {
    listWorkspaceConnectionsAs(workspaceId).then((list) => {
      setRows(list)
      setLoading(false)
    })
  }, [workspaceId])

  const needle = query.trim().toLowerCase()
  const filtered = rows
    .filter((c) => engine === 'all' || c.type === engine)
    .filter((c) => !needle || c.name.toLowerCase().includes(needle))

  const columns: Column<AdminWorkspaceConnection>[] = [
    {
      key: 'name',
      header: 'Connection',
      sortable: true,
      render: (c) => (
        <div className="flex items-center gap-2.5">
          <DbLogo type={c.type} className="h-7 w-7 shrink-0" />
          <div className="min-w-0">
            <div className="truncate text-[12px] font-medium text-foreground">{c.name}</div>
            <div className="text-[11px] text-muted-foreground">{engineLabel(c.type)}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'environment',
      header: 'Environment',
      sortable: true,
      width: 124,
      render: (c) => <span className="text-[12px] text-muted-foreground">{c.environment ? capitalize(c.environment) : '—'}</span>,
    },
    {
      key: 'state',
      header: 'State',
      sortable: true,
      width: 96,
      render: (c) => <Badge variant={c.state === 'locked' ? 'warning' : 'default'}>{c.state}</Badge>,
    },
    {
      key: 'ownerName',
      header: 'Owner',
      sortable: true,
      width: 150,
      render: (c) => <span className="text-[12px] text-muted-foreground">{c.ownerName || '—'}</span>,
    },
    {
      key: 'canOpen',
      header: 'Can open',
      sortable: true,
      width: 124,
      render: (c) => (
        <span className={`whitespace-nowrap text-[12px] ${c.canOpen ? 'text-muted-foreground' : 'text-warning'}`}>
          {c.canOpen === 0 ? 'Nobody' : c.canOpen === 1 ? '1 person' : `${c.canOpen} people`}
        </span>
      ),
    },
    {
      key: 'backup',
      header: 'Backup',
      width: 190,
      render: (c) => (
        <span className={`whitespace-nowrap text-[12px] ${c.backup?.consecutiveFailures ? 'text-destructive' : 'text-muted-foreground'}`}>{backupLabel(c)}</span>
      ),
    },
    {
      key: 'createdAt',
      header: 'Created',
      sortable: true,
      width: 124,
      render: (c) => <span className="text-[12px] text-muted-foreground">{formatDate(c.createdAt)}</span>,
    },
  ]

  const [view, setView] = useListView('admin-workspace-connections')
  const table = useDataTable({ rows: filtered, columns, pageSize: 10, resetKey: `${query}|${engine}`, view })
  const engines = [...new Set(rows.map((c) => c.type))]

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12px] text-muted-foreground">
        Admins see what a connection is, not what’s in it. Opening one and reading its credentials stay with the workspace.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput className="min-w-[220px] flex-1" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search connections…" />
        {engines.length > 1 && (
          <Segmented
            value={engine}
            onChange={setEngine}
            options={[{ value: 'all', label: 'All' }, ...engines.map((type) => ({ value: type, label: engineLabel(type) }))]}
          />
        )}
        <ViewToggle value={view} onChange={setView} />
      </div>
      <DataTable
        columns={columns}
        rowKey={(c) => c.id}
        loading={loading}
        empty={rows.length ? 'No connections match that filter.' : 'This workspace has no connections yet.'}
        {...table}
      />
    </div>
  )
}
