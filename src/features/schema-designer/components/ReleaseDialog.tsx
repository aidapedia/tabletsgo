import Button from '@/shared/ui/buttons/Button'
import Badge from '@/shared/ui/Badge'
import SqlEditor from '@/shared/ui/SqlEditor'

/** The database a design releases to — as little of a connection as this needs. */
export type ReleaseTarget = { id: string; name: string; type: string }

/** One staged statement and the statement that would undo it, if there is one. */
export type ReleaseStatement = { sql: string; rollbackSql?: string | null }

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
 * There is no picker: a design releases to the connection it was designed
 * against, and nowhere else. A from-scratch design is linked to a connection
 * first (LinkConnectionDialog) — which is the same choice, made once, where the
 * diagram then redraws against that database instead of guessing at one from a
 * dropdown seconds before the DDL runs.
 */
export default function ReleaseDialog({
  statements,
  target,
  dialect,
  onCancel,
  onConfirm,
}: {
  statements: ReleaseStatement[]
  target: ReleaseTarget
  dialect?: string
  onCancel: () => void
  onConfirm: () => void
}) {
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
      onMouseDown={onCancel}
    >
      <div
        className="flex max-h-full w-full max-w-[560px] animate-pop flex-col rounded-[16px] border border-edge-strong bg-panel p-5"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-bold text-ink">Release this schema?</h3>
        <p className="mt-2 text-[12px] leading-relaxed text-ink-dim">
          {statements.length} statement{statements.length === 1 ? '' : 's'} will run against the database, in this order.
          They execute for real — a statement that drops or rewrites something takes its data with it.
        </p>

        <div className="mt-4 flex items-center gap-2">
          <span className="w-[70px] shrink-0 text-[11px] font-semibold text-ink-faint">Database</span>
          <span className="flex min-w-0 items-center gap-2 text-[12px] text-ink">
            <span className="truncate font-semibold">{target.name}</span>
            <Badge tone="faint" dense>
              {target.type}
            </Badge>
          </span>
        </div>

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
                Not reversible — nothing staged here can be undone automatically, so the recorded migration will have no
                down SQL.
              </div>
            ) : (
              <>
                {reversible < statements.length && (
                  <div className="mb-1.5 text-[11px] text-amber">
                    Partial — {statements.length - reversible} statement
                    {statements.length - reversible === 1 ? ' has' : 's have'} no automatic down SQL, so the recorded
                    migration will not be rollback-able.
                  </div>
                )}
                <SqlEditor value={downSql} onChange={() => {}} dialect={dialect} editable={false} maxHeight="200px" />
              </>
            )}
          </div>
        </div>

        <div className="mt-5 flex shrink-0 justify-end gap-2">
          <Button variant="subtle" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={onConfirm}>
            Release
          </Button>
        </div>
      </div>
    </div>
  )
}
