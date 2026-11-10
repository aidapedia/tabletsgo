import { useState } from 'react'
import CheckboxRow from '@/shared/ui/form/CheckboxRow'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { Dialog, DialogContent, DialogTitle } from '@/shared/ui/dialog'

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
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent showCloseButton={false} aria-describedby={undefined} className="block sm:max-w-[440px] p-5 gap-0">
        <DialogTitle className="text-sm font-bold text-foreground">Unlink “{draftName}” from {connectionName}?</DialogTitle>
        <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
          The design becomes a <Badge variant="faint" size="dense">from scratch</Badge> draft of the workspace: it keeps its
          statements, notes and arrangement, but stops drawing {connectionName}'s tables and can no longer be released
          — link it to a connection again for that. Nothing runs, and the database keeps everything it has.
        </p>

        {liveTables === null ? (
          <p className="mt-4 text-[11px] text-faint">Reading the connection's tables…</p>
        ) : count > 0 ? (
          <CheckboxRow
            className="mt-4"
            checked={keepTables}
            onChange={setKeepTables}
            disabled={unlinking}
            ariaLabel="Keep the connection's tables in the design"
          >
            <span className="text-[12px] leading-relaxed text-foreground">
              Keep the {count} table{count === 1 ? '' : 's'} it draws
              <span className="block text-[11px] text-faint">
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
          <p className="mt-4 text-[11px] leading-relaxed text-faint">
            {connectionName} reports no tables, so the design carries only what is staged on it.
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="default"
            size="sm"
            disabled={liveTables === null || unlinking}
            onClick={() => onConfirm(keepTables)}
          >
            {unlinking ? 'Unlinking…' : 'Unlink'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
