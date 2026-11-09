import { useEffect, useState } from 'react'
import EmptyState from '@/shared/ui/feedback/EmptyState'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import Segmented from '@/shared/ui/form/Segmented'
import DataTable, { type Column } from '@/shared/ui/table/DataTable'
import useDataTable from '@/shared/ui/table/useDataTable'
import { getWorkspaceActivity, type AdminWorkspaceActivity, type AdminWorkspaceRun } from '../../api'
import { capitalize, Card, formatDateTime, Meter } from './ui'
import { Badge } from '@/shared/ui/badge'

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'backup', label: 'Backups' },
  { value: 'workflow', label: 'Workflows' },
  { value: 'failed', label: 'Failed' },
]

function took({ startedAt, finishedAt }: AdminWorkspaceRun) {
  if (!finishedAt) return '—'
  const seconds = Math.round((finishedAt - startedAt) / 1000)
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
}

const columns: Column<AdminWorkspaceRun>[] = [
  {
    key: 'name',
    header: 'Run',
    render: (r) => (
      <>
        <div className="text-[12px] font-medium text-foreground">{r.name || 'Backup'}</div>
        <div className="text-[11px] text-muted-foreground">{capitalize(r.kind)}</div>
      </>
    ),
  },
  {
    key: 'connectionName',
    header: 'Connection',
    width: 180,
    render: (r) => <span className="font-mono text-[11px] text-muted-foreground">{r.connectionName || '—'}</span>,
  },
  { key: 'trigger', header: 'Trigger', width: 110, render: (r) => <span className="text-[12px] text-muted-foreground">{capitalize(r.trigger)}</span> },
  {
    key: 'status',
    header: 'Result',
    width: 100,
    render: (r) =>
      r.status === 'failed' ? <Badge variant="destructive">failed</Badge> : <Badge variant="default">{r.status === 'success' ? 'succeeded' : r.status}</Badge>,
  },
  { key: 'took', header: 'Took', align: 'right', width: 90, render: (r) => <span className="text-[12px] text-muted-foreground">{took(r)}</span> },
  { key: 'startedAt', header: 'Started', width: 140, render: (r) => <span className="text-[12px] text-muted-foreground">{formatDateTime(r.startedAt)}</span> },
]

function Busiest({ title, rows, mono = false }: { title: string; rows: { id: string; name: string; queries: number }[]; mono?: boolean }) {
  return (
    <Card title={title}>
      {rows.length === 0 ? (
        <EmptyState>No queries in the last 30 days.</EmptyState>
      ) : (
        rows.map((r) => <Meter key={r.id} label={r.name} count={r.queries} max={rows[0].queries} mono={mono} />)
      )}
    </Card>
  )
}

/** Runs and how busy things are. Counts only: what anyone actually ran stays in the workspace. */
export default function ActivityTab({ workspaceId }: { workspaceId: string }) {
  const [activity, setActivity] = useState<AdminWorkspaceActivity | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    getWorkspaceActivity(workspaceId).then((a) => {
      setActivity(a)
      setLoading(false)
    })
  }, [workspaceId])

  const runs = (activity?.runs || []).filter((r) => filter === 'all' || (filter === 'failed' ? r.status === 'failed' : r.kind === filter))
  const table = useDataTable({ rows: runs, columns, pageSize: 10, resetKey: filter })

  if (loading) return <LoadingState className="py-10 text-center" />
  if (!activity) return <EmptyState className="py-10">Couldn’t load this workspace’s activity.</EmptyState>

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(380px,100%),1fr))] gap-5">
        <Busiest title="Busiest connections, 30 days" rows={activity.busiestConnections} mono />
        <Busiest title="Most active members, 30 days" rows={activity.activeMembers} />
      </div>
      <section>
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[13px] font-bold">Recent runs</h2>
          <Segmented value={filter} onChange={setFilter} options={FILTERS} />
        </div>
        <DataTable
          columns={columns}
          rowKey={(r) => `${r.kind}-${r.id}`}
          empty={activity.runs.length ? 'No runs match that filter.' : 'No backup or workflow has run yet.'}
          {...table}
        />
      </section>
    </div>
  )
}
