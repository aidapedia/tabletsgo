import Button from '@/shared/ui/buttons/Button'
import Badge from '@/shared/ui/Badge'
import SqlEditor from '@/shared/ui/SqlEditor'
import { relativeTime } from '@/shared/lib/recents'
import { SyncProgressView } from '@/features/schema-designer/components/SyncProgressDialog'
import type { SyncProgress } from '@/features/schema-designer/lib/sync'

/** The database a design releases to — as little of a connection as this needs. */
export type ReleaseTarget = { id: string; name: string; type: string }

/** One staged statement and the statement that would undo it, if there is one. */
export type ReleaseStatement = { sql: string; rollbackSql?: string | null }

/**
 * Where a release has got to. The dialog is one window on two steps, so the
 * step it is on is what it is given — not a set of flags it has to reconcile.
 */
export type ReleasePhase =
  /** Step 1: reading the database. Null progress = the table list hasn't landed. */
  | { step: 'sync'; progress: SyncProgress | null }
  /** Step 1 didn't land. Nothing has run; the way on is another read. */
  | { step: 'failed'; error: string }
  /** Step 2: the statements, resolved against what step 1 read. */
  | { step: 'review'; statements: ReleaseStatement[] }

/**
 * The confirmation in front of Release: running a design's staged DDL against a
 * live database.
 *
 * It asks rather than just running because this is the one action in the editor
 * that leaves the diagram and changes a real database — and unlike the console's
 * Changes queue there is no second look at the statements before they execute.
 * So the whole migration is shown here as the schema history will record it: Up
 * SQL in the order it runs, Down SQL in the order a rollback would undo it
 * (reversed — last applied, first undone), which is what makes an irreversible
 * statement visible *before* it runs rather than as a greyed-out Rollback button
 * afterwards.
 *
 * Two steps, in one window. The canvas draws the design's stored snapshot and
 * never re-reads on its own, so a design opened today can be staging DDL against
 * a schema someone changed last week — and everything this dialog shows (the Up
 * SQL, and the Down SQL resolved from the definitions it is about to overwrite)
 * is only true of the schema that is there *now*. So the database is read first,
 * inside the dialog, with Release disabled until it lands: the question and the
 * evidence for it arrive in the same place, and there is no moment where the
 * button is live over a schema nobody has checked. `drift` is what that read
 * found staged against a database that has moved on — a warning, never a block,
 * because the answer to "it already exists" is a decision, not a repair.
 *
 * There is no picker: a design releases to the connection it was designed
 * against, and nowhere else. A from-scratch design is linked to a connection
 * first (LinkConnectionDialog) — which is the same choice, made once, where the
 * diagram then redraws against that database instead of guessing at one from a
 * dropdown seconds before the DDL runs.
 */
export default function ReleaseDialog({
  phase,
  target,
  dialect,
  syncedAt = 0,
  drift = [],
  onRetry,
  onCancel,
  onConfirm,
}: {
  phase: ReleasePhase
  target: ReleaseTarget
  dialect?: string
  /** When the schema this was checked against was read — 0 if it never was. */
  syncedAt?: number
  /** Staged statements the freshly-read schema contradicts, in plain words. */
  drift?: string[]
  onRetry: () => void
  onCancel: () => void
  onConfirm: () => void
}) {
  const statements = phase.step === 'review' ? phase.statements : []
  const upSql = statements.map((s) => s.sql.trim()).join('\n')
  const reversible = statements.filter((s) => s.rollbackSql).length
  // Statements with no inverse still get a line, so the Down block is the whole
  // migration rather than a silently shorter one — the same inline note the
  // draft inspector uses.
  const downSql = statements
    .map((s) => (s.rollbackSql ? s.rollbackSql.trim() : `-- No automatic down SQL for: ${s.sql.trim()}`))
    .reverse()
    .join('\n')

  const label = (text: string) => (
    <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-ink-faint">{text}</div>
  )

  return (
    <div
      className="fixed inset-0 z-[60] flex animate-fade items-center justify-center bg-black/60 p-6 backdrop-blur-[3px]"
      // Only once nothing is in flight: a backdrop click during the read would
      // leave the sync running with nothing on screen saying so.
      onMouseDown={() => phase.step !== 'sync' && onCancel()}
    >
      <div
        className="flex max-h-full w-full max-w-[560px] animate-pop flex-col rounded-[16px] border border-edge-strong bg-panel p-5"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-bold text-ink">Release this schema?</h3>

        {/* The two steps, always both visible: "read the database" is not a
            wait to be sat through but the half of this that makes the other
            half true, so it is named and its turn is shown. */}
        <div className="mt-3 flex items-center gap-2 text-[11px]">
          <WizardStep n={1} label="Read the database" state={phase.step === 'review' ? 'done' : 'active'} />
          <span className="h-px w-6 bg-edge" />
          <WizardStep n={2} label="Review & release" state={phase.step === 'review' ? 'active' : 'todo'} />
        </div>

        <div className="mt-4 flex items-center gap-2">
          <span className="w-[70px] shrink-0 text-[11px] font-semibold text-ink-faint">Database</span>
          <span className="flex min-w-0 items-center gap-2 text-[12px] text-ink">
            <span className="truncate font-semibold">{target.name}</span>
            <Badge tone="faint" dense>
              {target.type}
            </Badge>
          </span>
        </div>

        {phase.step === 'sync' && (
          <>
            <p className="mt-4 text-[12px] leading-relaxed text-ink-dim">
              Reading <span className="text-ink">{target.name}</span> before anything is confirmed — its tables, their
              indexes and the relationships between them. What you release is then measured against the schema that is
              there now, not the one the design last saw.
            </p>
            <SyncProgressView progress={phase.progress} className="mt-4" />
          </>
        )}

        {phase.step === 'failed' && (
          <div className="mt-4">
            <p className="text-[12px] leading-relaxed text-ink-dim">
              Nothing has run. The schema couldn't be read, and releasing without it would run this DDL against a
              database nobody could see.
            </p>
            <div className="mt-3 rounded-soft border border-red/40 bg-red/10 px-3 py-2 text-[11px] leading-relaxed text-ink-dim">
              {phase.error}
            </div>
          </div>
        )}

        {phase.step === 'review' && (
          <>
            <p className="mt-4 text-[12px] leading-relaxed text-ink-dim">
              {statements.length} statement{statements.length === 1 ? '' : 's'} will run against the database, in this
              order. They execute for real — a statement that drops or rewrites something takes its data with it.
            </p>

            {/* When what this was checked against was read. Stated because the
                whole step is only as true as that read. */}
            {syncedAt ? (
              <div className="mt-3 flex items-center gap-2">
                <span className="w-[70px] shrink-0 text-[11px] font-semibold text-ink-faint">Schema</span>
                <span className="text-[12px] text-ink-dim">read {relativeTime(syncedAt)}</span>
              </div>
            ) : null}

            {/* What that read contradicts. Above the SQL, because it is the
                reason to cancel — a statement that will fail on arrival is
                worth seeing before the block of SQL it is buried in. */}
            {drift.length > 0 && (
              <div className="mt-4 rounded-soft border border-amber/40 bg-amber/10 px-3 py-2">
                <div className="text-[11px] font-semibold text-amber">
                  The database has moved since this design was drawn
                </div>
                <ul className="mt-1 space-y-0.5 text-[11px] leading-relaxed text-ink-dim">
                  {drift.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-4 min-h-0 flex-1 overflow-auto">
              <div className="mb-4">
                {label('Up SQL')}
                <SqlEditor value={upSql} onChange={() => {}} dialect={dialect} editable={false} maxHeight="200px" />
              </div>

              <div>
                {label('Down SQL')}
                {/* Reversibility is all-or-nothing on the recorded migration: one
                    statement without an inverse is what makes the whole release
                    unrollbackable, so say it here, where it can still be cancelled. */}
                {reversible === 0 ? (
                  <div className="rounded-soft border border-edge bg-bg px-3 py-2 text-[11px] text-ink-faint">
                    Not reversible — nothing staged here can be undone automatically, so the recorded migration will
                    have no down SQL.
                  </div>
                ) : (
                  <>
                    {reversible < statements.length && (
                      <div className="mb-1.5 text-[11px] text-amber">
                        Partial — {statements.length - reversible} statement
                        {statements.length - reversible === 1 ? ' has' : 's have'} no automatic down SQL, so the
                        recorded migration will not be rollback-able.
                      </div>
                    )}
                    <SqlEditor value={downSql} onChange={() => {}} dialect={dialect} editable={false} maxHeight="200px" />
                  </>
                )}
              </div>
            </div>
          </>
        )}

        <div className="mt-5 flex shrink-0 justify-end gap-2">
          <Button variant="subtle" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          {/* One button through both steps, disabled until the read it depends
              on has landed — the step it is waiting on is named on it, so a
              disabled Release is never a mystery. A failed read swaps it for
              the only move that helps: read again. */}
          {phase.step === 'failed' ? (
            <Button variant="primary" size="sm" onClick={onRetry}>
              Try again
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={onConfirm}
              disabled={phase.step !== 'review'}
              title={phase.step === 'review' ? undefined : 'Waiting for the schema to be read'}
            >
              {phase.step === 'review' ? 'Release' : 'Reading schema…'}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

/** One numbered step of the two — done, the one in hand, or still to come. */
function WizardStep({ n, label, state }: { n: number; label: string; state: 'done' | 'active' | 'todo' }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className={`flex h-[18px] w-[18px] items-center justify-center rounded-full text-[10px] font-bold ${
          state === 'todo' ? 'border border-edge-strong text-ink-faint' : 'bg-green text-white'
        }`}
      >
        {state === 'done' ? '✓' : n}
      </span>
      <span className={state === 'todo' ? 'text-ink-faint' : 'text-ink'}>{label}</span>
    </span>
  )
}
