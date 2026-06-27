import { CodeIcon, DatabaseIcon, HomeIcon, SettingsIcon } from '../icons.jsx'
import Popover from '../ui/Popover.jsx'
import Tooltip from '../ui/Tooltip.jsx'
import { connIcon } from '../../ui.js'

const ABBR = { postgresql: 'PG', sqlite: 'SQ', redis: 'R' }

function RailButton({ icon: Icon, label, active = false, onClick }) {
  return (
    <Tooltip label={label} placement="right">
      <button
        aria-label={label}
        onClick={onClick}
        className={`flex h-10 w-10 items-center justify-center rounded-soft transition-colors ${
          active ? 'bg-elevated text-ink' : 'text-ink-faint hover:bg-elevated hover:text-ink'
        }`}
      >
        <Icon />
      </button>
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
            <button
              onClick={toggle}
              className={connIcon(current?.type, 'h-10 w-10 text-[13px] font-extrabold')}
            >
              {ABBR[current?.type] || 'DB'}
            </button>
          </Tooltip>
        )}
      >
        {({ close }) => (
          <div className="p-1">
            <div className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
              Connections
            </div>
            {connections.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  onSelectConnection?.(c.id)
                  close()
                }}
                className={`flex w-full items-center gap-2.5 rounded px-2 py-2 text-left text-xs ${
                  c.id === currentId ? 'bg-card-hover text-ink' : 'text-ink-dim hover:bg-elevated hover:text-ink'
                }`}
              >
                <span className={connIcon(c.type, 'h-7 w-7 text-[10px] font-extrabold')}>{ABBR[c.type] || 'DB'}</span>
                <span className="flex-1 truncate">{c.name}</span>
              </button>
            ))}
          </div>
        )}
      </Popover>

      <div className="my-2 h-px w-7 bg-edge" />

      <div className="flex flex-col items-center gap-1.5">
        <RailButton icon={DatabaseIcon} label="Data browser" active={active === 'browser'} onClick={onBrowser} />
        <RailButton icon={CodeIcon} label="Saved queries" active={active === 'queries'} onClick={onQueries} />
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
