import { useState } from 'react'
import type { ConnectionSession, Handshake } from '@/shared/api/database'
import Button from '@/shared/ui/buttons/Button'
import IconButton from '@/shared/ui/buttons/IconButton'
import { TYPE_LABEL } from './DbTypePickerModal'
import {
  ClockIcon,
  CloseIcon,
  DatabaseIcon,
  EditIcon,
  ExternalLinkIcon,
  GlobeIcon,
  InfoIcon,
  KeyIcon,
  RefreshIcon,
  ShieldIcon,
  UsersIcon,
} from '@/shared/ui/icons'

// Headline + icon per `reason` code from the server (server/db/diagnose.js).
// The dialog still renders `cause`/`hint` verbatim, so an unknown reason from a
// newer server degrades to the generic row rather than an empty dialog.
const REASONS: Record<string, { title: string; icon: any }> = {
  dns: { title: 'Host not found', icon: GlobeIcon },
  refused: { title: 'Connection refused', icon: GlobeIcon },
  timeout: { title: 'Timed out', icon: ClockIcon },
  network: { title: 'Network unreachable', icon: GlobeIcon },
  tls: { title: 'TLS/SSL mismatch', icon: ShieldIcon },
  auth: { title: 'Authentication failed', icon: KeyIcon },
  permission: { title: 'Permission denied', icon: ShieldIcon },
  missing_database: { title: 'Database not found', icon: DatabaseIcon },
  missing_file: { title: 'File not found', icon: DatabaseIcon },
  busy: { title: 'Server unavailable', icon: ClockIcon },
  at_capacity: { title: 'Session limit reached', icon: UsersIcon },
  unsupported: { title: 'Not supported', icon: InfoIcon },
  unknown: { title: 'Connection failed', icon: InfoIcon },
}

// Everyone currently on a session, flattened — the participant map is keyed by
// user id, which is nothing the user needs to see.
const peopleOn = (sessions: ConnectionSession[] = []) => {
  const names = new Set<string>()
  sessions.forEach((s) => Object.values(s.participants || {}).forEach((p) => names.add(p.name)))
  return [...names]
}

/**
 * Shown when the pre-flight handshake fails on the way to the console: the most
 * likely root cause, what to do about it, and the raw driver error behind a
 * disclosure. "Open anyway" stays available — the probe can be wrong (a server
 * that was briefly restarting), and the user may just want the saved queries.
 */
export default function ConnectHandshakeDialog({
  conn,
  result,
  busy,
  onRetry,
  onEdit,
  onOpenAnyway,
  onClose,
}: {
  conn: any
  result: Handshake
  busy?: boolean
  onRetry: () => void
  onEdit?: () => void
  onOpenAnyway: () => void
  onClose: () => void
}) {
  const [showDetail, setShowDetail] = useState(false)
  const reason = REASONS[result.reason || 'unknown'] || REASONS.unknown
  const Icon = reason.icon
  const where = [TYPE_LABEL[conn.type] || conn.type, result.target].filter(Boolean).join(' · ')

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade items-center justify-center bg-black/60 p-6 backdrop-blur-[3px]"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-[520px] animate-pop rounded-[16px] border border-edge-strong bg-panel p-6"
        onMouseDown={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-label="Connection handshake failed"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red/15 text-red">
              <Icon width={18} height={18} />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-[18px] font-bold">Can’t connect to “{conn.name}”</h2>
              <p className="mt-0.5 truncate font-mono text-[12px] text-ink-faint">{where}</p>
            </div>
          </div>
          <IconButton size="lg" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </IconButton>
        </div>

        {/* Root cause */}
        <div className="mt-5 rounded-card border border-edge bg-card p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.4px] text-red">{reason.title}</div>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink">{result.cause}</p>
          {result.hint && <p className="mt-2 text-[12px] leading-relaxed text-ink-dim">{result.hint}</p>}
        </div>

        {/* Who's holding the sessions (capacity failures only) */}
        {result.reason === 'at_capacity' && !!result.sessions?.length && (
          <div className="mt-3 rounded-card border border-edge bg-card p-4">
            <div className="flex items-baseline justify-between gap-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.4px] text-ink-dim">In use now</div>
              <div className="font-mono text-[11px] text-ink-faint">
                {result.limit?.active ?? result.sessions.length} / {result.limit?.max ?? '∞'}
              </div>
            </div>
            <ul className="mt-2 flex flex-col gap-1.5">
              {result.sessions.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 text-[12px]">
                  <span className="truncate font-mono text-ink-dim">{s.target}</span>
                  <span className="shrink-0 truncate text-ink-faint">{peopleOn([s]).join(', ') || 'system'}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Raw driver error — the truth when the guess above is wrong */}
        {result.detail && (
          <div className="mt-3">
            <button
              className="text-[12px] text-ink-dim underline-offset-2 hover:text-ink hover:underline"
              onClick={() => setShowDetail((v) => !v)}
            >
              {showDetail ? 'Hide' : 'Show'} technical details
            </button>
            {showDetail && (
              <pre className="mt-2 max-h-[140px] overflow-auto rounded-soft border border-edge bg-card p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-ink-dim">
                {result.code ? `${result.code}: ` : ''}
                {result.detail}
              </pre>
            )}
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          {/* No "open anyway" at capacity — the console would just 429 on every
              panel. Every other failure can be a false negative, this one can't. */}
          {result.reason !== 'at_capacity' && (
            <Button size="lg" icon={ExternalLinkIcon} onClick={onOpenAnyway}>
              Open anyway
            </Button>
          )}
          {onEdit && (
            <Button size="lg" icon={EditIcon} onClick={onEdit}>
              Edit connection
            </Button>
          )}
          <Button variant="primary" size="lg" icon={RefreshIcon} disabled={busy} onClick={onRetry}>
            {busy ? 'Retrying…' : 'Retry'}
          </Button>
        </div>
      </div>
    </div>
  )
}
