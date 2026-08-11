import { CodeIcon, DatabaseIcon, DbLogo, DiagramIcon, GridIcon, HomeIcon, WandIcon, WorkflowIcon } from '@/shared/ui/icons'
import Tooltip from '@/shared/ui/overlay/Tooltip'
import RailItem, { RailDivider } from '@/shared/ui/navigation/RailItem'
import AccountTile from '@/shared/ui/AccountTile'
import AccountMenu from '@/shared/ui/AccountMenu'

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
  onSchema,
  onTemplates,
  onHome,
  onLogout,
  // Schemaless engines (Redis) have nothing for the schema designer to draw, so
  // the rail hides that entry rather than leaving for an editor with no diagram.
  showSchema = true,
  // What the browser panel holds — tables for the SQL engines, keys for Redis.
  browserIcon: BrowserIcon = DatabaseIcon,
  browserLabel = 'Data browser',
}) {
  const current = connections.find((c) => c.id === currentId)

  // 3.5rem = the two px-2 gutters + a 2.5rem target, so the rail tracks the
  // density setting's root font-size instead of stranding the slack on one
  // side; + 1px is the border-r, which border-box counts inside the width and
  // which doesn't scale. See the fuller note in HomeLayout's <aside>.
  return (
    <div className="flex w-[calc(3.5rem_+_1px)] shrink-0 flex-col border-r border-edge bg-bg px-2 py-3">
      {/* Connection switcher — opens the searchable folder-tree modal */}
      <Tooltip
        label={current?.environment ? `${current.name} · ${current.environment}` : current?.name || 'Connections'}
        placement="right"
      >
        <button
          onClick={onBrowseConnections}
          aria-label="Switch connection"
          className="flex h-10 w-10 items-center justify-center rounded-soft text-ink-dim transition-colors hover:bg-card-hover hover:text-ink"
        >
          <DbLogo type={current?.type} className="h-9 w-9" />
        </button>
      </Tooltip>

      <RailDivider />

      <div className="flex flex-col gap-1.5">
        <RailItem icon={BrowserIcon} label={browserLabel} active={active === 'browser'} onClick={onBrowser} />
        <RailItem icon={CodeIcon} label="Saved queries" active={active === 'queries'} onClick={onQueries} />
        <RailItem icon={WorkflowIcon} label="Workflows" active={active === 'workflows'} onClick={onWorkflows} />
        <RailItem icon={GridIcon} label="Dashboards" active={active === 'dashboards'} onClick={onDashboards} />
        {/* Unlike its neighbours this one leaves the console: the diagram lives
            on the Schema Editor page, so there is no panel here to mark active. */}
        {showSchema && <RailItem icon={DiagramIcon} label="Schema editor" onClick={onSchema} />}
        <RailItem icon={WandIcon} label="Templates" active={active === 'templates'} onClick={onTemplates} />
      </div>

      <div className="mt-auto flex flex-col gap-1.5">
        <RailItem icon={HomeIcon} label="Home" onClick={onHome} />
        <AccountMenu
          user={user}
          onLogout={onLogout}
          trigger={({ open, toggle }) => (
            <Tooltip label={user?.name || 'Profile'} placement="right">
              <button
                aria-label="User profile"
                onClick={toggle}
                className={`relative mt-1 flex h-10 w-10 items-center justify-center rounded-soft transition-colors hover:bg-card-hover ${
                  open ? 'bg-card-hover' : ''
                }`}
              >
                {/* The dot is positioned against the tile, not the 40px
                    target — anchored to the button it would float off into the
                    padding once the tile got smaller. The console is the only
                    place presence means anything, so it stays on this rail. */}
                <span className="relative flex">
                  <AccountTile label={user?.name} size={30} />
                  <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-bg bg-green" />
                </span>
              </button>
            </Tooltip>
          )}
        />
      </div>
    </div>
  )
}
