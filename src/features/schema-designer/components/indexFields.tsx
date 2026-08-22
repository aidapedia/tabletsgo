import { useEffect, useMemo, useState } from 'react'
import TextButton from '@/shared/ui/buttons/TextButton'
import Checkbox from '@/shared/ui/form/Checkbox'
import Select from '@/shared/ui/form/Select'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import Tooltip from '@/shared/ui/overlay/Tooltip'
import { PlusIcon, TrashIcon } from '@/shared/ui/icons'
import { controlClass, Input } from '@/shared/ui/form/Input'
import {
  INDEX_METHODS,
  autoIndexName,
  canEditIndex,
  indexCreateSql,
  indexDropSql,
  indexSignature,
  liveToIndex,
  lockedReason,
  newIndex,
} from '@/features/schema-designer/lib/indexes'
import type { IndexModel, LiveIndex } from '@/features/schema-designer/lib/indexes'

/**
 * The indexes half of the create/edit table forms — the same pair everywhere,
 * so both panels expose exactly the same fields:
 *
 *   const indexes = useIndexEditor({ table, dialect, live })   // state + DDL
 *   <IndexEditor editor={indexes} columns={…} />               // the cards
 *
 * The hook owns the state and hands back `statements`, because the panel needs
 * those *outside* the Indexes view too: they go into the SQL view's text, and
 * they are what makes Save do something.
 *
 * It reads nothing itself. `live` is the table's current indexes as its host
 * already knows them — from the design's synced schema in the diagram, or from
 * the read the console panel already makes for its columns — because a panel
 * opening is not a reason to go to the database (the same rule the canvas
 * follows: re-reading is Sync, an action someone takes).
 *
 * No engine can ALTER an index, so editing one stages a DROP followed by a
 * CREATE — the same shape as the FK editor rewriting a constraint.
 */
export function useIndexEditor({
  table,
  dialect,
  live,
  initial = null,
}: {
  table: string
  dialect: string
  /** The table's current indexes. `null`/`undefined` means "not known here" — never "none". */
  live?: LiveIndex[] | null
  /** Indexes to start from — a staged CREATE INDEX being reopened, never a live one. */
  initial?: IndexModel[] | null
}) {
  // A live index plus the model editing it, and the signature it arrived with
  // (so an untouched index stages nothing).
  const [existing, setExisting] = useState<{ row: LiveIndex; model: IndexModel; base: string; drop: boolean }[]>([])
  const [added, setAdded] = useState<IndexModel[]>(() => initial || [])

  // Seed from the rows the host resolved. Keyed on their identity, so this
  // fires when they arrive (or when a Sync replaces them) and not on every
  // render — re-seeding throws away edits in progress.
  useEffect(() => {
    setExisting(
      (live || []).map((row) => {
        const model = liveToIndex(row)
        return { row, model, base: indexSignature(table, model, dialect), drop: false }
      })
    )
  }, [live, table, dialect])

  const setEx = (i: number, patch: Partial<IndexModel>) =>
    setExisting((xs) => xs.map((x, idx) => (idx === i ? { ...x, model: { ...x.model, ...patch } } : x)))
  const toggleDrop = (i: number) => setExisting((xs) => xs.map((x, idx) => (idx === i ? { ...x, drop: !x.drop } : x)))
  const setAd = (id: string, patch: Partial<IndexModel>) =>
    setAdded((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  const addIndex = () => setAdded((xs) => [...xs, newIndex()])
  const removeAdded = (id: string) => setAdded((xs) => xs.filter((x) => x.id !== id))

  const statements = useMemo(() => {
    const out: string[] = []
    for (const x of existing) {
      if (!canEditIndex(x.row)) continue
      if (x.drop) {
        out.push(indexDropSql(x.row.name))
        continue
      }
      if (indexSignature(table, x.model, dialect) === x.base) continue
      // An edit is a rewrite, and a rewrite with no columns left isn't one —
      // dropping the index alone is never what "I emptied this field" means.
      const create = indexCreateSql(table, x.model, dialect)
      if (!create) continue
      out.push(indexDropSql(x.row.name), create)
    }
    for (const idx of added) {
      const create = indexCreateSql(table, idx, dialect)
      if (create) out.push(create)
    }
    return out
  }, [existing, added, table, dialect])

  // How many indexes the table would end up with — what the view's tab counts.
  const count =
    existing.filter((x) => !x.drop).length + added.filter((x) => x.columns.filter(Boolean).length > 0).length

  return {
    existing,
    added,
    statements,
    count,
    /** False when the host couldn't say what the table already has — a design synced before indexes were read. */
    known: Array.isArray(live),
    setEx,
    toggleDrop,
    setAd,
    addIndex,
    removeAdded,
  }
}

/** What `useIndexEditor` hands back — the state the view below renders. */
export type IndexEditorState = ReturnType<typeof useIndexEditor>

/** One index card: name + unique on one line, the columns on the next, the engine options on the last. */
function IndexCard({
  idx,
  table,
  dialect,
  columns,
  dropped = false,
  onChange,
  onRemove,
  removeLabel = 'Remove index',
}: {
  idx: IndexModel
  table: string
  dialect: string
  columns: string[]
  dropped?: boolean
  onChange: (patch: Partial<IndexModel>) => void
  onRemove: () => void
  removeLabel?: string
}) {
  const picked = idx.columns.filter(Boolean)
  const remaining = columns.filter((c) => !picked.includes(c))
  const isPg = dialect === 'postgresql'

  return (
    <div className={`rounded-soft border p-2.5 ${dropped ? 'border-red/40 bg-red/5' : 'border-edge bg-elevated/40'}`}>
      <div className="flex items-center gap-2">
        <Input
          className="!w-auto min-w-0 flex-1"
          placeholder={picked.length ? autoIndexName(table, idx) : 'index_name'}
          value={idx.name}
          disabled={dropped}
          onChange={(e) => onChange({ name: e.target.value })}
        />
        <div className={`flex shrink-0 items-center gap-1.5 text-[11px] ${dropped ? 'text-ink-faint' : 'text-ink-dim'}`}>
          <Checkbox checked={idx.unique} disabled={dropped} onChange={(v) => onChange({ unique: v })} ariaLabel="Unique" />
          Unique
        </div>
        <Tooltip label={removeLabel} placement="top">
          <TextButton
            className="h-[26px] w-[26px] shrink-0 justify-center rounded-[7px] hover:!text-red"
            onClick={onRemove}
            aria-label={removeLabel}
          >
            <TrashIcon width={14} height={14} />
          </TextButton>
        </Tooltip>
      </div>

      {dropped ? (
        <div className="mt-2 px-0.5 text-[11px] font-semibold text-red">Will be dropped on save.</div>
      ) : (
        <>
          {/* Columns, in the order they were picked — a composite index is only
              useful to a query that leads with its first column. */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5 px-0.5">
            {picked.map((c, i) => (
              <span
                key={c}
                className="inline-flex items-center gap-1 rounded border border-edge bg-elevated px-1.5 py-0.5 font-mono text-[10px] text-ink-dim"
              >
                {/* Position only matters once there is more than one column. */}
                {picked.length > 1 && <span className="text-ink-faint">{i + 1}.</span>}
                {c}
                <button
                  type="button"
                  className="text-ink-faint transition-colors hover:text-red"
                  aria-label={`Remove ${c}`}
                  onClick={() => onChange({ columns: picked.filter((x) => x !== c) })}
                >
                  ×
                </button>
              </span>
            ))}
            {remaining.length > 0 && (
              <Select
                className={`${controlClass} !w-[132px] shrink-0`}
                value=""
                onChange={(v) => onChange({ columns: [...picked, v] })}
                placeholder={picked.length ? '+ column' : 'pick a column'}
                options={remaining.map((c) => ({ value: c, label: c }))}
              />
            )}
          </div>

          <div className="mt-2 flex items-center gap-2 px-0.5">
            {isPg && (
              <Select
                className={`${controlClass} !w-[128px] shrink-0`}
                value={idx.method}
                onChange={(v) => onChange({ method: v })}
                options={INDEX_METHODS}
              />
            )}
            <Input
              className="!w-auto min-w-0 flex-1"
              placeholder="partial index — where…"
              value={idx.where}
              onChange={(e) => onChange({ where: e.target.value })}
              aria-label="Partial index condition"
            />
          </div>

          {picked.length === 0 && (
            <p className="mt-2 px-0.5 text-[11px] text-amber">Pick at least one column — nothing is staged until you do.</p>
          )}
        </>
      )}
    </div>
  )
}

/** A live index this editor won't rewrite: a constraint's own, or one whose predicate couldn't be read. */
function LockedIndexRow({ row }: { row: LiveIndex }) {
  return (
    <div className="flex items-center gap-2 rounded-soft border border-edge bg-elevated/30 px-3 py-2 text-[11px]">
      <span className="min-w-0 flex-1 truncate font-medium text-ink-dim">{row.name}</span>
      <span className="shrink-0 truncate font-mono text-ink-faint">{row.columns || '—'}</span>
      {row.unique && <span className="shrink-0 rounded bg-green/15 px-1 text-[9px] font-bold text-green-bright">UNIQUE</span>}
      <span className="shrink-0 rounded bg-edge px-1.5 py-0.5 text-[9px] text-ink-faint">{lockedReason(row)}</span>
    </div>
  )
}

/**
 * The Indexes view of a table form. `columns` are the names an index may be
 * built on — the live ones when editing, the ones being typed when creating.
 * `loading` is the host's read of those indexes still being in flight.
 */
export default function IndexEditor({
  editor,
  table,
  dialect,
  columns,
  loading = false,
}: {
  editor: IndexEditorState
  table: string
  dialect: string
  columns: string[]
  loading?: boolean
}) {
  const { existing, added, known, setEx, toggleDrop, setAd, addIndex, removeAdded } = editor

  if (loading) return <LoadingState />

  return (
    <>
      {existing.length > 0 && (
        <>
          <div className="flex flex-col gap-3">
            {existing.map((x, i) =>
              canEditIndex(x.row) ? (
                <IndexCard
                  key={x.row.name}
                  idx={x.model}
                  table={table}
                  dialect={dialect}
                  columns={columns}
                  dropped={x.drop}
                  removeLabel={x.drop ? 'Keep index' : 'Drop index'}
                  onChange={(patch) => setEx(i, patch)}
                  onRemove={() => toggleDrop(i)}
                />
              ) : (
                <LockedIndexRow key={x.row.name} row={x.row} />
              )
            )}
          </div>
          {added.length > 0 && <div className="mt-4 text-[11px] font-semibold text-ink-dim">New indexes</div>}
        </>
      )}

      <div className={`flex flex-col gap-3 ${existing.length > 0 ? 'mt-2' : ''}`}>
        {added.map((idx) => (
          <IndexCard
            key={idx.id}
            idx={idx}
            table={table}
            dialect={dialect}
            columns={columns}
            onChange={(patch) => setAd(idx.id, patch)}
            onRemove={() => removeAdded(idx.id)}
          />
        ))}
      </div>

      {/* "None" and "not known" are different answers, and only one of them is
          about this table: a design synced before indexes were read has no list
          to show, and saying "no indexes" there would be a claim about the
          database that nobody checked. */}
      {!known ? (
        <p className="text-[11px] text-amber">
          This design's schema was read before indexes were. <span className="text-ink-dim">Sync schema</span> to list
          what this table already has — a new index can still be added here meanwhile.
        </p>
      ) : (
        existing.length === 0 &&
        added.length === 0 && (
          <p className="text-[11px] text-ink-faint">
            No indexes on this table yet. An index speeds up lookups on the columns it covers, at the cost of slower
            writes.
          </p>
        )
      )}

      <TextButton tone="green" className="mt-3 !text-[11px] font-semibold" onClick={addIndex}>
        <PlusIcon width={14} height={14} /> Add index
      </TextButton>

      <p className="mt-3 text-[11px] text-ink-faint">
        Leave the name blank and one is generated from the table and columns. No engine can alter an index, so changing
        one here stages a <span className="text-ink-dim">DROP</span> and a fresh{' '}
        <span className="text-ink-dim">CREATE INDEX</span>.
      </p>
    </>
  )
}
