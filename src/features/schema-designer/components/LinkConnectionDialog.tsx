import { useState } from 'react'
import Button from '@/shared/ui/buttons/Button'
import Select from '@/shared/ui/form/Select'
import Badge from '@/shared/ui/Badge'
import { controlClass } from '@/shared/ui/form/Input'

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
    <div
      className="fixed inset-0 z-[60] flex animate-fade items-center justify-center bg-black/60 p-6 backdrop-blur-[3px]"
      onMouseDown={onCancel}
    >
      <div
        className="w-full max-w-[440px] animate-pop rounded-[16px] border border-edge-strong bg-panel p-5"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-bold text-ink">Link “{draftName}” to a connection</h3>

        {candidates.length === 0 ? (
          <p className="mt-2 text-[12px] leading-relaxed text-ink-dim">
            No <Badge tone="faint" dense>{dialect}</Badge> connection in this workspace. The design was written for that
            engine, so it needs one before it can reach a database — add the connection first, then link this design to
            it.
          </p>
        ) : (
          <>
            <p className="mt-2 text-[12px] leading-relaxed text-ink-dim">
              The design moves onto the connection: it becomes that database's schema draft, the canvas draws its live
              tables under the staged ones, and Release runs against it. Nothing is executed now, and the design keeps
              its statements, notes and arrangement — only its address changes.
            </p>

            <div className="mt-4 flex items-center gap-2">
              <span className="w-[70px] shrink-0 text-[11px] font-semibold text-ink-faint">Database</span>
              <Select
                className={`${controlClass} !w-auto min-w-0 flex-1`}
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
          <Button variant="subtle" size="sm" onClick={onCancel}>
            {candidates.length === 0 ? 'Close' : 'Cancel'}
          </Button>
          {candidates.length > 0 && (
            <Button variant="primary" size="sm" disabled={!target || linking} onClick={() => target && onConfirm(target)}>
              {linking ? 'Linking…' : 'Link'}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
