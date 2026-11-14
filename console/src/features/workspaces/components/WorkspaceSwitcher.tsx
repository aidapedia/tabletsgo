import Popover from '@/shared/ui/overlay/Popover'
import MenuItem from '@/shared/ui/navigation/MenuItem'
import { CheckIcon, ChevronDown } from '@/shared/ui/icons'
import { useWorkspaces } from '@/features/workspaces'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip'

// Current-workspace picker: the Hayat tenants the user belongs to. Creating one
// is Hayat's (an instance admin there), settings are the sidebar's Workspace
// section — neither belongs in a switcher.
//
// `collapsed` is the icon-rail form: the initial bubble alone, which is all a
// 64px rail has room for. The list it opens is unchanged.
export default function WorkspaceSwitcher({ collapsed = false }) {
  const { workspaces, current, switchWorkspace } = useWorkspaces()
  // In no workspace (nobody has added them in Hayat) it says so rather than
  // showing a made-up "Workspace" they are a member of.
  const name = current?.name || 'No workspace'
  const roleName = !current ? 'Not a member yet' : current.role === 'owner' ? 'Owner' : 'Member'

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
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-primary text-[13px] font-bold text-white">
                  {name[0].toUpperCase()}
                </span>
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
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-primary text-[12px] font-bold text-white">
              {name[0].toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-semibold text-foreground">{name}</span>
              <span className="block text-[10px] text-faint">{roleName}</span>
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
              <MenuItem key={w.id} onClick={() => { switchWorkspace(w.id); close() }}>
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted text-[10px] font-bold text-muted-foreground">
                  {w.name[0]?.toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 truncate">{w.name}</span>
                {w.id === current?.id && <CheckIcon width={14} height={14} className="shrink-0 text-primary" />}
              </MenuItem>
            ))}
          </div>
        </div>
      )}
    </Popover>
  )
}
