import Popover from '@/shared/ui/overlay/Popover'
import MenuItem from '@/shared/ui/navigation/MenuItem'
import { CheckIcon, ChevronDown } from '@/shared/ui/icons'
import { useEffect, useState } from 'react'
import { useWorkspaces, listRoles, type Role } from '@/features/workspaces'

// Current-workspace picker: only the workspaces the user is a member of.
// Creating a workspace lives in the admin area, settings in the sidebar's
// Workspace section — neither belongs in a switcher.
export default function WorkspaceSwitcher() {
  const { workspaces, current, switchWorkspace } = useWorkspaces()
  const [roles, setRoles] = useState<Role[]>([])
  useEffect(() => {
    listRoles().then(setRoles)
  }, [])
  const roleName = roles.find((r) => r.slug === current?.role)?.name || current?.role || ''

  return (
    <Popover
      width={248}
      trigger={({ open, toggle }) => (
        <button
          onClick={toggle}
          className={`flex w-full items-center gap-2.5 rounded-soft border border-edge bg-elevated px-2.5 py-2 text-left transition-colors hover:border-edge-strong ${
            open ? 'border-edge-strong' : ''
          }`}
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-green text-[12px] font-bold text-white">
            {current?.name?.[0]?.toUpperCase() || 'W'}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-semibold text-ink">{current?.name || 'Workspace'}</span>
            {/* The role's display name, resolved from the instance catalog —
                a custom role should read as itself, not as "Member". */}
            <span className="block text-[10px] text-ink-faint">{roleName}</span>
          </span>
          <ChevronDown width={14} height={14} className="shrink-0 text-ink-faint" />
        </button>
      )}
    >
      {({ close }) => (
        <div className="p-1.5">
          <div className="px-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Workspaces</div>
          <div className="max-h-[240px] overflow-y-auto">
            {workspaces.map((w) => (
              <MenuItem key={w.id} onClick={() => { switchWorkspace(w.id); close() }}>
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-elevated text-[10px] font-bold text-ink-dim">
                  {w.name[0]?.toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 truncate">{w.name}</span>
                {w.id === current?.id && <CheckIcon width={14} height={14} className="shrink-0 text-green" />}
              </MenuItem>
            ))}
          </div>
        </div>
      )}
    </Popover>
  )
}
