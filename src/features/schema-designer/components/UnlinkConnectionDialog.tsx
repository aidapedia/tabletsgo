import { useState } from 'react'
import Button from '@/shared/ui/buttons/Button'
import Badge from '@/shared/ui/Badge'
import CheckboxRow from '@/shared/ui/form/CheckboxRow'

/**
 * Cut a schema draft loose from its database.
 *
 * The reverse of LinkConnectionDialog, and not symmetrical with it: a linked
 * draft is drawn from two sources — the connection's *live* tables underneath,
 * and its own staged DDL on top — and only the second half belongs to the draft.
 * Unlink it as-is and the live half simply stops being drawn, which is why this
 * offers to write those tables into the design first, as the CREATE TABLE
 * statements that would rebuild them. That is what keeps the diagram the
 * diagram, and it is the default.
 *
 * Nothing is executed and the database is not touched — this moves a row. The
 * connection keeps its tables and its schema history either way.
 */
export default function UnlinkConnectionDialog({
  draftName,
  connectionName,
  liveTables,
  unlinking = false,
  onCancel,
  onConfirm,
}: {
  draftName: string
  connectionName: string
  /** The connection's live tables, or null while they are still being read. */
  liveTables: { name: string }[] | null
  unlinking?: boolean
  onCancel: () => void
  onConfirm: (keepTables: boolean) => void
}) {
  const [keepTables, setKeepTables] = useState(true)
  const count = liveTables?.length ?? 0

  return (
    <div
      className="fixed inset-0 z-[60] flex animate-fade items-center justify-center bg-black/60 p-6 backdrop-blur-[3px]"
      onMouseDown={onCancel}
    >
      <div
        className="w-full max-w-[440px] animate-pop rounded-[16px] border border-edge-strong bg-panel p-5"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-bold text-ink">Unlink “{draftName}” from {connectionName}?</h3>
        <p className="mt-2 text-[12px] leading-relaxed text-ink-dim">
          The design becomes a <Badge tone="faint" dense>from scratch</Badge> draft of the workspace: it keeps its
          statements, notes and arrangement, but stops drawing {connectionName}'s tables and can no longer be released
          — link it to a connection again for that. Nothing runs, and the database keeps everything it has.
        </p>

        {liveTables === null ? (
          <p className="mt-4 text-[11px] text-ink-faint">Reading the connection's tables…</p>
        ) : count > 0 ? (
          <CheckboxRow
            className="mt-4"
            checked={keepTables}
            onChange={setKeepTables}
            disabled={unlinking}
            ariaLabel="Keep the connection's tables in the design"
          >
            <span className="text-[12px] leading-relaxed text-ink">
              Keep the {count} table{count === 1 ? '' : 's'} it draws
              <span className="block text-[11px] text-ink-faint">
                Written into the design as CREATE TABLE statements, so the diagram survives the move. Without this the
                canvas keeps only what is staged.
              </span>
            </span>
          </CheckboxRow>
        ) : (
          // Either the database really has no tables, or reading them failed
          // (getDiagram degrades to an empty list rather than throwing). Say so
          // instead of leaving it out: it is the difference between a move that
          // keeps the diagram and one that doesn't.
          <p className="mt-4 text-[11px] leading-relaxed text-ink-faint">
            {connectionName} reports no tables, so the design carries only what is staged on it.
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="subtle" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={liveTables === null || unlinking}
            onClick={() => onConfirm(keepTables)}
          >
            {unlinking ? 'Unlinking…' : 'Unlink'}
          </Button>
        </div>
      </div>
    </div>
  )
}
