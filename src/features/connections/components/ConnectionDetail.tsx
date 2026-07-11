import { useEffect, useState } from 'react'
import ConnectionAccessPanel from './ConnectionAccessPanel'
import { TYPE_LABEL } from './DbTypePickerModal'
import { BackupPanel } from '@/features/backup'
import { listTables, pingConnection } from '@/shared/api/database'
import Button from '@/shared/ui/buttons/Button'
import TextButton from '@/shared/ui/buttons/TextButton'
import Tab from '@/shared/ui/navigation/Tab'
import { ChevronLeft, DatabaseIcon, DbLogo, EditIcon, ExternalLinkIcon, RefreshIcon, TableIcon } from '@/shared/ui/icons'

const STATUS = {
  checking: { dot: 'bg-ink-faint animate-pulse', text: 'text-ink-faint', label: 'Checking…' },
  connected: { dot: 'bg-green', text: 'text-ink-dim', label: 'Connected' },
  offline: { dot: 'bg-red', text: 'text-ink-dim', label: 'Offline' },
}

// Live-connectivity dot + label ("Connected" / "Offline" / "Checking…").
export function StatusBadge({ status }: { status?: string }) {
  const s = STATUS[status] || STATUS.checking
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${s.text}`}>
      <span className={`h-2 w-2 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  )
}

// Build a copyable connection URL / string for a connection.
export function connectionUrl(c) {
  if (c.type === 'sqlite') return `sqlite://${c.filepath || ''}`
  const cred = c.auth === 'none' ? '' : `${encodeURIComponent(c.username || '')}${c.password ? ':' + encodeURIComponent(c.password) : ''}`
  const auth = cred ? `${cred}@` : ''
  const db = c.database ? `/${c.database}` : ''
  const ssl = c.sslmode && c.sslmode !== 'disable' ? `?sslmode=${c.sslmode}` : ''
  return `postgresql://${auth}${c.host || ''}${c.port ? ':' + c.port : ''}${db}${ssl}`
}

function DetailRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <div className="flex items-start justify-between gap-4 border-b border-edge py-2.5 last:border-0">
      <span className="text-[12px] text-ink-dim">{label}</span>
      <span className="min-w-0 truncate text-right font-mono text-[12px] text-ink">{value}</span>
    </div>
  )
}

// Full-page connection detail: Data Connection / Access / Backup tabs.
export default function ConnectionDetail({ conn, onBack, onOpen, onEdit }) {
  const [tab, setTab] = useState<'data' | 'access' | 'backup'>('data')
  const [status, setStatus] = useState<'checking' | 'connected' | 'offline'>('checking')
  const [tableCount, setTableCount] = useState<number | null>(null)

  useEffect(() => {
    let alive = true
    setStatus('checking')
    setTableCount(null)
    pingConnection(conn).then((r) => {
      if (!alive) return
      setStatus(r.ok ? 'connected' : 'offline')
      if (r.ok) listTables(conn).then((t) => alive && setTableCount(Array.isArray(t) ? t.length : 0))
      else setTableCount(0)
    })
    return () => {
      alive = false
    }
  }, [conn.id])

  const tabBtn = (id: 'data' | 'access' | 'backup', label: string, soon = false) => (
    <Tab active={tab === id} onClick={() => setTab(id)}>
      {label}
      {soon && (
        <span className="rounded-[5px] border border-edge bg-elevated px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide text-ink-faint">
          Soon
        </span>
      )}
    </Tab>
  )

  return (
    <div className="w-full">
      <TextButton onClick={onBack} className="mb-5">
        <ChevronLeft width={16} height={16} /> All connections
      </TextButton>

      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <DbLogo type={conn.type} className="h-12 w-12 shrink-0" />
          <div className="min-w-0">
            <h1 className="truncate text-[22px] font-bold tracking-[-0.4px]">{conn.name}</h1>
            <div className="mt-0.5 flex items-center gap-2">
              <StatusBadge status={status} />
              <span className="text-ink-faint">·</span>
              <span className="text-[12px] text-ink-dim">{TYPE_LABEL[conn.type] || conn.type}</span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="subtle" size="sm" icon={EditIcon} onClick={() => onEdit(conn)}>
            Edit
          </Button>
          <Button variant="primary" size="sm" icon={ExternalLinkIcon} onClick={() => onOpen(conn)}>
            Connect
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-7 flex items-center gap-5 border-b border-edge">
        {tabBtn('data', 'Data Connection')}
        {tabBtn('access', 'Access')}
        {tabBtn('backup', 'Backup')}
      </div>

      <div className="mt-6">
        {tab === 'data' ? (
          <div className="flex flex-col gap-5">
            {/* Stats */}
            <div className="grid grid-cols-3 gap-3 max-[560px]:grid-cols-1">
              <div className="rounded-card border border-edge bg-card p-4">
                <div className="flex items-center gap-2 text-[11px] text-ink-dim">
                  <TableIcon width={14} height={14} /> Tables
                </div>
                <div className="mt-1.5 text-[22px] font-bold tabular-nums">{tableCount ?? '—'}</div>
              </div>
              <div className="rounded-card border border-edge bg-card p-4">
                <div className="flex items-center gap-2 text-[11px] text-ink-dim">
                  <DatabaseIcon width={14} height={14} /> Type
                </div>
                <div className="mt-1.5 text-[15px] font-semibold">{TYPE_LABEL[conn.type] || conn.type}</div>
              </div>
              <div className="rounded-card border border-edge bg-card p-4">
                <div className="flex items-center gap-2 text-[11px] text-ink-dim">
                  <RefreshIcon width={14} height={14} /> Status
                </div>
                <div className="mt-1.5 text-[15px] font-semibold capitalize">{status}</div>
              </div>
            </div>

            {/* Connection info */}
            <div className="rounded-card border border-edge bg-card p-5">
              <div className="mb-1 text-[13px] font-bold">Connection details</div>
              <div className="mt-2">
                {conn.type === 'sqlite' ? (
                  <DetailRow label="File path" value={conn.filepath} />
                ) : (
                  <>
                    <DetailRow label="Host" value={conn.host} />
                    <DetailRow label="Port" value={conn.port ? String(conn.port) : undefined} />
                    <DetailRow label="Database" value={conn.database} />
                    <DetailRow label="Username" value={conn.username} />
                    <DetailRow label="SSL mode" value={conn.sslmode} />
                  </>
                )}
                {conn.folder && <DetailRow label="Folder" value={conn.folder} />}
                <DetailRow label="Owner" value={conn.ownerName || conn.ownerEmail} />
              </div>
            </div>
          </div>
        ) : tab === 'access' ? (
          <ConnectionAccessPanel conn={conn} />
        ) : (
          <BackupPanel connectionId={conn.id} connectionType={conn.type} workspaceId={conn.workspaceId} />
        )}
      </div>
    </div>
  )
}
