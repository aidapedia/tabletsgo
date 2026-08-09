import { useState, type MouseEvent } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/features/auth'
import { WorkspaceSwitcher } from '@/features/workspaces'
import { UpdateBanner } from '@/features/system-update'
import NavItem from '@/shared/ui/navigation/NavItem'
import IconButton from '@/shared/ui/buttons/IconButton'
import { BellIcon, BuildingIcon, CloudIcon, DatabaseIcon, GridIcon, HomeIcon, Logo, LogoutIcon, MailIcon, MenuIcon, SettingsIcon, ShieldIcon, TreeIcon, UsersIcon, WorkflowIcon } from '@/shared/ui/icons'

/**
 * Sidebar navigation model — a pinned row plus titled groups.
 *
 * `pinned` is the section that answers "where am I" rather than "what do I
 * work on", so it sits above the group headers with no title of its own.
 * Groups below it read as: what the workspace holds, how the workspace is run,
 * and the account. Every group earns its header — a one-item group is a sign
 * the item belongs in a neighbouring one.
 *
 * `path` is the section's own address and doubles as the active-state test: a
 * row lights up for its path *and everything under it*, so `/connections/42`
 * and `/connections/42/edit` still read as "Connection". `exact` opts out of
 * that for the two paths that prefix their siblings (`/` and `/admin`).
 */
const NAV = {
  pinned: [{ label: 'Home', Icon: HomeIcon, path: '/', exact: true }],
  groups: [
    {
      group: 'Resources',
      items: [
        { label: 'Connection', Icon: DatabaseIcon, path: '/connections' },
        { label: 'Dashboard', Icon: GridIcon, path: '/dashboards' },
        { label: 'Workflow', Icon: WorkflowIcon, path: '/workflows' },
        { label: 'S3 Storage', Icon: CloudIcon, path: '/storage' },
        { label: 'Resource Tree', Icon: TreeIcon, path: '/resource-tree' },
      ],
    },
    {
      group: 'Workspace',
      items: [
        { label: 'General', Icon: BuildingIcon, path: '/workspace' },
        { label: 'Member', Icon: UsersIcon, path: '/members' },
        { label: 'Notification', Icon: BellIcon, path: '/notifications' },
      ],
    },
    {
      group: 'Account',
      items: [{ label: 'Setting', Icon: SettingsIcon, path: '/settings' }],
    },
  ],
}

// An instance admin belongs to no workspace, so none of the sections above have
// anything to show them — `/admin` is their home, so it takes the pinned row,
// and the instance-wide sections (accounts, the one mail server, the node
// hierarchy) group under it, plus the same personal settings.
const ADMIN_NAV = {
  pinned: [{ label: 'Workspaces', Icon: BuildingIcon, path: '/admin', exact: true }],
  groups: [
    {
      group: 'Administration',
      items: [
        { label: 'Users', Icon: UsersIcon, path: '/admin/users' },
        { label: 'Email', Icon: MailIcon, path: '/admin/email' },
        { label: 'Resource Tree', Icon: TreeIcon, path: '/resource-tree' },
      ],
    },
    {
      group: 'Account',
      items: [{ label: 'Setting', Icon: SettingsIcon, path: '/settings' }],
    },
  ],
}

const isActive = (pathname: string, path: string, exact?: boolean) =>
  exact ? pathname === path : pathname === path || pathname.startsWith(`${path}/`)

function Sidebar({ pathname, onNavigate, user, onLogout, open, onClose, isAdmin }: any) {
  const nav = isAdmin ? ADMIN_NAV : NAV

  const rows = (items: any[]) => (
    <div className="flex flex-col gap-0.5">
      {items.map((item) => (
        <NavItem
          key={item.path}
          href={item.path}
          active={isActive(pathname, item.path, item.exact)}
          icon={item.Icon}
          onClick={(e: MouseEvent) => onNavigate(e, item.path)}
        >
          {item.label}
        </NavItem>
      ))}
    </div>
  )

  return (
    <>
      {/* Mobile scrim */}
      {open && <div className="fixed inset-0 z-30 bg-black/50 max-[820px]:block min-[821px]:hidden" onClick={onClose} />}

      <aside
        className={`z-40 flex h-screen w-[264px] shrink-0 flex-col border-r border-edge bg-panel max-[820px]:fixed max-[820px]:left-0 max-[820px]:top-0 max-[820px]:transition-transform ${
          open ? 'max-[820px]:translate-x-0' : 'max-[820px]:-translate-x-full'
        }`}
      >
        {/* Brand */}
        <div className="flex items-center gap-2.5 border-b border-edge px-4 py-4">
          <Logo className="h-8 w-8 shrink-0" />
          <div className="min-w-0">
            <div className="truncate text-[15px] font-bold tracking-[-0.3px]">
              Tabl<span className="text-green">et</span>sgo
            </div>
            <div className="truncate text-[10px] text-ink-faint">Database manager</div>
          </div>
        </div>

        {/* Workspace switcher — an admin has no workspaces to switch between,
            so they get the admin badge in its place. */}
        <div className="px-3 py-3">
          {isAdmin ? (
            <div className="flex w-full items-center gap-2.5 rounded-soft border border-edge bg-elevated px-2.5 py-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-green text-white">
                <ShieldIcon width={14} height={14} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-semibold text-ink">Administration</span>
                <span className="block text-[10px] text-ink-faint">Instance admin</span>
              </span>
            </div>
          ) : (
            <WorkspaceSwitcher />
          )}
        </div>

        {/* Nav */}
        <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          <div className="mb-4">{rows(nav.pinned)}</div>
          {nav.groups.map((group) => (
            <div key={group.group} className="mb-4 last:mb-0">
              <div className="mb-1 px-2.5 text-[10px] font-bold uppercase tracking-wide text-ink-faint">{group.group}</div>
              {rows(group.items)}
            </div>
          ))}
        </nav>

        {/* User profile + logout */}
        <div className="flex items-center gap-2.5 border-t border-edge px-3 py-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-green text-[13px] font-bold text-white">
            {user?.name?.[0]?.toUpperCase() || 'A'}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-semibold text-ink">{user?.name || 'Account'}</div>
            <div className="truncate text-[11px] text-ink-faint">{user?.email}</div>
          </div>
          <IconButton size="lg" onClick={onLogout} aria-label="Sign out" className="shrink-0 hover:!text-red">
            <LogoutIcon width={16} height={16} />
          </IconButton>
        </div>
      </aside>
    </>
  )
}

// Home shell: sidebar + the active section page (rendered via <Outlet/>).
export default function HomeLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const isAdmin = user?.role === 'admin'

  // Nav rows are real links, so a modified click (new tab/window) is left to the
  // browser; only a plain click is taken over for client-side routing.
  const go = (e: MouseEvent, path: string) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || (e as any).button > 0) return
    e.preventDefault()
    setSidebarOpen(false)
    navigate(path)
  }

  return (
    <div className="flex h-screen bg-bg">
      <Sidebar
        pathname={location.pathname}
        onNavigate={go}
        user={user}
        onLogout={logout}
        isAdmin={isAdmin}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <div className="flex items-center gap-3 border-b border-edge bg-panel px-4 py-3 min-[821px]:hidden">
          <IconButton size="lg" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
            <MenuIcon />
          </IconButton>
          <span className="text-[15px] font-bold tracking-[-0.3px]">
            Tabl<span className="text-green">et</span>sgo
          </span>
        </div>

        {/* The one content container: every page gets the same width and gutters,
            so nothing sets its own (use `<Narrow>` for content that needs to be
            narrower than the page). */}
        <main className="min-h-0 flex-1 overflow-y-auto px-8 py-10 max-[600px]:px-4 max-[600px]:py-7">
          <div className="mx-auto w-full max-w-[1280px]">
            <UpdateBanner />
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
