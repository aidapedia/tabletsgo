import Button from '@/shared/ui/buttons/Button'
import SlideOverPanel from '@/shared/ui/overlay/SlideOverPanel'
import TextButton from '@/shared/ui/buttons/TextButton'
import SqlEditor from '@/shared/ui/SqlEditor'
import { useSlideOver } from '@/shared/hooks/useSlideOver'
import { useToast } from '@/shared/ui/feedback/Toast'
import { CopyIcon } from '@/shared/ui/icons'

export const fmtTime = (ts) => {
  if (!ts) return '—'
  const d = new Date(ts)
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

// A migration is a valid rollback target when it's still active and every
// active version newer than it is reversible (the server undoes them all in one
// go; the newest active version has nothing above it, so it can't be a target).
export const canRollbackTo = (migrations, m) => {
  if ((m.status || 'active') !== 'active') return false
  const active = (migrations || []).filter((x) => (x.status || 'active') === 'active')
  const newer = active.filter((a) => a.version > m.version)
  return newer.length > 0 && newer.every((a) => a.reversible)
}

// Shared disabled-state explanation for the Rollback action (row button, context
// menu item, sidebar kebab).
export const rollbackTitle = (row) => {
  if (row.__isBaseline) {
    return row.__canRollback
      ? 'Roll the schema all the way back to its initial state (undo every migration).'
      : 'Not every migration is reversible — can’t roll back to the initial state.'
  }
  const isRolledBack = (row.__migration.status || 'active') === 'rollbacked'
  return isRolledBack
    ? 'Already rolled back.'
    : !row.__canRollback
      ? 'Current version — nothing newer to roll back.'
      : 'Roll the schema back to this version.'
}

// Read-only detail view for a single migration — opened from the schema-history
// row context menu, or the Schema Versions sidebar kebab. Shows the forward (Up)
// and rollback (Down) SQL and offers the same Rollback action, gated the same way.
//
// The same view doubles as a draft inspector (`variant="draft"`, `name` = draft
// name): it shows the draft's Up SQL and best-effort Down SQL, but drops the
// executor/committed meta and the Rollback action (a draft isn't committed yet).
export default function MigrationInspector({ migration, dialect, canRollback = false, onClose, onRollback = (_m: any) => {}, variant = 'release', name = '' }) {
  const { show, close } = useSlideOver(onClose)
  const toast = useToast()
  const isDraft = variant === 'draft'
  const isRolledBack = (migration.status || 'active') === 'rollbacked'

  const copySql = async (sql, label) => {
    try {
      await navigator.clipboard.writeText(sql)
      toast.success(label)
    } catch {
      toast.error('Could not copy to clipboard')
    }
  }

  const sqlHeader = (label, sql) => (
    <div className="mb-1.5 flex items-center justify-between">
      <span className="text-[11px] font-semibold tracking-wide text-ink-faint">{label}</span>
      <TextButton tone="faint" className="!text-[11px] hover:!text-ink" onClick={() => copySql(sql, `Copied ${label.toLowerCase()}`)}>
        <CopyIcon width={13} height={13} /> Copy
      </TextButton>
    </div>
  )

  return (
    <SlideOverPanel
      show={show}
      close={close}
      width={560}
      title={
        <span className="flex items-center gap-2 truncate">
          {isDraft ? <span className="truncate">{name}</span> : <>Migration v{migration.version}</>}
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide ${
              isDraft
                ? 'bg-amber/15 text-amber'
                : isRolledBack
                  ? 'bg-ink-faint/15 text-ink-faint'
                  : 'bg-green/15 text-green-bright'
            }`}
          >
            {isDraft ? 'draft' : isRolledBack ? 'rolled back' : 'active'}
          </span>
        </span>
      }
      footer={
        <>
          <Button variant="subtle" onClick={() => close()}>
            Close
          </Button>
          {!isDraft && (
            <Button
              variant="primary"
              disabled={!canRollback}
              title={rollbackTitle({ __isBaseline: false, __canRollback: canRollback, __migration: migration })}
              onClick={() => close(() => onRollback(migration))}
            >
              Rollback to this version
            </Button>
          )}
        </>
      }
    >
      {!isDraft && (
            <div className="mb-5 grid grid-cols-2 gap-4">
              <div>
                <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-ink-faint">Executor</div>
                <div className="text-sm text-ink">{migration.executorName || '—'}</div>
              </div>
              <div>
                <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-ink-faint">Committed at</div>
                <div className="text-sm text-ink">{fmtTime(migration.ts)}</div>
              </div>
            </div>
          )}

          <div className="mb-5">
            {sqlHeader('Up SQL', migration.forwardSql.join('\n'))}
            <SqlEditor value={migration.forwardSql.join('\n')} onChange={() => {}} dialect={dialect} editable={false} maxHeight="240px" />
          </div>

          <div>
            {/* Drafts always show best-effort down SQL (with inline notes for
                statements that can't be reversed); committed migrations only
                show it when fully reversible. */}
            {migration.reversible || isDraft ? (
              <>
                {sqlHeader('Down SQL', migration.rollbackSql.filter(Boolean).join('\n'))}
                {!migration.reversible && (
                  <div className="mb-1.5 text-[11px] text-amber">
                    Partial — some statements have no automatic down SQL (see notes below).
                  </div>
                )}
                <SqlEditor
                  value={migration.rollbackSql.filter(Boolean).join('\n')}
                  onChange={() => {}}
                  dialect={dialect}
                  editable={false}
                  maxHeight="240px"
                />
              </>
            ) : (
              <>
                <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-ink-faint">Down SQL</div>
                <div className="rounded-soft border border-edge bg-bg px-3 py-2 text-[11px] text-ink-faint">
                  {isDraft
                    ? 'Not reversible — this draft has statements with no automatic down SQL.'
                    : 'Not reversible — no down SQL was recorded for this commit.'}
                </div>
              </>
            )}
          </div>
    </SlideOverPanel>
  )
}
