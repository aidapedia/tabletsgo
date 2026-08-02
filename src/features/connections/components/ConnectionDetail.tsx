import { useEffect, useState } from 'react'
import ConnectionAccessPanel from './ConnectionAccessPanel'
import { TYPE_LABEL } from './DbTypePickerModal'
import { BackupPanel } from '@/features/backup'
import { listConnectionSessions, listTables, pingConnection } from '@/shared/api/database'
import type { SessionStats } from '@/shared/api/database'
import Button from '@/shared/ui/buttons/Button'
import IconButton from '@/shared/ui/buttons/IconButton'
import PageHeader from '@/shared/ui/page/PageHeader'
import PageTabs from '@/shared/ui/page/PageTabs'
import Badge from '@/shared/ui/Badge'
import MenuItem from '@/shared/ui/navigation/MenuItem'
import Popover from '@/shared/ui/overlay/Popover'
import { useToast } from '@/shared/ui/feedback/Toast'
import {
  CopyIcon,
  DatabaseIcon,
  DbLogo,
  DownloadIcon,
  EditIcon,
  ExternalLinkIcon,
  MoreVerticalIcon,
  RefreshIcon,
  TableIcon,
  TrashIcon,
} from '@/shared/ui/icons'

export const DETAIL_TABS = [
  { id: 'data', label: 'Data Connection' },
  { id: 'access', label: 'Access' },
  { id: 'backup', label: 'Backup' },
]

// `bg-status-ok` (a fixed green), not `bg-green` — the latter follows the
// workspace accent, and "Connected" has to read as green whatever that is.
const STATUS = {
  checking: { dot: 'bg-ink-faint animate-pulse', text: 'text-ink-faint', label: 'Checking…' },
  connected: { dot: 'bg-status-ok', text: 'text-ink-dim', label: 'Connected' },
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
  if (c.type === 'redis') {
    // TLS is carried by the scheme (rediss://), not a query param.
    return `${c.tls ? 'rediss' : 'redis'}://${auth}${c.host || ''}${c.port ? ':' + c.port : ''}${db}`
  }
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

// Full-page connection detail: Data Connection / Access / Backup tabs, each laid
// out as a main column + a context sidebar. The tab is controlled by the page
// (it lives in the URL as `/connections/:id/:tab`), so a tab is linkable.
export default function ConnectionDetail({ conn, onBack, onOpen, onEdit, onDelete, onExport, connecting, tab = 'data', onTab }: any) {
  const toast = useToast()
  const [status, setStatus] = useState<'checking' | 'connected' | 'offline'>('checking')
  const [tableCount, setTableCount] = useState<number | null>(null)
  const [sessions, setSessions] = useState<SessionStats | null>(null)

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

  // Live session picture. Re-read after the ping so the console's own session
  // (opened by that ping) is already counted.
  useEffect(() => {
    let alive = true
    listConnectionSessions(conn).then((s) => alive && setSessions(s))
    return () => {
      alive = false
    }
  }, [conn.id, status])

  const copyUrl = () => {
    navigator.clipboard?.writeText(connectionUrl(conn))
    toast.success('Connection URL copied to clipboard.')
  }

  const tags: string[] = Array.isArray(conn.tags) ? conn.tags : conn.tags ? String(conn.tags).split(',').map((t) => t.trim()).filter(Boolean) : []
  const subtitleParts = [TYPE_LABEL[conn.type] || conn.type, conn.environment, conn.folder].filter(Boolean)

  return (
    <div className="w-full">
      <PageHeader
        back={{ label: 'All connections', onClick: onBack }}
        media={<DbLogo type={conn.type} className="h-12 w-12 rounded-[12px]" />}
        title={conn.name}
        meta={<StatusBadge status={status} />}
        desc={subtitleParts.join(' · ')}
        action={
          <>
            <Button variant="subtle" size="lg" icon={EditIcon} onClick={() => onEdit(conn)}>
              Edit
            </Button>
            <Popover
              align="right"
              width={180}
              trigger={({ open, toggle }) => (
                <IconButton size="lg" onClick={toggle} active={open} aria-label="Connection actions">
                  <MoreVerticalIcon width={16} height={16} />
                </IconButton>
              )}
            >
              {({ close }) => (
                <div className="p-1">
                  <MenuItem onClick={() => { copyUrl(); close() }}>
                    <CopyIcon width={14} height={14} /> Copy as URL
                  </MenuItem>
                  {onExport && (
                    <MenuItem onClick={() => { close(); onExport(conn) }}>
                      <DownloadIcon width={14} height={14} /> Export as JSON
                    </MenuItem>
                  )}
                  {onDelete && (
                    <>
                      <div className="my-1 h-px bg-edge" />
                      <MenuItem danger onClick={() => { close(); onDelete(conn) }}>
                        <TrashIcon width={14} height={14} /> Delete
                      </MenuItem>
                    </>
                  )}
                </div>
              )}
            </Popover>
            <Button variant="primary" size="lg" icon={ExternalLinkIcon} disabled={connecting} onClick={() => onOpen(conn)}>
              {connecting ? 'Connecting…' : 'Connect'}
            </Button>
          </>
        }
      />

      <PageTabs tabs={DETAIL_TABS} active={tab} onTab={onTab}>
        {tab === 'data' ? (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
            {/* Main */}
            <div className="flex flex-col gap-5">
              <div className="grid grid-cols-3 gap-3 max-[560px]:grid-cols-1">
                <MiniStat icon={TableIcon} label="Tables" value={tableCount ?? '—'} />
                <MiniStat icon={DatabaseIcon} label="Type" value={TYPE_LABEL[conn.type] || conn.type} />
                <MiniStat icon={RefreshIcon} label="Status" value={STATUS[status].label} />
              </div>

              <div className="rounded-card border border-edge bg-card p-5">
                <div className="mb-1 text-[13px] font-bold">Connection details</div>
                <div className="mt-2">
                  {conn.type === 'sqlite' ? (
                    <DetailRow label="File path" value={conn.filepath} />
                  ) : (
                    <>
                      <DetailRow label="Host" value={conn.host} />
                      <DetailRow label="Port" value={conn.port ? String(conn.port) : undefined} />
                      <DetailRow label={conn.type === 'redis' ? 'Database index' : 'Database'} value={conn.database} />
                      <DetailRow label="Username" value={conn.username} />
                      {conn.type === 'redis' ? (
                        <DetailRow label="TLS" value={conn.tls ? (conn.tls === 'insecure' ? 'enabled (unverified)' : 'enabled') : undefined} />
                      ) : (
                        <DetailRow label="SSL mode" value={conn.sslmode} />
                      )}
                    </>
                  )}
                  {conn.folder && <DetailRow label="Folder" value={conn.folder} />}
                  <DetailRow label="Owner" value={conn.ownerName || conn.ownerEmail} />
                </div>
              </div>
            </div>

            {/* Context sidebar */}
            <aside className="flex flex-col gap-5">
              <div className="rounded-card border border-edge bg-card p-5">
                <div className="text-[13px] font-bold">Overview</div>
                <div className="mt-2 divide-y divide-edge">
                  <OverviewRow label="Type" value={TYPE_LABEL[conn.type] || conn.type} />
                  {conn.environment && <OverviewRow label="Environment" value={conn.environment} />}
                  {conn.folder && <OverviewRow label="Folder" value={conn.folder} />}
                  <OverviewRow label="Owner" value={conn.ownerName || conn.ownerEmail || '—'} />
                  {sessions && (
                    <OverviewRow
                      label="Sessions"
                      value={sessions.max ? `${sessions.active} of ${sessions.max}` : `${sessions.active} (no limit)`}
                    />
                  )}
                  {typeof conn.schemaVersion === 'number' && <OverviewRow label="Schema version" value={`v${conn.schemaVersion}`} />}
                </div>
                {tags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {tags.map((t) => (
                      <Badge key={t} tone="neutral">{t}</Badge>
                    ))}
                  </div>
                )}
              </div>
            </aside>
          </div>
        ) : tab === 'access' ? (
          <ConnectionAccessPanel conn={conn} />
        ) : (
          <BackupPanel
            connectionId={conn.id}
            connectionType={conn.type}
            workspaceId={conn.workspaceId}
            onConfigure={() => onEdit(conn, 'backup')}
          />
        )}
      </PageTabs>
    </div>
  )
}

function MiniStat({ icon: Icon, label, value }: { icon: any; label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-card border border-edge bg-card p-4">
      <div className="flex items-center gap-2 text-[11px] text-ink-dim">
        <Icon width={14} height={14} /> {label}
      </div>
      <div className="mt-1.5 truncate text-[17px] font-bold">{value}</div>
    </div>
  )
}

function OverviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="text-[12px] text-ink-dim">{label}</span>
      <span className="min-w-0 truncate text-right text-[12px] font-medium text-ink">{value}</span>
    </div>
  )
}
