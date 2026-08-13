import Modal from '@/shared/ui/overlay/Modal'
import ProgressBar from '@/shared/ui/feedback/ProgressBar'
import type { SyncProgress } from '@/features/schema-designer/lib/sync'

/** Before the table list lands there is nothing to report yet, only a wait. */
const NOTHING_READ: SyncProgress = { done: 0, total: 0, reading: [], indexes: 0 }

/**
 * A schema read in flight — the bar, the counts, and the tables in it.
 *
 * Exported on its own because a sync is waited on in two places: as itself
 * (the header's "Sync schema", the modal below) and as the first step of a
 * release, inside the dialog that goes on to ask the question. One read, drawn
 * one way, wherever someone is watching it.
 */
export function SyncProgressView({
  progress,
  className = '',
}: {
  progress: SyncProgress | null
  className?: string
}) {
  const { done, total, reading, indexes } = progress || NOTHING_READ
  const pct = total ? Math.round((done / total) * 100) : 0

  return (
    <div className={className}>
      <ProgressBar value={done} max={total || 1} label="Sync progress" />
      <div className="mt-2 flex items-baseline justify-between gap-3 text-[11px]">
        <span className="min-w-0 truncate text-ink-dim">
          {total ? (
            <>
              {done} / {total} table{total === 1 ? '' : 's'} · {indexes} index{indexes === 1 ? '' : 'es'}
            </>
          ) : (
            'Reading the table list…'
          )}
        </span>
        <span className="shrink-0 font-mono text-ink-faint">{pct}%</span>
      </div>

      {/* Which tables are in flight — the difference between "it's working" and
          a bar that could be stuck. Held to one line: the names are reassurance,
          not a list to read. */}
      <p className="mt-3 h-4 truncate text-[11px] text-ink-faint">
        {reading.length ? `Reading ${reading.join(', ')}` : total && done === total ? 'Saving the design…' : ''}
      </p>
    </div>
  )
}

/**
 * "Syncing schema", while it runs — a sync someone asked for on its own.
 *
 * A modal rather than a strip because a sync *replaces* the schema the canvas
 * draws: editing a diagram that is about to be redrawn under you is work you
 * would lose, so the design is covered until the read lands.
 *
 * Deliberately not dismissible — `onClose` is a no-op, so the backdrop doesn't
 * close it. There is nothing to decide here: it goes away by itself when the
 * read finishes, and when one fails the toast says why.
 *
 * A release reads the same schema but does not use this: it has a dialog of its
 * own to put the read in, and a second modal over the first would be asking
 * someone to watch two. See ReleaseDialog.
 */
export default function SyncProgressDialog({
  progress,
  connectionName,
}: {
  progress: SyncProgress
  connectionName?: string | null
}) {
  return (
    <Modal title="Syncing schema" width={420} onClose={() => {}}>
      <p className="text-[12px] leading-relaxed text-ink-dim">
        Reading {connectionName ? <span className="text-ink">{connectionName}</span> : 'the database'} — its tables,
        their indexes and the relationships between them.
      </p>

      <SyncProgressView progress={progress} className="mt-4" />

      <p className="mt-4 border-t border-edge pt-3 text-[11px] leading-relaxed text-ink-faint">
        Please wait — this replaces the schema the diagram draws, so the design stays covered until it finishes.
      </p>
    </Modal>
  )
}
