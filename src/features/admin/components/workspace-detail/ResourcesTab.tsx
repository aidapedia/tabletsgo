import { useEffect, useState, type ReactNode } from 'react'
import Badge from '@/shared/ui/Badge'
import EmptyState from '@/shared/ui/feedback/EmptyState'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import DataTable, { type Column } from '@/shared/ui/table/DataTable'
import { getWorkspaceResources, type AdminWorkspaceResources } from '../../api'
import { StatRow, StatTile } from './ui'

const across = (n: number) => `Across ${n} connection${n === 1 ? '' : 's'}`

const dim = (value: ReactNode, mono = false) => (
  <span className={mono ? 'font-mono text-[11px] text-ink-dim' : 'text-[12px] text-ink-dim'}>{value}</span>
)

const strong = (value: ReactNode) => <span className="text-[12px] font-medium text-ink">{value}</span>

function ResourceTable<T>({
  title,
  rows,
  columns,
  rowKey,
  empty,
}: {
  title: string
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string
  empty: string
}) {
  return (
    <section className="min-w-0">
      <h2 className="mb-2.5 text-[13px] font-bold">
        {title} <span className="ml-1 font-medium text-ink-dim">{rows.length}</span>
      </h2>
      <DataTable columns={columns} rows={rows} rowKey={rowKey} empty={empty} />
    </section>
  )
}

/**
 * What the workspace holds, and so what deleting it would take with it. Secrets
 * never reach this page: the server selects names, addresses and fingerprints.
 */
export default function ResourcesTab({ workspaceId }: { workspaceId: string }) {
  const [resources, setResources] = useState<AdminWorkspaceResources | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getWorkspaceResources(workspaceId).then((r) => {
      setResources(r)
      setLoading(false)
    })
  }, [workspaceId])

  if (loading) return <LoadingState className="py-10 text-center" />
  if (!resources) return <EmptyState className="py-10">Couldn’t load this workspace’s resources.</EmptyState>

  const { totals, groups, storage, sshHosts, sshKeys } = resources

  return (
    <div className="flex flex-col gap-5">
      <StatRow>
        <StatTile label="Dashboards" value={totals.dashboards.total} sub={across(totals.dashboards.connections)} />
        <StatTile label="Workflows" value={totals.workflows.total} sub={`${totals.scheduledWorkflows} on a schedule`} />
        <StatTile label="Saved queries" value={totals.savedQueries.total} sub={across(totals.savedQueries.connections)} />
        <StatTile label="Schema drafts" value={totals.schemaDrafts} sub="Not tied to a connection" />
      </StatRow>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(460px,100%),1fr))] items-start gap-5">
        <ResourceTable
          title="Groups"
          rows={groups}
          rowKey={(g) => g.id}
          empty="No groups yet."
          columns={[
            { key: 'name', header: 'Name', render: (g) => strong(g.name) },
            { key: 'people', header: 'People', align: 'right' },
            { key: 'connections', header: 'Connections', align: 'right' },
          ]}
        />
        <ResourceTable
          title="Storage destinations"
          rows={storage}
          rowKey={(s) => s.id}
          empty="No storage destinations yet."
          columns={[
            { key: 'name', header: 'Name', render: (s) => strong(s.name) },
            { key: 'bucket', header: 'Bucket', render: (s) => dim(s.bucket, true) },
            { key: 'region', header: 'Region', render: (s) => dim(s.region || '—') },
            { key: 'schedules', header: 'Schedules', align: 'right' },
          ]}
        />
        <ResourceTable
          title="SSH hosts"
          rows={sshHosts}
          rowKey={(h) => h.id}
          empty="No SSH hosts yet."
          columns={[
            { key: 'name', header: 'Name', render: (h) => strong(h.name) },
            { key: 'host', header: 'Address', render: (h) => dim(h.transport === 'tcp' ? `${h.host}:${h.port}` : h.host, true) },
            { key: 'transport', header: 'Transport', render: (h) => dim(h.transport === 'tcp' ? 'SSH' : 'Cloudflare Access') },
            {
              key: 'hostKeyPinned',
              header: 'Host key',
              render: (h) => <Badge tone={h.hostKeyPinned ? 'green' : 'amber'}>{h.hostKeyPinned ? 'pinned' : 'not pinned'}</Badge>,
            },
          ]}
        />
        <ResourceTable
          title="SSH keys"
          rows={sshKeys}
          rowKey={(k) => k.id}
          empty="No SSH keys yet."
          columns={[
            { key: 'name', header: 'Name', render: (k) => strong(k.name) },
            { key: 'algorithm', header: 'Algorithm', render: (k) => dim(k.algorithm || '—') },
            { key: 'fingerprint', header: 'Fingerprint', render: (k) => dim(k.fingerprint || '—', true) },
          ]}
        />
      </div>
    </div>
  )
}
