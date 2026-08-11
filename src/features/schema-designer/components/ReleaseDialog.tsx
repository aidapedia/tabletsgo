import Button from '@/shared/ui/buttons/Button'
import Badge from '@/shared/ui/Badge'

/** The database a design releases to — as little of a connection as this needs. */
export type ReleaseTarget = { id: string; name: string; type: string }

/**
 * The confirmation in front of Release: running a design's staged DDL against a
 * live database.
 *
 * It asks rather than just running because this is the one action in the editor
 * that leaves the diagram and changes a real database — and unlike the console's
 * Changes queue there is no second look at the statements before they execute.
 * So they are all shown here, in the order they will run.
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
  onCancel,
  onConfirm,
}: {
  statements: string[]
  target: ReleaseTarget
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex animate-fade items-center justify-center bg-black/60 p-6 backdrop-blur-[3px]"
      onMouseDown={onCancel}
    >
      <div
        className="flex max-h-full w-full max-w-[520px] animate-pop flex-col rounded-[16px] border border-edge-strong bg-panel p-5"
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

        <div className="mt-3 min-h-0 flex-1 overflow-auto rounded-soft border border-edge bg-elevated p-2.5">
          <ol className="flex flex-col gap-1.5">
            {statements.map((sql, i) => (
              <li key={i} className="flex gap-2 font-mono text-[11px] leading-relaxed text-ink-dim">
                <span className="shrink-0 text-ink-faint">{i + 1}.</span>
                <span className="min-w-0 break-words">{sql}</span>
              </li>
            ))}
          </ol>
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
