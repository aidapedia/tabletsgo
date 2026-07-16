import { useSlideOver } from '@/shared/hooks/useSlideOver'
import Button from '@/shared/ui/buttons/Button'
import SlideOverPanel from '@/shared/ui/overlay/SlideOverPanel'
import { CodeIcon, CopyIcon, EditIcon, PlusSmall, TableIcon, TrashIcon } from '@/shared/ui/icons'
import { relativeTime } from '@/shared/lib/recents'

const KIND = {
  insert: { Icon: PlusSmall, tone: 'text-green-bright' },
  update: { Icon: EditIcon, tone: 'text-amber' },
  delete: { Icon: TrashIcon, tone: 'text-red' },
  duplicate: { Icon: CopyIcon, tone: 'text-green-bright' },
  create: { Icon: TableIcon, tone: 'text-green-bright' },
  query: { Icon: CodeIcon, tone: 'text-ink-dim' },
}

export default function ChangesPanel({ changes = [], committing = false, onCommit, onClear, onClose }) {
  const { show, close } = useSlideOver(onClose)

  return (
    <SlideOverPanel
      show={show}
      close={close}
      width={420}
      bodyClassName="px-3 py-3"
      footerClassName="justify-between"
      title={
        <span className="flex items-center gap-2">
          Changes
          <span className="rounded-[20px] bg-elevated px-2 py-0.5 text-[10px] font-semibold text-ink-dim">
            {changes.length}
          </span>
        </span>
      }
      footer={
        changes.length > 0 && (
          <>
            <Button variant="subtle" size="sm" onClick={() => onClear?.()} disabled={committing}>
              Clear all
            </Button>
            <Button variant="primary" size="sm" onClick={() => onCommit?.()} disabled={committing}>
              {committing ? 'Committing…' : `Commit ${changes.length} change${changes.length > 1 ? 's' : ''}`}
            </Button>
          </>
        )
      }
    >
      {changes.length === 0 ? (
            <div className="px-2 py-10 text-center text-[12px] text-ink-faint">
              No changes yet. Inserts, updates and deletes will appear here.
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {changes.map((c) => {
                const { Icon, tone } = KIND[c.kind] || KIND.query
                return (
                  <div
                    key={c.id}
                    className="flex items-start gap-3 rounded-soft border border-edge bg-card px-3 py-2.5"
                  >
                    <span className={`mt-0.5 shrink-0 ${tone}`}>
                      <Icon width={15} height={15} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[12px] font-semibold text-ink">{c.label}</span>
                        {c.table && (
                          <span className="shrink-0 rounded bg-elevated px-1.5 py-0.5 text-[10px] text-ink-dim">
                            {c.table}
                          </span>
                        )}
                      </div>
                      {(c.sql || c.detail) && (
                        <div className="mt-1 truncate font-mono text-[10px] text-ink-faint" title={c.sql || c.detail}>
                          {c.sql || c.detail}
                        </div>
                      )}
                      <div className="mt-1 text-[10px] text-ink-faint">{relativeTime(c.ts)}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
    </SlideOverPanel>
  )
}
