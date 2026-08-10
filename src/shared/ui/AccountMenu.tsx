import type { ReactNode } from 'react'
import Popover from '@/shared/ui/overlay/Popover'
import MenuItem from '@/shared/ui/navigation/MenuItem'
import AccountTile from '@/shared/ui/AccountTile'
import { LogoutIcon } from '@/shared/ui/icons'

/**
 * The "who am I / sign out" popover, shared by the two rails — the home
 * sidebar's foot and the console `IconRail`'s. The *contents* are what's shared
 * (the tile, name, email and sign-out); the trigger is not, because each rail
 * presents the account differently: a bare tile at 56px, a card with a kebab
 * when the sidebar is expanded, a tile with a presence dot in the console.
 * So `trigger` is passed straight through to `Popover`.
 *
 * Opens upward, since in both callers it sits at the bottom of its rail.
 */
export default function AccountMenu({
  user,
  onLogout,
  width = 220,
  trigger,
}: {
  user?: { name?: string; email?: string }
  onLogout?: () => void
  width?: number
  trigger: (state: { open: boolean; toggle: () => void }) => ReactNode
}) {
  return (
    <Popover align="left" placement="top" width={width} trigger={trigger}>
      {({ close }: { close: () => void }) => (
        <div className="p-1.5">
          <div className="flex items-center gap-2.5 px-1.5 py-1">
            <AccountTile label={user?.name} size={30} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-semibold text-ink">{user?.name || 'Account'}</span>
              <span className="block truncate text-[11px] text-ink-faint">{user?.email}</span>
            </span>
          </div>
          <div className="my-1 h-px bg-edge" />
          <MenuItem
            danger
            onClick={() => {
              close()
              onLogout?.()
            }}
          >
            <LogoutIcon width={14} height={14} />
            <span className="flex-1">Sign out</span>
          </MenuItem>
        </div>
      )}
    </Popover>
  )
}
