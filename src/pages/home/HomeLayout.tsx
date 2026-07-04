import { useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/features/auth'
import { WorkspaceSwitcher } from '@/features/workspaces'
import {
  BellIcon,
  BuildingIcon,
  CloudIcon,
  DatabaseIcon,
  GridIcon,
  Logo,
  LogoutIcon,
  MenuIcon,
  SettingsIcon,
} from '@/shared/ui/icons'

// Sidebar navigation model — one clickable item per section. Each section is its
// own route; the id doubles as the path segment (`dashboard` → `/`). `soon` marks placeholders.
const NAV = [
  { id: 'dashboard', label: 'Dashboard', Icon: GridIcon, path: '/' },
  { id: 'connections', label: 'Connection', Icon: DatabaseIcon, path: '/connections' },
  { id: 's3', label: 'S3 Storage', Icon: CloudIcon, path: '/s3', soon: true },
  { id: 'notification', label: 'Notification', Icon: BellIcon, path: '/notification', soon: true },
  { id: 'workspace', label: 'Workspace', Icon: BuildingIcon, path: '/workspace' },
  { id: 'settings', label: 'Setting', Icon: SettingsIcon, path: '/settings' },
] as const

function Sidebar({ activeTab, onNavigate, user, onLogout, open, onClose }: any) {
  const NavLeaf = ({ id, label, Icon, path, soon }: any) => {
    const active = activeTab === id
    return (
      <button
        onClick={() => onNavigate(path)}
        className={`flex w-full items-center gap-2.5 rounded-soft px-2.5 py-2 text-left text-[13px] transition-colors ${
          active ? 'bg-card-hover font-semibold text-ink' : 'text-ink-dim hover:bg-card-hover hover:text-ink'
        }`}
      >
        <Icon width={16} height={16} className={active ? 'text-green' : ''} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {soon && (
          <span className="rounded-[5px] border border-edge bg-elevated px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide text-ink-faint">
            Soon
          </span>
        )}
      </button>
    )
  }

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
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-green text-[13px] font-bold text-white">
            {user?.name?.[0]?.toUpperCase() || 'A'}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-semibold text-ink">{user?.name || 'Account'}</div>
            <div className="truncate text-[11px] text-ink-faint">{user?.email}</div>
          </div>
          <button
            onClick={onLogout}
            aria-label="Sign out"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-soft text-ink-dim transition-colors hover:bg-elevated hover:text-red"
          >
            <LogoutIcon width={16} height={16} />
          </button>
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
          <button
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
            className="flex h-9 w-9 items-center justify-center rounded-soft text-ink-dim hover:bg-elevated hover:text-ink"
          >
            <MenuIcon />
          </button>
          <span className="text-[15px] font-bold tracking-[-0.3px]">
            Tabl<span className="text-green">et</span>sgo
          </span>
        </div>

        <main className="min-h-0 flex-1 overflow-y-auto px-8 py-10 max-[600px]:px-4 max-[600px]:py-7">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
