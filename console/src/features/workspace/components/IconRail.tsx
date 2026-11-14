import { CodeIcon, DatabaseIcon, DbLogo, GridIcon, HomeIcon, WandIcon, WorkflowIcon } from '@/shared/ui/icons'
import RailItem, { RailDivider } from '@/shared/ui/navigation/RailItem'
import AccountTile from '@/shared/ui/AccountTile'
import AccountMenu from '@/shared/ui/AccountMenu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip'

export default function IconRail({
  user,
  connections = [],
  currentId,
  onBrowseConnections,
  active = 'browser',
  onBrowser,
  onQueries,
  onWorkflows,
  onDashboards,
  onTemplates,
  // Engine-specific panels, listed under the browser: [{ id, icon, label }] —
  // the Kafka services a connection names (Schema Registry, Connect, ksqlDB).
  extraPanels = [],
  onPanel,
  onHome,
  onSettings,
  onLogout,
  // What the browser panel holds — tables for the SQL engines, keys for Redis.
  browserIcon: BrowserIcon = DatabaseIcon,
  browserLabel = 'Data browser',
}) {
  const current = connections.find((c) => c.id === currentId)

  // 14 spacing steps = the two px-2 gutters + a 10-step target, so the rail
  // tracks the person's text size and density instead of stranding the slack
  // on one side; + 1px is the border-r, which border-box counts inside the
  // width and which doesn't scale. See the fuller note in HomeLayout's <aside>.
  // It is navigation, so it draws in the sidebar's colors (`app-sidebar`).
  return (
    <div className="app-sidebar flex w-[calc(var(--spacing)*14_+_1px)] shrink-0 flex-col border-r border-border bg-sidebar px-2 py-3">
      {/* Connection switcher — opens the searchable folder-tree modal */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onBrowseConnections}
            aria-label="Switch connection"
            className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <DbLogo type={current?.type} className="h-9 w-9" />
          </button>
        </TooltipTrigger>
        {(current?.environment ? `${current.name} · ${current.environment}` : current?.name || 'Connections') && <TooltipContent side="right">{current?.environment ? `${current.name} · ${current.environment}` : current?.name || 'Connections'}</TooltipContent>}
      </Tooltip>

      <RailDivider />

      <div className="flex flex-col gap-1.5">
        <RailItem icon={BrowserIcon} label={browserLabel} active={active === 'browser'} onClick={onBrowser} />
        {extraPanels.map((p) => (
          <RailItem key={p.id} icon={p.icon} label={p.label} active={active === p.id} onClick={() => onPanel?.(p.id)} />
        ))}
        <RailItem icon={CodeIcon} label="Saved queries" active={active === 'queries'} onClick={onQueries} />
        <RailItem icon={WorkflowIcon} label="Workflows" active={active === 'workflows'} onClick={onWorkflows} />
        <RailItem icon={GridIcon} label="Dashboards" active={active === 'dashboards'} onClick={onDashboards} />
        <RailItem icon={WandIcon} label="Templates" active={active === 'templates'} onClick={onTemplates} />
      </div>

      <div className="mt-auto flex flex-col gap-1.5">
        <RailItem icon={HomeIcon} label="Home" onClick={onHome} />
        <AccountMenu
          user={user}
          onSettings={onSettings}
          onLogout={onLogout}
          trigger={({ open, toggle }) => (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  aria-label="User profile"
                  onClick={toggle}
                  className={`relative mt-1 flex h-10 w-10 items-center justify-center rounded-lg transition-colors hover:bg-accent ${
                    open ? 'bg-accent' : ''
                  }`}
                >
                  {/* The rail sits on `bg`, so that is the surface the dot's
                      ring is punched out of. */}
                  <AccountTile label={user?.name || user?.email} size={30} presence surface="background" />
                </button>
              </TooltipTrigger>
              {(user?.name || 'Profile') && <TooltipContent side="right">{user?.name || 'Profile'}</TooltipContent>}
            </Tooltip>
          )}
        />
      </div>
    </div>
  )
}
