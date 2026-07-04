import { CodeIcon, DatabaseIcon, DbLogo, DiagramIcon, HomeIcon, SettingsIcon, WorkflowIcon } from '@/shared/ui/icons'
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
  onSelectConnection,
  active = 'browser',
  onBrowser,
  onQueries,
  onWorkflows,
  onSchema,
  onHome,
  onSettings,
  onProfile,
}) {
  const current = connections.find((c) => c.id === currentId)
  const initial = user?.name?.[0]?.toUpperCase() || 'A'

  return (
    <div className="flex w-[56px] shrink-0 flex-col items-center border-r border-edge bg-bg py-3">
      {/* Connection switcher */}
      <Popover
        width={240}
        trigger={({ toggle }) => (
          <Tooltip label={current?.name || 'Connections'} placement="right">
            <IconButton size="xl" onClick={toggle} aria-label="Connections">
              <DbLogo type={current?.type} className="h-9 w-9" />
            </IconButton>
          </Tooltip>
        )}
      >
        {({ close }) => (
          <div className="p-1">
            <div className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
              Connections
            </div>
            {connections.map((c) => (
              <MenuItem
                key={c.id}
                active={c.id === currentId}
                onClick={() => {
                  onSelectConnection?.(c.id)
                  close()
                }}
              >
                <DbLogo type={c.type} className="h-7 w-7 shrink-0" />
                <span className="flex-1 truncate">{c.name}</span>
              </MenuItem>
            ))}
          </div>
        )}
      </Popover>

      <div className="my-2 h-px w-7 bg-edge" />

      <div className="flex flex-col items-center gap-1.5">
        <RailButton icon={DatabaseIcon} label="Data browser" active={active === 'browser'} onClick={onBrowser} />
        <RailButton icon={CodeIcon} label="Saved queries" active={active === 'queries'} onClick={onQueries} />
        <RailButton icon={WorkflowIcon} label="Workflows" active={active === 'workflows'} onClick={onWorkflows} />
        <RailButton icon={DiagramIcon} label="Schema" active={active === 'schema'} onClick={onSchema} />
      </div>

      <div className="mt-auto flex flex-col items-center gap-1.5">
        <RailButton icon={HomeIcon} label="Home" onClick={onHome} />
        <RailButton icon={SettingsIcon} label="Settings" onClick={onSettings} />
        <Tooltip label={user?.name ? `${user.name} — sign out` : 'Profile'} placement="right">
          <button
            aria-label="User profile"
            onClick={onProfile}
            className="relative mt-1 flex h-9 w-9 items-center justify-center rounded-[11px] bg-green text-xs font-bold text-white hover:bg-green-bright"
          >
            {initial}
            <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-bg bg-green" />
          </button>
        </Tooltip>
      </div>
    </div>
  )
}
