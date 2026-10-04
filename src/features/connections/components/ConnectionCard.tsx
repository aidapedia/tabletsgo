import type { ReactNode } from 'react'
import { DbLogo } from '@/shared/ui/icons'
import EnvBadge from './EnvBadge'
import { StatusBadge } from './ConnectionDetail'
import { TYPE_LABEL } from './DbTypePickerModal'

/**
 * One connection as a card — the grid view of the connections list. Shows the
 * same facts as a table row; the caller hands in the action strip so both views
 * share one menu (wrap it in `RowActions`, which stops the card's own click).
 */
export default function ConnectionCard({
  conn,
  status,
  lastBackup,
  actions,
  onClick,
}: {
  conn: any
  status?: string
  lastBackup: ReactNode
  actions: ReactNode
  onClick?: () => void
}) {
  const sqlite = conn.type === 'sqlite'
  const subtitle = sqlite ? conn.filepath : conn.host
  const dbName = sqlite ? (conn.filepath || '').split('/').pop() : conn.database

  return (
    <div
      onClick={onClick}
      className={`flex w-full min-w-0 flex-col rounded-card border border-edge bg-card p-4 transition-colors ${
        onClick ? 'cursor-pointer hover:bg-card-hover' : ''
      }`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <DbLogo type={conn.type} className="h-9 w-9 shrink-0 rounded-[10px]" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-semibold">{conn.name}</span>
            <EnvBadge environment={conn.environment} />
          </div>
          <div className="mt-0.5 truncate font-mono text-[11px] text-ink-faint">{subtitle || '—'}</div>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-3 text-[12px]">
        <Fact label="Type">{TYPE_LABEL[conn.type] || conn.type}</Fact>
        <Fact label="Database">{dbName || '—'}</Fact>
        <Fact label="Last backup">{lastBackup}</Fact>
      </dl>

      <div className="mt-4 flex items-center justify-between gap-2 border-t border-edge/60 pt-3">
        <StatusBadge status={status} />
        {actions}
      </div>
    </div>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">{label}</dt>
      <dd className="mt-0.5 truncate text-ink-dim">{children}</dd>
    </div>
  )
}
