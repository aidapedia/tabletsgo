import { useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/features/auth'
import { WorkspaceSwitcher } from '@/features/workspaces'
import { UpdateBanner } from '@/features/system-update'
import NavItem from '@/shared/ui/navigation/NavItem'
import IconButton from '@/shared/ui/buttons/IconButton'
import { BellIcon, BuildingIcon, CloudIcon, DatabaseIcon, GridIcon, Logo, LogoutIcon, MenuIcon, SettingsIcon } from '@/shared/ui/icons'

// Sidebar navigation model — one clickable item per section. Each section is its
// own route; the id doubles as the path segment (`dashboard` → `/`). Integration
// and Notification live as tabs under the Integrations section.
const NAV = [
  { id: 'dashboard', label: 'Dashboard', Icon: GridIcon, path: '/' },
  { id: 'connections', label: 'Connection', Icon: DatabaseIcon, path: '/connections' },
  { id: 'storage', label: 'S3 Storage', Icon: CloudIcon, path: '/storage' },
  { id: 'workspace', label: 'Workspace', Icon: BuildingIcon, path: '/workspace' },
  { id: 'notifications', label: 'Notification', Icon: BellIcon, path: '/notifications' },
  { id: 'settings', label: 'Setting', Icon: SettingsIcon, path: '/settings' },
] as const

function Sidebar({ activeTab, onNavigate, user, onLogout, open, onClose }: any) {
  const NavLeaf = ({ id, label, Icon, path, soon }: any) => (
    <NavItem active={activeTab === id} icon={Icon} badge={soon && 'Soon'} onClick={() => onNavigate(path)}>
      {label}
    </NavItem>
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

        {/* Workspace switcher */}
        <div className="px-3 py-3">
          <WorkspaceSwitcher />
        </div>

        {/* Nav */}
        <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          <div className="flex flex-col gap-0.5">
            {NAV.map((entry) => (
              <NavLeaf key={entry.id} {...entry} />
            ))}
          </div>
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

  // Active section = first path segment (`/workspace/member` → `workspace`, `/` → `dashboard`).
  const activeTab = location.pathname.split('/').filter(Boolean)[0] || 'dashboard'

  const go = (path: string) => {
    setSidebarOpen(false)
    navigate(path)
  }

  return (
    <div className="flex h-screen bg-bg">
      <Sidebar
        activeTab={activeTab}
        onNavigate={go}
        user={user}
        onLogout={logout}
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

        <main className="min-h-0 flex-1 overflow-y-auto px-8 py-10 max-[600px]:px-4 max-[600px]:py-7">
          <UpdateBanner />
          <Outlet />
        </main>
      </div>
    </div>
  )
}
