import Modal from '@/shared/ui/overlay/Modal'
import ProgressBar from '@/shared/ui/feedback/ProgressBar'
import type { SyncProgress } from '@/features/schema-designer/lib/sync'

/**
 * "Syncing schema", while it runs.
 *
 * A modal rather than a strip because a sync *replaces* the schema the canvas
 * draws: editing a diagram that is about to be redrawn under you is work you
 * would lose, so the design is covered until the read lands.
 *
 * Deliberately not dismissible — `onClose` is a no-op, so the backdrop doesn't
 * close it. There is nothing to decide here: it goes away by itself when the
 * read finishes, and when one fails the toast says why.
 */
export default function SyncProgressDialog({
  progress,
  connectionName,
}: {
  progress: SyncProgress
  connectionName?: string | null
}) {
  const { done, total, reading, indexes } = progress
  const pct = total ? Math.round((done / total) * 100) : 0

  return (
    <Modal title="Syncing schema" width={420} onClose={() => {}}>
      <p className="text-[12px] leading-relaxed text-ink-dim">
        Reading {connectionName ? <span className="text-ink">{connectionName}</span> : 'the database'} — its tables,
        their indexes and the relationships between them.
      </p>

      <div className="mt-4">
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
      </div>

      {/* Which tables are in flight — the difference between "it's working" and
          a bar that could be stuck. Held to one line: the names are reassurance,
          not a list to read. */}
      <p className="mt-3 h-4 truncate text-[11px] text-ink-faint">
        {reading.length ? `Reading ${reading.join(', ')}` : total && done === total ? 'Saving the design…' : ''}
      </p>

      <p className="mt-4 border-t border-edge pt-3 text-[11px] leading-relaxed text-ink-faint">
        Please wait — this replaces the schema the diagram draws, so the design stays covered until it finishes.
      </p>
    </Modal>
  )
}
