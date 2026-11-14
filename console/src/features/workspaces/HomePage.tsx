import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/features/auth'
import { DbTypePickerModal, useConnections } from '@/features/connections'
import { useWorkspaces } from './stores/WorkspaceContext'
import { can } from './api'
import { Button } from '@/shared/ui/button'
import { DatabaseIcon, GridIcon, PlusIcon, UsersIcon, WorkflowIcon } from '@/shared/ui/icons'
import { formatTime } from '@/shared/lib/datetime'
import PageHeader from '@/shared/ui/page/PageHeader'
import { useHomeOverview } from './hooks/useHomeOverview'
import StatTile from './components/home/StatTile'
import ConnectionsPanel from './components/home/ConnectionsPanel'
import AutomationPanel from './components/home/AutomationPanel'
import ActivityPanel from './components/home/ActivityPanel'
import GettingStarted from './components/home/GettingStarted'

// In the zone the person's account is set to, like every other time the app shows.
function greeting() {
  const hour = Number(formatTime(Date.now(), { hour: '2-digit', hourCycle: 'h23' }))
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

// Home — the default landing: what this workspace holds, what needs a look, and
// the shortest way into a console. Not to be confused with the Dashboard
// section (DashboardsPage), which lists the query dashboards built on its
// connections.
export default function HomePage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { current } = useWorkspaces()
  const { connections, loading: loadingConnections } = useConnections()
  const { workflows, dashboards, schemas, memberCount, loading } = useHomeOverview(current?.id)
  const [picker, setPicker] = useState(false)

  const firstName = (user?.name || '').split(' ')[0] || 'there'

  const canCreate = can(current, 'connections.create')
  const canInvite = can(current, 'members.manage')
  const production = connections.filter((c: any) => c.environment === 'production').length
  const engines = new Set(connections.map((c: any) => c.type)).size
  const failing = workflows.filter((w) => w.lastRun?.status === 'failed').length
  const scheduled = workflows.filter((w) => w.scheduleEnabled).length
  const widgets = dashboards.reduce((sum, d) => sum + d.widgetCount, 0)
  const dash = (v: number | null, busy: boolean) => (busy || v === null ? '—' : v)
  const isEmpty =
    !loading && !loadingConnections && connections.length + workflows.length + dashboards.length + schemas.length === 0

  const newConnection = canCreate ? () => setPicker(true) : undefined

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader
        title={`${greeting()}, ${firstName}`}
        desc={`Here's what's happening in ${current?.name || 'your workspace'}.`}
        action={
          <>
            {canInvite && (
              <Button variant="outline" size="lg" onClick={() => navigate('/members')}>
                <UsersIcon width={14} height={14} /> Invite
              </Button>
            )}
            {newConnection && (
              <Button size="lg" onClick={newConnection}>
                <PlusIcon width={14} height={14} /> New connection
              </Button>
            )}
          </>
        }
      />

      {current && !loading && !loadingConnections && (
        <GettingStarted
          workspaceId={current.id}
          steps={[
            {
              label: 'Add a connection',
              hint: 'Point tabletsgo at a database you want to work with.',
              done: connections.length > 0,
              action: newConnection && { label: 'Add connection', run: newConnection },
            },
            {
              label: 'Invite a teammate',
              hint: 'Share connections and dashboards with the people you work with.',
              done: (memberCount ?? 0) > 1,
              action: canInvite ? { label: 'Invite', run: () => navigate('/members') } : undefined,
            },
            {
              label: 'Build a dashboard',
              hint: 'Turn a query into charts — open a connection and add one from its rail.',
              done: dashboards.length > 0,
            },
            {
              label: 'Automate a task',
              hint: 'Schedule a workflow to run queries and send the results on.',
              done: workflows.length > 0,
            },
          ]}
        />
      )}

      <div className="grid grid-cols-4 gap-3 max-[1000px]:grid-cols-2 max-[560px]:grid-cols-1">
        <StatTile
          Icon={DatabaseIcon}
          label="Connections"
          value={dash(connections.length, loadingConnections)}
          hint={
            connections.length === 0
              ? 'No databases yet'
              : production > 0
                ? `${production} in production · ${plural(engines, 'engine')}`
                : plural(engines, 'engine')
          }
          onClick={() => navigate('/connections')}
        />
        <StatTile
          Icon={WorkflowIcon}
          label="Workflows"
          value={dash(workflows.length, loading)}
          hint={failing > 0 ? `${failing} failing` : `${scheduled} scheduled`}
          tone={failing > 0 ? 'alert' : 'default'}
          onClick={() => navigate('/workflows')}
        />
        <StatTile
          Icon={GridIcon}
          label="Dashboards"
          value={dash(dashboards.length, loading)}
          hint={plural(widgets, 'widget')}
          onClick={() => navigate('/dashboards')}
        />
        <StatTile
          Icon={UsersIcon}
          label="Members"
          value={dash(memberCount, loading)}
          hint="People in this workspace"
          onClick={() => navigate('/members')}
        />
      </div>

      {/* A brand-new workspace has nothing to list: three "nothing yet" boxes
          under the checklist would only repeat it. */}
      {!isEmpty && (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,360px)] items-start gap-4 max-[1000px]:grid-cols-1">
          <div className="flex min-w-0 flex-col gap-4">
            <ConnectionsPanel connections={connections} loading={loadingConnections} />
            <ActivityPanel workflows={workflows} dashboards={dashboards} schemas={schemas} loading={loading} />
          </div>
          <AutomationPanel workflows={workflows} loading={loading} />
        </div>
      )}

      {picker && (
        <DbTypePickerModal
          onClose={() => setPicker(false)}
          onPick={(typeId: string) => {
            setPicker(false)
            navigate(`/connections/new?type=${typeId}`)
          }}
        />
      )}
    </div>
  )
}
