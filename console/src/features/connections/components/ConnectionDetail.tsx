import { useEffect, useState } from 'react'
import { useConnections } from '../stores/ConnectionsContext'
import ConnectionAccessPanel from './ConnectionAccessPanel'
import { TYPE_LABEL } from './DbTypePickerModal'
import { BackupPanel } from '@/features/backup'
import { addressOf, listSshGateways, type SshGateway } from '@/features/ssh'
import { listTopics } from '@/features/kafka'
import { useModules } from '@/features/modules'
import { consoleKindOf } from '@/shared/config/databaseTypes'
// Deep import, not the `@/features/schema-designer` barrel: that barrel's
// WorkspaceSchemaList reads TYPE_LABEL back out of *this* feature, so going
// through it would make the two barrels a cycle. The panel itself depends on
// nothing here.
import SchemaHistoryPanel from '@/features/schema-designer/components/SchemaHistoryPanel'
import { listConnectionSessions, listTables, pingConnection } from '@/shared/api/database'
import type { SessionStats } from '@/shared/api/database'
import PageHeader from '@/shared/ui/page/PageHeader'
import PageTabs from '@/shared/ui/page/PageTabs'
import MenuItem from '@/shared/ui/navigation/MenuItem'
import Popover from '@/shared/ui/overlay/Popover'
import { toast } from 'sonner'
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
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'

/**
 * The detail page's tabs, for a connection of `type`.
 *
 * A function rather than a constant because one of them doesn't apply
 * everywhere: a schemaless engine (Redis) has no DDL and so no version trail,
 * and a tab that opens on "nothing has been committed" would be a promise the
 * engine can't keep. The page needs the same list to validate the `:tab`
 * segment against, which is why this is exported rather than built inline.
 *
 * A missing type means "still loading" — the full list, so a cold load of
 * `/connections/:id/schema` isn't bounced to Data before the connection that
 * would justify the tab has even arrived.
 */
export function detailTabs(type?: string, { backup = true, locked = false }: { backup?: boolean; locked?: boolean } = {}) {
  // Locked (its database turned off on this instance): every other tab would
  // only show the server refusing — the record itself is all there is to see.
  if (locked) return [{ id: 'data', label: 'Data Connection' }]
  return [
    { id: 'data', label: 'Data Connection' },
    { id: 'access', label: 'Access' },
    // Schemaless engines (Redis, Kafka) never run DDL, so they have no history.
    ...(consoleKindOf(type) !== 'sql' ? [] : [{ id: 'schema', label: 'Schema history' }]),
    // The Backup module, when an instance admin hasn't turned it off.
    ...(backup ? [{ id: 'backup', label: 'Backup' }] : []),
  ]
}

// `bg-success` (a fixed green), not `bg-primary` — the latter follows the
// workspace accent, and "Connected" has to read as green whatever that is.
const STATUS = {
  checking: { dot: 'bg-faint animate-pulse', text: 'text-faint', label: 'Checking…' },
  connected: { dot: 'bg-success', text: 'text-muted-foreground', label: 'Connected' },
  offline: { dot: 'bg-destructive', text: 'text-muted-foreground', label: 'Offline' },
  // Its database is turned off on this instance (Admin → Modules).
  locked: { dot: 'bg-warning', text: 'text-warning', label: 'Locked' },
}

// Live-connectivity dot + label ("Connected" / "Offline" / "Checking…" / "Locked").
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
  if (c.type === 'kafka') {
    // Not a URI any client parses — just the bootstrap list in one copyable line.
    return `kafka://${c.brokers || `${c.host || ''}${c.port ? ':' + c.port : ''}`}`
  }
  if (c.type === 'redis') {
    // TLS is carried by the scheme (rediss://), not a query param.
    return `${c.tls ? 'rediss' : 'redis'}://${auth}${c.host || ''}${c.port ? ':' + c.port : ''}${db}`
  }
  const ssl = c.sslmode && c.sslmode !== 'disable' ? `?sslmode=${c.sslmode}` : ''
  return `${c.type === 'mysql' ? 'mysql' : 'postgresql'}://${auth}${c.host || ''}${c.port ? ':' + c.port : ''}${db}${ssl}`
}

function DetailRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border py-2.5 last:border-0">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right font-mono text-[12px] text-foreground">{value}</span>
    </div>
  )
}

// Full-page connection detail: Data Connection / Access / Backup tabs, each laid
// out as a main column + a context sidebar. The tab is controlled by the page
// (it lives in the URL as `/connections/:id/:tab`), so a tab is linkable.
export default function ConnectionDetail({ conn, onOpen, onEdit, onDelete, onExport, onRefresh, connecting, tab = 'data', onTab }: any) {
  const { connections } = useConnections()
  const { isEnabled } = useModules()
  const [status, setStatus] = useState<'checking' | 'connected' | 'offline' | 'locked'>('checking')
  const [tableCount, setTableCount] = useState<number | null>(null)
  const [sessions, setSessions] = useState<SessionStats | null>(null)
  const [gateway, setGateway] = useState<SshGateway | null>(null)

  // The tunnel is part of how this database is reached, so it reads with the host.
  useEffect(() => {
    if (!conn.sshGatewayId || !conn.workspaceId) return setGateway(null)
    listSshGateways(conn.workspaceId).then((list) => setGateway(list.find((g) => g.id === conn.sshGatewayId) || null))
  }, [conn.sshGatewayId, conn.workspaceId])

  useEffect(() => {
    let alive = true
    setTableCount(null)
    if (conn.locked) {
      setStatus('locked')
      return
    }
    setStatus('checking')
    pingConnection(conn).then((r) => {
      if (!alive) return
      setStatus(r.ok ? 'connected' : 'offline')
      // A stream engine counts topics where a SQL one counts tables.
      const count = conn.type === 'kafka' ? listTopics(conn).catch(() => []) : listTables(conn)
      if (r.ok) count.then((t) => alive && setTableCount(Array.isArray(t) ? t.length : 0))
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
    if (!conn.locked) listConnectionSessions(conn).then((s) => alive && setSessions(s))
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
        crumbs={[{ label: conn.name }]}
        media={<DbLogo type={conn.type} className="h-12 w-12 rounded-[12px]" />}
        title={conn.name}
        meta={<StatusBadge status={status} />}
        desc={subtitleParts.join(' · ')}
        action={
          <>
            {!conn.locked && (
              <Button variant="ghost" size="lg" onClick={() => onEdit(conn)}>
                <EditIcon width={15} height={15} />
                Edit
              </Button>
            )}
            <Popover
              align="right"
              width={180}
              trigger={({ open, toggle }) => (
                <Button variant="ghost" size="icon" onClick={toggle} aria-pressed={open} aria-label="Connection actions">
                  <MoreVerticalIcon width={16} height={16} />
                </Button>
              )}
            >
              {({ close }) => (
                <div className="p-1">
                  <MenuItem onClick={() => { copyUrl(); close() }}>
                    <CopyIcon width={14} height={14} /> Copy as URL
                  </MenuItem>
                  {onExport && !conn.locked && (
                    <MenuItem onClick={() => { close(); onExport(conn) }}>
                      <DownloadIcon width={14} height={14} /> Export as JSON
                    </MenuItem>
                  )}
                  {onDelete && (
                    <>
                      <div className="my-1 h-px bg-border" />
                      <MenuItem danger onClick={() => { close(); onDelete(conn) }}>
                        <TrashIcon width={14} height={14} /> Delete
                      </MenuItem>
                    </>
                  )}
                </div>
              )}
            </Popover>
            <Button variant="default" size="lg" disabled={connecting || conn.locked} onClick={() => onOpen(conn)}>
              <ExternalLinkIcon width={15} height={15} />
              {connecting ? 'Connecting…' : 'Connect'}
            </Button>
          </>
        }
      />

      {conn.locked && (
        <div role="status" className="mt-5 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-[12px] leading-relaxed text-foreground">
          <span className="font-semibold">This connection is locked.</span>{' '}
          <span className="text-muted-foreground">
            An instance administrator turned {TYPE_LABEL[conn.type] || conn.type} off, so it can’t be opened, edited or backed
            up. Nothing was deleted — it comes back as it was when {TYPE_LABEL[conn.type] || conn.type} is turned on again. You
            can still delete it.
          </span>
        </div>
      )}

      <PageTabs tabs={detailTabs(conn.type, { backup: isEnabled('backup'), locked: conn.locked })} active={tab} onTab={onTab}>
        {tab === 'data' ? (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
            {/* Main */}
            <div className="flex flex-col gap-5">
              <div className="grid grid-cols-3 gap-3 max-[560px]:grid-cols-1">
                <MiniStat icon={TableIcon} label={conn.type === 'kafka' ? 'Topics' : 'Tables'} value={tableCount ?? '—'} />
                <MiniStat icon={DatabaseIcon} label="Type" value={TYPE_LABEL[conn.type] || conn.type} />
                <MiniStat icon={RefreshIcon} label="Status" value={STATUS[status].label} />
              </div>

              <div className="rounded-xl border border-border bg-card p-5">
                <div className="mb-1 text-[13px] font-bold">Connection details</div>
                <div className="mt-2">
                  {conn.type === 'sqlite' ? (
                    <DetailRow label="File path" value={conn.filepath} />
                  ) : conn.type === 'kafka' ? (
                    <>
                      <DetailRow label="Bootstrap servers" value={conn.brokers} />
                      <DetailRow label="SASL" value={conn.auth === 'none' ? undefined : `${(conn.saslMechanism || '').toUpperCase()} · ${conn.username || ''}`} />
                      <DetailRow
                        label="TLS"
                        value={
                          conn.tls
                            ? `${conn.tls === 'insecure' ? 'enabled (unverified)' : 'enabled'}${conn.clientCertFormat ? ' · client certificate' : ''}`
                            : undefined
                        }
                      />
                      <DetailRow label="Client ID" value={conn.clientId} />
                      {conn.sshGatewayId && (
                        <DetailRow label="SSH tunnel" value={gateway ? `${gateway.name} (${addressOf(gateway)})` : 'host missing'} />
                      )}
                    </>
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
                      {conn.sshGatewayId && (
                        <DetailRow
                          label="SSH tunnel"
                          value={gateway ? `${gateway.name} (${addressOf(gateway)})` : 'host missing'}
                        />
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
              <div className="rounded-xl border border-border bg-card p-5">
                <div className="text-[13px] font-bold">Overview</div>
                <div className="mt-2 divide-y divide-border">
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
                      <Badge key={t} variant="secondary">{t}</Badge>
                    ))}
                  </div>
                )}
              </div>
            </aside>
          </div>
        ) : tab === 'access' ? (
          <ConnectionAccessPanel conn={conn} onChange={onRefresh} />
        ) : tab === 'schema' ? (
          // Rolling back moves the connection's schema version, which the
          // Overview card on the Data tab shows — so the same reload the access
          // editor triggers keeps the two halves of this page agreeing.
          <SchemaHistoryPanel conn={conn} onChange={onRefresh} />
        ) : (
          <BackupPanel
            connectionId={conn.id}
            connectionType={conn.type}
            connectionName={conn.name}
            workspaceId={conn.workspaceId}
            connections={connections}
            onConfigure={() => onEdit(conn, 'backup')}
          />
        )}
      </PageTabs>
    </div>
  )
}

function MiniStat({ icon: Icon, label, value }: { icon: any; label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <Icon width={14} height={14} /> {label}
      </div>
      <div className="mt-1.5 truncate text-[17px] font-bold">{value}</div>
    </div>
  )
}

function OverviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right text-[12px] font-medium text-foreground">{value}</span>
    </div>
  )
}
