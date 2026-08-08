import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/features/auth'
import { useConnections } from '@/features/connections'
import { useWorkspaces, listMembers } from '@/features/workspaces'
import { DatabaseIcon, UsersIcon } from '@/shared/ui/icons'
import { PageHeader } from './ui'

// A single stat tile.
function StatCard({ Icon, label, value, hint, onClick }: any) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      onClick={onClick}
      className={`flex flex-col rounded-card border border-edge bg-card p-5 text-left ${
        onClick ? 'transition-all hover:-translate-y-px hover:border-edge-strong hover:bg-card-hover' : ''
      }`}
    >
      <div className="flex items-center gap-2 text-[11px] font-medium text-ink-dim">
        <Icon width={15} height={15} /> {label}
      </div>
      <div className="mt-2 text-[28px] font-bold tabular-nums leading-none">{value}</div>
      {hint && <div className="mt-2 text-[11px] text-ink-faint">{hint}</div>}
    </Tag>
  )
}

// Default landing — workspace stats at a glance.
export default function DashboardPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { current } = useWorkspaces()
  const { connections, loading } = useConnections()
  const [memberCount, setMemberCount] = useState<number | null>(null)

  useEffect(() => {
    if (!current) return
    let alive = true
    setMemberCount(null)
    listMembers(current.id).then((m) => alive && setMemberCount(Array.isArray(m) ? m.length : 0))
    return () => {
      alive = false
    }
  }, [current?.id])

  return (
    <div className="w-full">
      <PageHeader
        title={`Welcome back, ${user?.name || 'there'}`}
        desc={`Here's an overview of ${current?.name || 'your workspace'}.`}
      />

      <div className="mt-7 grid grid-cols-4 gap-4 max-[1000px]:grid-cols-2 max-[560px]:grid-cols-1">
        <StatCard
          Icon={DatabaseIcon}
          label="Connections"
          value={loading ? '—' : connections.length}
          hint="Databases in this workspace"
          onClick={() => navigate('/connections')}
        />
        <StatCard
          Icon={UsersIcon}
          label="Members"
          value={memberCount ?? '—'}
          hint="People with access"
          onClick={() => navigate('/members')}
        />
      </div>
    </div>
  )
}
