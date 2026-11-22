import { useNavigate } from 'react-router-dom'
import Popover from '@/shared/ui/overlay/Popover'
import MenuItem from '@/shared/ui/navigation/MenuItem'
import { CheckIcon, ChevronDown, ShieldIcon } from '@/shared/ui/icons'
import { useWorkspaces } from '@/features/workspaces'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip'

// Where you are: one of the Hayat tenants the user belongs to or, for an
// instance admin (`instance.manage` at Hayat's root), the admin area. The admin
// area is a place beside the workspaces, so it is picked from the same list.
// Creating a workspace is Hayat's (an instance admin there), settings are the
// sidebar's Workspace section — neither belongs in a switcher.
//
// `canAdmin` adds the Administration row; `inAdmin` says we're standing in it,
// so the trigger shows the admin badge and picking a workspace leaves it.
//
// `collapsed` is the icon-rail form: the bubble alone, which is all a 64px rail
// has room for. The list it opens is unchanged.
export default function WorkspaceSwitcher({ collapsed = false, canAdmin = false, inAdmin = false }) {
  const navigate = useNavigate()
  const { workspaces, current, switchWorkspace } = useWorkspaces()
  // In no workspace (nobody has added them in Hayat) it says so rather than
  // showing a made-up "Workspace" they are a member of.
  const name = inAdmin ? 'Administration' : current?.name || 'No workspace'
  const subtitle = inAdmin
    ? 'Instance admin'
    : !current
      ? 'Not a member yet'
      : current.role === 'owner'
        ? 'Owner'
        : 'Member'

  const bubble = (size: 'sm' | 'lg') => (
    <span
      className={`flex shrink-0 items-center justify-center bg-primary font-bold text-primary-foreground ${
        size === 'lg' ? 'h-9 w-9 rounded-[11px] text-[13px]' : 'h-7 w-7 rounded-[8px] text-[12px]'
      }`}
    >
      {inAdmin ? <ShieldIcon width={size === 'lg' ? 16 : 14} height={size === 'lg' ? 16 : 14} /> : name[0].toUpperCase()}
    </span>
  )

  return (
    <Popover
      width={248}
      trigger={({ open, toggle }) =>
        // Collapsed it drops the border-box entirely and becomes a 40px target
        // holding a 36px bubble — the console IconRail's proportions, so the two
        // rails in the app read as the same object.
        collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={toggle}
                aria-label="Switch workspace"
                className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors hover:bg-accent ${
                  open ? 'bg-accent' : ''
                }`}
              >
                {bubble('lg')}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{name}</TooltipContent>
          </Tooltip>
        ) : (
          <button
            onClick={toggle}
            className={`flex w-full items-center gap-2.5 rounded-lg border border-border bg-muted px-2.5 py-2 text-left transition-colors hover:border-input ${
              open ? 'border-input' : ''
            }`}
          >
            {bubble('sm')}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-semibold text-foreground">{name}</span>
              <span className="block text-[10px] text-faint">{subtitle}</span>
            </span>
            <ChevronDown width={14} height={14} className="shrink-0 text-faint" />
          </button>
        )
      }
    >
      {({ close }) => (
        <div className="p-1.5">
          <div className="px-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-faint">Workspaces</div>
          <div className="max-h-[240px] overflow-y-auto">
            {workspaces.length === 0 && <div className="px-1.5 py-2 text-[11px] text-faint">You're not in any workspace yet.</div>}
            {workspaces.map((w) => (
              <MenuItem
                key={w.id}
                onClick={() => {
                  switchWorkspace(w.id)
                  if (inAdmin) navigate('/')
                  close()
                }}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted text-[10px] font-bold text-muted-foreground">
                  {w.name[0]?.toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 truncate">{w.name}</span>
                {!inAdmin && w.id === current?.id && <CheckIcon width={14} height={14} className="shrink-0 text-primary" />}
              </MenuItem>
            ))}
          </div>
          {canAdmin && (
            <>
              <div className="my-1 h-px bg-border" />
              <MenuItem
                onClick={() => {
                  if (!inAdmin) navigate('/admin')
                  close()
                }}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
                  <ShieldIcon width={12} height={12} />
                </span>
                <span className="min-w-0 flex-1 truncate">Administration</span>
                {inAdmin && <CheckIcon width={14} height={14} className="shrink-0 text-primary" />}
              </MenuItem>
            </>
          )}
        </div>
      )}
    </Popover>
  )
}
