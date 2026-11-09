import { useState } from 'react'
import type { ConnectionSession, Handshake } from '@/shared/api/database'
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
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/shared/ui/dialog'

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
  disabled: { title: 'Turned off on this instance', icon: InfoIcon },
  ssh: { title: 'SSH tunnel failed', icon: KeyIcon },
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
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} aria-describedby={undefined} role="alertdialog" aria-label="Connection handshake failed" className="block sm:max-w-[520px] p-6 gap-0">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive">
              <Icon width={18} height={18} />
            </span>
            <div className="min-w-0">
              <DialogTitle className="truncate text-[18px] font-bold">Can’t connect to “{conn.name}”</DialogTitle>
              <p className="mt-0.5 truncate font-mono text-[12px] text-faint">{where}</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </Button>
        </div>

        {/* Root cause */}
        <div className="mt-5 rounded-xl border border-border bg-card p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.4px] text-destructive">{reason.title}</div>
          <p className="mt-1.5 text-[13px] leading-relaxed text-foreground">{result.cause}</p>
          {result.hint && <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">{result.hint}</p>}
        </div>

        {/* Who's holding the sessions (capacity failures only) */}
        {result.reason === 'at_capacity' && !!result.sessions?.length && (
          <div className="mt-3 rounded-xl border border-border bg-card p-4">
            <div className="flex items-baseline justify-between gap-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.4px] text-muted-foreground">In use now</div>
              <div className="font-mono text-[11px] text-faint">
                {result.limit?.active ?? result.sessions.length} / {result.limit?.max ?? '∞'}
              </div>
            </div>
            <ul className="mt-2 flex flex-col gap-1.5">
              {result.sessions.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 text-[12px]">
                  <span className="truncate font-mono text-muted-foreground">{s.target}</span>
                  <span className="shrink-0 truncate text-faint">{peopleOn([s]).join(', ') || 'system'}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Raw driver error — the truth when the guess above is wrong */}
        {result.detail && (
          <div className="mt-3">
            <button
              className="text-[12px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              onClick={() => setShowDetail((v) => !v)}
            >
              {showDetail ? 'Hide' : 'Show'} technical details
            </button>
            {showDetail && (
              <pre className="mt-2 max-h-[140px] overflow-auto rounded-lg border border-border bg-card p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
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
            <Button variant="outline" size="lg" onClick={onOpenAnyway}>
              <ExternalLinkIcon width={15} height={15} />
              Open anyway
            </Button>
          )}
          {onEdit && (
            <Button variant="outline" size="lg" onClick={onEdit}>
              <EditIcon width={15} height={15} />
              Edit connection
            </Button>
          )}
          <Button variant="default" size="lg" disabled={busy} onClick={onRetry}>
            <RefreshIcon width={15} height={15} />
            {busy ? 'Retrying…' : 'Retry'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
