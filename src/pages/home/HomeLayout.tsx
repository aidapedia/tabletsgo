import { useEffect, useState, type MouseEvent } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/features/auth'
import { WorkspaceSwitcher } from '@/features/workspaces'
import { UpdateBanner } from '@/features/system-update'
import NavItem from '@/shared/ui/navigation/NavItem'
import RailItem, { RailDivider } from '@/shared/ui/navigation/RailItem'
import Tooltip from '@/shared/ui/overlay/Tooltip'
import AccountTile from '@/shared/ui/AccountTile'
import AccountMenu from '@/shared/ui/AccountMenu'
import IconButton from '@/shared/ui/buttons/IconButton'
import { BellIcon, BuildingIcon, CloudIcon, DatabaseIcon, DiagramIcon, GridIcon, HomeIcon, Logo, MailIcon, MenuIcon, MoreHorizontalIcon, PanelLeftIcon, SettingsIcon, ShieldIcon, TreeIcon, UsersIcon, WorkflowIcon } from '@/shared/ui/icons'

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
        { label: 'Schema Editor', Icon: DiagramIcon, path: '/schemas' },
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

function Sidebar({ pathname, onNavigate, user, onLogout, open, onClose, isAdmin, collapsed, onToggleCollapse }: any) {
  const nav = isAdmin ? ADMIN_NAV : NAV

  // The Account group lives in the footer, not the nav list: its one row is
  // about *you*, so it belongs directly above the account block rather than at
  // the bottom of a list of places to go. Its header goes with it — the tile
  // underneath already says whose settings these are.
  const accountGroup = nav.groups.find((g) => g.group === 'Account')
  const listedGroups = nav.groups.filter((g) => g !== accountGroup)

  // Collapsed, a row *is* a rail row — the same `RailItem` the console's
  // IconRail is built from, so the two rails share their size, tooltip and
  // active look by construction rather than by both being kept in step.
  const rows = (items: any[]) => (
    <div className={`flex flex-col ${collapsed ? 'gap-1.5' : 'gap-0.5'}`}>
      {items.map((item) =>
        collapsed ? (
          <RailItem
            key={item.path}
            icon={item.Icon}
            label={item.label}
            href={item.path}
            active={isActive(pathname, item.path, item.exact)}
            onClick={(e: MouseEvent) => onNavigate(e, item.path)}
          />
        ) : (
          <NavItem
            key={item.path}
            href={item.path}
            active={isActive(pathname, item.path, item.exact)}
            icon={item.Icon}
            onClick={(e: MouseEvent) => onNavigate(e, item.path)}
          >
            {item.label}
          </NavItem>
        )
      )}
    </div>
  )

  return (
    <>
      {/* Mobile scrim */}
      {open && <div className="fixed inset-0 z-30 bg-black/50 max-[820px]:block min-[821px]:hidden" onClick={onClose} />}

      {/* Only `width` animates here, so nothing inside may be *centred* in the
          collapsed state: centring resolves against the box's current width, so
          at the first frame — while the panel is still 264px — every icon snaps
          to the middle of the old box, lurches ~100px right, and is then dragged
          back left as the panel narrows. Instead both states share the same
          left gutter, chosen so a 16px icon lands at x=20, dead centre of the
          56px rail. Nothing moves horizontally; only the right edge slides in.

          (Centring *inside a fixed-size child* — a 40px button, a 36px tile —
          is fine: that box isn't the one animating.)

          The rail's measurements come from the console's `IconRail`, so the two
          rails in the app read as the same object: 56px of rail, 40px targets,
          30px imagery, tooltips on the right.

          The width is `rem + 1px`, and both halves matter. It has to be rem
          because the interface-density setting scales the root font-size
          (16/14/13px), so the rail's contents — `px-2`, `w-10` — shrink with
          it; an absolute px width would keep the old box and strand all the
          slack on the right. 3.5rem is exactly what's inside: 2 x px-2 gutter
          plus a 2.5rem target. And the `+ 1px` is the `border-r`, which
          border-box counts *inside* the width and which does not scale — omit
          it and the two gutters differ by that pixel at every density. */}
      <aside
        className={`z-40 flex h-screen shrink-0 flex-col border-r border-edge bg-panel transition-[width] duration-200 ease-out max-[820px]:fixed max-[820px]:left-0 max-[820px]:top-0 max-[820px]:transition-transform ${
          collapsed ? 'w-[calc(3.5rem_+_1px)]' : 'w-[calc(16.5rem_+_1px)]'
        } ${open ? 'max-[820px]:translate-x-0' : 'max-[820px]:-translate-x-full'}`}
      >
        {/* Brand — and, on desktop, the rail toggle. Collapsed, the logo *is*
            the toggle (it swaps to the panel icon on hover), so the rail keeps
            its mark instead of spending its only 64px on a button. */}
        <div className={`flex items-center border-b border-edge py-4 ${collapsed ? 'px-2' : 'gap-2.5 px-4'}`}>
          {collapsed ? (
            <Tooltip label="Expand sidebar" placement="right">
              <button
                onClick={onToggleCollapse}
                aria-label="Expand sidebar"
                className="group relative flex h-10 w-10 shrink-0 items-center justify-center rounded-soft text-ink-dim hover:text-ink"
              >
                <Logo className="h-9 w-9 transition-opacity group-hover:opacity-0" />
                <PanelLeftIcon className="absolute opacity-0 transition-opacity group-hover:opacity-100" />
              </button>
            </Tooltip>
          ) : (
            <>
              <Logo className="h-8 w-8 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-bold tracking-[-0.3px]">
                  Tabl<span className="text-green">et</span>sgo
                </div>
                <div className="truncate text-[10px] text-ink-faint">Database manager</div>
              </div>
              <IconButton
                size="lg"
                onClick={onToggleCollapse}
                aria-label="Collapse sidebar"
                title="Collapse sidebar"
                className="shrink-0 max-[820px]:hidden"
              >
                <PanelLeftIcon width={16} height={16} />
              </IconButton>
            </>
          )}
        </div>

        {/* Workspace switcher — an admin has no workspaces to switch between,
            so they get the admin badge in its place. */}
        <div className={`py-3 ${collapsed ? 'px-2' : 'px-3'}`}>
          {isAdmin ? (
            collapsed ? (
              <Tooltip label="Administration" placement="right">
                <span className="flex h-10 w-10 items-center justify-center">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-green text-white">
                    <ShieldIcon width={16} height={16} />
                  </span>
                </span>
              </Tooltip>
            ) : (
              <div className="flex w-full items-center gap-2.5 rounded-soft border border-edge bg-elevated px-2.5 py-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-green text-white">
                  <ShieldIcon width={14} height={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-semibold text-ink">Administration</span>
                  <span className="block text-[10px] text-ink-faint">Instance admin</span>
                </span>
              </div>
            )
          ) : (
            <WorkspaceSwitcher collapsed={collapsed} />
          )}
        </div>

        {/* Nav */}
        <nav className={`min-h-0 flex-1 overflow-y-auto pb-3 ${collapsed ? 'px-2' : 'px-3'}`}>
          <div className="mb-4">{rows(nav.pinned)}</div>
          {/* A group header has nothing to say at 64px, so the rail keeps only
              the grouping itself — a rule where the title would have been. */}
          {listedGroups.map((group) => (
            <div key={group.group} className="mb-4 last:mb-0">
              {collapsed ? (
                <RailDivider />
              ) : (
                <div className="mb-1 px-2.5 text-[10px] font-bold uppercase tracking-wide text-ink-faint">{group.group}</div>
              )}
              {rows(group.items)}
            </div>
          ))}
        </nav>

        {/* Account: the settings row, then the person. Both states are the same
            two things — collapsed just drops to icons and moves the name, email
            and sign-out into the tile's menu, since none of them fit at 64px.
            The tile carries the presence dot in both, the same one the console
            rail shows: you are looking at your own account, so "online" is the
            one thing it can always state, and it should not blink out of
            existence when you leave the console for the home shell. */}
        <div className={`flex flex-col gap-1 border-t border-edge py-3 ${collapsed ? 'px-2' : 'px-3'}`}>
          {rows(accountGroup?.items ?? [])}

          <AccountMenu
            user={user}
            onLogout={onLogout}
            width={collapsed ? 220 : 232}
            trigger={({ open: menuOpen, toggle }) =>
              collapsed ? (
                <Tooltip label={user?.name || 'Account'} placement="right">
                  <button
                    onClick={toggle}
                    aria-label="Account"
                    className={`mt-1 flex h-10 w-10 items-center justify-center rounded-soft transition-colors hover:bg-card-hover ${
                      menuOpen ? 'bg-card-hover' : ''
                    }`}
                  >
                    <AccountTile label={user?.name} size={30} presence surface="panel" />
                  </button>
                </Tooltip>
              ) : (
                // The whole card opens the menu — the kebab is the affordance,
                // not a separate (and much smaller) target inside it.
                <button
                  onClick={toggle}
                  aria-label="Account"
                  className={`mt-1 flex w-full items-center gap-2.5 rounded-card px-2 py-2 text-left transition-colors hover:bg-card-hover ${
                    menuOpen ? 'bg-card-hover' : ''
                  }`}
                >
                  <AccountTile label={user?.name} size={30} presence surface="panel" />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{user?.name || 'Account'}</span>
                  <MoreHorizontalIcon width={16} height={16} className="shrink-0 text-ink-faint" />
                </button>
              )
            }
          />
        </div>
      </aside>
    </>
  )
}

// The rail is a layout preference, not app data — it belongs to the shell that
// owns the sidebar, and survives a reload on its own key.
const COLLAPSE_KEY = 'tabletsgo:sidebar-collapsed'
const loadCollapsed = () => {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1'
  } catch {
    return false
  }
}

// Home shell: sidebar + the active section page (rendered via <Outlet/>).
export default function HomeLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(loadCollapsed)

  const isAdmin = user?.role === 'admin'

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0')
    } catch {
      /* a browser refusing storage shouldn't break the layout */
    }
  }, [collapsed])

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
      {/* The rail is a desktop state: the mobile drawer is this same sidebar
          slid in, and it has the room for labels — so an open drawer renders
          expanded whatever the stored preference is. */}
      <Sidebar
        pathname={location.pathname}
        onNavigate={go}
        user={user}
        onLogout={logout}
        isAdmin={isAdmin}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        collapsed={collapsed && !sidebarOpen}
        onToggleCollapse={() => setCollapsed((c) => !c)}
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
