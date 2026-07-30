import { CodeIcon, DatabaseIcon, DbLogo, DiagramIcon, GridIcon, HomeIcon, KeyIcon, LogoutIcon, WandIcon, WorkflowIcon } from '@/shared/ui/icons'
import Popover from '@/shared/ui/overlay/Popover'
import Tooltip from '@/shared/ui/overlay/Tooltip'
import IconButton from '@/shared/ui/buttons/IconButton'
import MenuItem from '@/shared/ui/navigation/MenuItem'

function RailButton({ icon: Icon, label, active = false, onClick }) {
  return (
    <Tooltip label={label} placement="right">
      <IconButton size="xl" active={active} aria-label={label} onClick={onClick} className={active ? '' : '!text-ink-faint'}>
        <Icon />
      </IconButton>
    </Tooltip>
  )
}

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
  // the rail hides that entry rather than opening an empty panel.
  showSchema = true,
  // What the browser panel holds — tables for the SQL engines, keys for Redis.
  browserIcon: BrowserIcon = DatabaseIcon,
  browserLabel = 'Data browser',
}) {
  const current = connections.find((c) => c.id === currentId)
  const initial = user?.name?.[0]?.toUpperCase() || 'A'

  return (
    <div className="flex w-[56px] shrink-0 flex-col items-center border-r border-edge bg-bg py-3">
      {/* Connection switcher — opens the searchable folder-tree modal */}
      <Tooltip
        label={current?.environment ? `${current.name} · ${current.environment}` : current?.name || 'Connections'}
        placement="right"
      >
        <IconButton size="xl" onClick={onBrowseConnections} aria-label="Switch connection">
          <DbLogo type={current?.type} className="h-9 w-9" />
        </IconButton>
      </Tooltip>

      <div className="my-2 h-px w-7 bg-edge" />

      <div className="flex flex-col items-center gap-1.5">
        <RailButton icon={BrowserIcon} label={browserLabel} active={active === 'browser'} onClick={onBrowser} />
        <RailButton icon={CodeIcon} label="Saved queries" active={active === 'queries'} onClick={onQueries} />
        <RailButton icon={WorkflowIcon} label="Workflows" active={active === 'workflows'} onClick={onWorkflows} />
        <RailButton icon={GridIcon} label="Dashboards" active={active === 'dashboards'} onClick={onDashboards} />
        {showSchema && <RailButton icon={DiagramIcon} label="Schema" active={active === 'schema'} onClick={onSchema} />}
        <RailButton icon={WandIcon} label="Templates" active={active === 'templates'} onClick={onTemplates} />
      </div>

      <div className="mt-auto flex flex-col items-center gap-1.5">
        <RailButton icon={HomeIcon} label="Home" onClick={onHome} />
        <Popover
          align="left"
          placement="top"
          width={220}
          trigger={({ toggle }) => (
            <Tooltip label={user?.name || 'Profile'} placement="right">
              <button
                aria-label="User profile"
                onClick={toggle}
                className="relative mt-1 flex h-9 w-9 items-center justify-center rounded-[11px] bg-green text-xs font-bold text-white hover:bg-green-bright"
              >
                {initial}
                <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-bg bg-green" />
              </button>
            </Tooltip>
          )}
        >
          {({ close }) => (
            <div className="p-1">
              <div className="flex items-center gap-2.5 px-2.5 py-2">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-green text-[13px] font-bold text-white">
                  {initial}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-semibold text-ink">{user?.name || 'Account'}</div>
                  <div className="truncate text-[11px] text-ink-faint">{user?.email}</div>
                </div>
              </div>
              <div className="my-1 h-px bg-edge" />
              <MenuItem
                danger
                onClick={() => {
                  close()
                  onLogout?.()
                }}
              >
                <LogoutIcon width={15} height={15} />
                <span className="flex-1">Sign out</span>
              </MenuItem>
            </div>
          )}
        </Popover>
      </div>
    </div>
  )
}
