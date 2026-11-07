import type { ComponentType } from 'react'
import Badge from '@/shared/ui/Badge'
import Button from '@/shared/ui/buttons/Button'
import IconButton from '@/shared/ui/buttons/IconButton'
import TextButton from '@/shared/ui/buttons/TextButton'
import PersonRow from '@/shared/ui/PersonRow'
import { useToast } from '@/shared/ui/feedback/Toast'
import { AlertIcon, CopyIcon, LockIcon, MailIcon, ShieldIcon } from '@/shared/ui/icons'
import { TYPE_LABEL } from '@/shared/config/databaseTypes'
import type { AdminWorkspaceOverview } from '../../api'
import QueryChart from './QueryChart'
import { capitalize, Card, formatCount, formatDate, Meter, StatRow, StatTile } from './ui'

type Attention = {
  icon: ComponentType<{ width?: number; height?: number }>
  tone: string
  title: string
  sub: string
  action: string
  tab: string
}

const RED = 'bg-red/15 text-red'
const AMBER = 'bg-amber/15 text-amber'

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function attentionRows({ owners, attention, counts }: AdminWorkspaceOverview): Attention[] {
  const rows: Attention[] = []
  if (!owners.length) {
    rows.push({
      icon: ShieldIcon,
      tone: RED,
      title: 'This workspace has no owner',
      sub: 'Nobody holds workspace.manage, so nobody inside it can change roles or settings.',
      action: 'Assign owner',
      tab: 'members',
    })
  }
  for (const b of attention.failingBackups) {
    rows.push({
      icon: AlertIcon,
      tone: RED,
      title: `Backups failing on ${b.name}`,
      sub: `Last ${plural(b.consecutiveFailures, 'run')} failed.${b.lastSuccessAt ? ` Last success ${formatDate(b.lastSuccessAt)}.` : ''}`,
      action: 'View activity',
      tab: 'activity',
    })
  }
  if (attention.lockedConnections.length) {
    const one = attention.lockedConnections.length === 1
    rows.push({
      icon: LockIcon,
      tone: AMBER,
      title: `${plural(attention.lockedConnections.length, 'connection is', 'connections are')} locked`,
      sub: `${one ? 'Its' : 'Their'} engine is turned off in Modules, so ${attention.lockedConnections.join(', ')} ${one ? 'refuses' : 'refuse'} everything but delete.`,
      action: 'View connections',
      tab: 'connections',
    })
  }
  if (counts.pendingMembers) {
    rows.push({
      icon: MailIcon,
      tone: AMBER,
      title: `${plural(counts.pendingMembers, 'person hasn’t', 'people haven’t')} accepted their invitation`,
      sub: 'They are on the roster but can’t sign in until they set a password.',
      action: 'View members',
      tab: 'members',
    })
  }
  return rows
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-dim">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

export default function OverviewTab({ overview, onTab }: { overview: AdminWorkspaceOverview; onTab: (id: string) => void }) {
  const toast = useToast()
  const { workspace, owners, counts, queries, backups, engines, environments } = overview
  const rows = attentionRows(overview)
  const failedPct = queries.total ? ((queries.failed / queries.total) * 100).toFixed(1) : '0'

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(workspace.id)
      toast.success('Workspace ID copied.')
    } catch {
      toast.error('Couldn’t copy the ID.')
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {rows.length > 0 && (
        <section aria-labelledby="ws-attention" className="rounded-card border border-edge bg-card">
          <h2 id="ws-attention" className="border-b border-edge px-4 py-3.5 text-[13px] font-bold">
            Needs attention <span className="ml-1 font-medium text-ink-dim">{rows.length}</span>
          </h2>
          {rows.map((r) => (
            <div key={r.title} className="flex flex-wrap items-center gap-3 border-b border-edge px-4 py-3 last:border-b-0">
              <span className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[8px] ${r.tone}`}>
                <r.icon width={15} height={15} />
              </span>
              <div className="min-w-0 flex-[1_1_320px]">
                <div className="text-[13px] font-semibold">{r.title}</div>
                <div className="mt-0.5 text-[12px] text-ink-dim">{r.sub}</div>
              </div>
              <Button size="sm" onClick={() => onTab(r.tab)}>
                {r.action}
              </Button>
            </div>
          ))}
        </section>
      )}

      <StatRow>
        <StatTile label="Members" value={counts.members} sub={`${counts.members - counts.pendingMembers} active · ${counts.pendingMembers} pending`} />
        <StatTile
          label="Connections"
          value={counts.connections}
          sub={`${counts.connections - counts.lockedConnections} active · ${counts.lockedConnections} locked`}
        />
        <StatTile label="Queries, 30 days" value={formatCount(queries.total)} sub={`${failedPct}% failed`} />
        <StatTile
          label="Backups, 30 days"
          value={backups.runs ? `${Math.round((backups.succeeded / backups.runs) * 100)}%` : '—'}
          sub={backups.runs ? `${backups.succeeded} of ${plural(backups.runs, 'run')} succeeded` : 'No runs yet'}
        />
      </StatRow>

      <div className="flex flex-wrap items-start gap-5">
        <div className="flex min-w-0 flex-[999_1_520px] flex-col gap-5">
          <Card title="Queries per day, last 30 days">
            <QueryChart days={queries.days} />
          </Card>
          {counts.connections > 0 && (
            <Card>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-7">
                <div>
                  <h2 className="mb-3.5 text-[13px] font-bold">Connections by engine</h2>
                  {engines.map((e) => (
                    <Meter
                      key={e.type}
                      label={TYPE_LABEL[e.type] || e.type}
                      count={e.count}
                      max={engines[0].count}
                      meta={e.locked && <Badge tone="amber">locked</Badge>}
                    />
                  ))}
                </div>
                <div>
                  <h2 className="mb-3.5 text-[13px] font-bold">Connections by environment</h2>
                  {environments.map((e) => (
                    <Meter
                      key={e.environment}
                      label={e.environment === 'unset' ? 'Not set' : capitalize(e.environment)}
                      count={e.count}
                      max={environments[0].count}
                    />
                  ))}
                </div>
              </div>
            </Card>
          )}
        </div>

        <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-5">
          <Card title="Owners" aside={<TextButton onClick={() => onTab('members')}>Manage</TextButton>}>
            {owners.length === 0 ? (
              <div className="rounded-soft border border-dashed border-edge-strong px-3 py-5 text-center text-[12px] text-ink-dim">
                Nobody can run this workspace yet.
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {owners.map((o) => (
                  <div key={o.userId} className="flex items-center gap-2.5">
                    <PersonRow stacked size="md" name={o.name} email={o.email} emailClassName="!text-[11px] !text-ink-dim" />
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Details">
            <dl className="flex flex-col gap-3 text-[12px]">
              <div>
                <dt className="text-[11px] text-ink-dim">Workspace ID</dt>
                <dd className="mt-0.5 flex items-center gap-1.5">
                  <span className="break-all font-mono text-[11px]">{workspace.id}</span>
                  <IconButton size="sm" className="shrink-0" aria-label="Copy workspace ID" onClick={copyId}>
                    <CopyIcon width={13} height={13} />
                  </IconButton>
                </dd>
              </div>
              <Detail label="Groups">{counts.groups}</Detail>
              <Detail label="Sessions per connection">{workspace.maxSessionsPerConnection || 'Not set'}</Detail>
              <Detail label="Backup failure alerts">{workspace.backupFailureAlerts ? 'On' : 'Off'}</Detail>
            </dl>
          </Card>
        </div>
      </div>
    </div>
  )
}
