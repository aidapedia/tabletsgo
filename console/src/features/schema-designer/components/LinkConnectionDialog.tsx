import { useState } from 'react'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import OptionSelect from '@/shared/ui/form/OptionSelect'
import { Dialog, DialogContent, DialogTitle } from '@/shared/ui/dialog'

/** A connection a from-scratch design can be linked to. */
export type LinkCandidate = { id: string; name: string; type: string }

/**
 * Give a from-scratch design a database.
 *
 * A design drawn from scratch belongs to the workspace and has no database
 * behind it, so there is nothing for its DDL to run against — Release stays
 * disabled until this has happened. Linking moves the design onto a connection:
 * it becomes that connection's schema draft, the canvas starts drawing that
 * database's live tables underneath the staged ones, and Release then has one
 * unambiguous target.
 *
 * Only connections of the same engine are offered. The DDL was generated for
 * the dialect the design was started with, so another engine is a different
 * language, not a different address.
 */
export default function LinkConnectionDialog({
  draftName,
  dialect,
  candidates,
  linking = false,
  onCancel,
  onConfirm,
}: {
  draftName: string
  dialect: string
  candidates: LinkCandidate[]
  linking?: boolean
  onCancel: () => void
  onConfirm: (connection: LinkCandidate) => void
}) {
  const [connectionId, setConnectionId] = useState(candidates[0]?.id || '')
  const target = candidates.find((c) => c.id === connectionId) || null

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent showCloseButton={false} aria-describedby={undefined} className="block sm:max-w-[440px] p-5 gap-0">
        <DialogTitle className="text-sm font-bold text-foreground">Link “{draftName}” to a connection</DialogTitle>

        {candidates.length === 0 ? (
          <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
            No <Badge variant="faint" size="dense">{dialect}</Badge> connection in this workspace. The design was written for that
            engine, so it needs one before it can reach a database — add the connection first, then link this design to
            it.
          </p>
        ) : (
          <>
            <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
              The design moves onto the connection: it becomes that database's schema draft, the canvas draws its live
              tables under the staged ones, and Release runs against it. Nothing is executed now, and the design keeps
              its statements, notes and arrangement — only its address changes.
            </p>

            <div className="mt-4 flex items-center gap-2">
              <span className="w-[70px] shrink-0 text-[11px] font-semibold text-faint">Database</span>
              <OptionSelect
                className="!w-auto min-w-0 flex-1"
                value={connectionId}
                onChange={setConnectionId}
                options={candidates.map((c) => ({ value: c.id, label: c.name, hint: c.type }))}
                placeholder="Pick a database…"
                searchable={candidates.length > 8}
                disabled={linking}
              />
            </div>
          </>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {candidates.length === 0 ? 'Close' : 'Cancel'}
          </Button>
          {candidates.length > 0 && (
            <Button variant="default" size="sm" disabled={!target || linking} onClick={() => target && onConfirm(target)}>
              {linking ? 'Linking…' : 'Link'}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
