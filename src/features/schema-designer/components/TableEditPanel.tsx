import { useRef, useState } from 'react'
import Button from '@/shared/ui/buttons/Button'
import TextButton from '@/shared/ui/buttons/TextButton'
import Checkbox from '@/shared/ui/form/Checkbox'
import Select from '@/shared/ui/form/Select'
import Tooltip from '@/shared/ui/overlay/Tooltip'
import SlideOverPanel from '@/shared/ui/overlay/SlideOverPanel'
import { useSlideOver } from '@/shared/hooks/useSlideOver'
import { PlusIcon, TrashIcon } from '@/shared/ui/icons'
import { controlClass, Input } from '@/shared/ui/form/Input'
import { Label } from '@/shared/ui/form/Form'
import { ColumnField, FK_ACTIONS, colDef, newColumn, normFkAction as normAction } from '@/features/schema-designer/components/columnFields'
import DragHandle from '@/shared/ui/DragHandle'
import { useDragReorder } from '@/shared/hooks/useDragReorder'
import { moveColumn } from '@/features/schema-designer/lib/design'

export default function TableEditPanel({ table, dialect, types, tableNames = [], schema = {}, foreignKeys = [], onStage, onReorderColumns, onClose }) {
  const isPg = dialect === 'postgresql'
  const { show, close } = useSlideOver(onClose)

  // Foreign keys arrive separately from the diagram (keyed by column) so we can
  // surface each existing column's reference target read-only.
  const fkByColumn = Object.fromEntries(foreignKeys.map((fk) => [fk.column, fk]))

  const [existing, setExisting] = useState(() =>
    table.columns.map((c) => {
      const fk = fkByColumn[c.name] || null
      return {
        originalName: c.name,
        name: c.name,
        type: c.type,
        initialType: c.type,
        pk: c.pk,
        notNull: !!c.notnull,
        initialNotNull: !!c.notnull,
        default: c.default == null ? '' : String(c.default),
        initialDefault: c.default == null ? '' : String(c.default),
        // Editable foreign-key state, plus the original for change detection.
        fk, // original FK (for read-only display / constraint name)
        fkEnabled: !!fk,
        fkTable: fk?.refTable || '',
        fkColumn: fk?.refColumn || '',
        fkOnDelete: normAction(fk?.onDelete),
        fkOnUpdate: normAction(fk?.onUpdate),
        initialFk: fk
          ? { table: fk.refTable, column: fk.refColumn, onDelete: normAction(fk.onDelete), onUpdate: normAction(fk.onUpdate) }
          : null,
        drop: false,
      }
    })
  )
  const [added, setAdded] = useState([])

  const setEx = (i, patch) => setExisting((cs) => cs.map((c, idx) => (idx === i ? { ...c, ...patch } : c)))
  const toggleDrop = (i) => setExisting((cs) => cs.map((c, idx) => (idx === i ? { ...c, drop: !c.drop } : c)))
  const setAd = (id, patch) => setAdded((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  const addColumn = () => setAdded((cs) => [...cs, newColumn(types[0])])
  const removeAdded = (id) => setAdded((cs) => cs.filter((c) => c.id !== id))

  // ---- Column order ----
  // This table already exists, and no engine can move a column of one with
  // ALTER (not Postgres, not SQLite) — so reordering here is the order the
  // *diagram draws*, saved with the design like a table's position. That's what
  // `onReorderColumns` writes; it stages no SQL, which is why it can be the only
  // change a save carries.
  const initialOrder = useRef(existing.map((c) => c.originalName).join('\u0000'))
  const orderExisting = (from, to) => setExisting((cs) => moveColumn(cs, from, to))
  const orderAdded = (from, to) => setAdded((cs) => moveColumn(cs, from, to))
  const exDrag = useDragReorder(existing.length, orderExisting)
  const adDrag = useDragReorder(added.length, orderAdded)
  const orderChanged = existing.map((c) => c.originalName).join('\u0000') !== initialOrder.current
  // The names the diagram should draw, in this order. A column being renamed in
  // the same save contributes *both* names: the diagram still shows the old one
  // (a rename isn't drawn until the schema is synced), and the new one has to
  // hold the same place once it is. A name the diagram doesn't know is ignored
  // (see orderColumns), so listing both is free.
  const drawnOrder = () => [
    ...existing.flatMap((c) => {
      const name = c.name.trim()
      return name && name !== c.originalName ? [c.originalName, name] : [c.originalName]
    }),
    // A column being added lands after them, in the order its ADD COLUMNs run.
    ...added.map((c) => c.name.trim()).filter(Boolean),
  ]

  const buildStatements = () => {
    const t = table.name
    const out = []
    for (const c of existing) {
      // A dropped column supersedes any rename/nullability/default edits on it.
      if (c.drop) {
        out.push(`ALTER TABLE "${t}" DROP COLUMN "${c.originalName}";`)
        continue
      }
      const name = c.name.trim() || c.originalName
      if (name !== c.originalName) out.push(`ALTER TABLE "${t}" RENAME COLUMN "${c.originalName}" TO "${name}";`)
      // Type / nullability / default / FK changes are only safely alterable in PostgreSQL.
      if (isPg) {
        if (c.type && c.type !== c.initialType) {
          out.push(`ALTER TABLE "${t}" ALTER COLUMN "${name}" TYPE ${c.type};`)
        }
        if (c.notNull !== c.initialNotNull) {
          out.push(`ALTER TABLE "${t}" ALTER COLUMN "${name}" ${c.notNull ? 'SET NOT NULL' : 'DROP NOT NULL'};`)
        }
        const def = (c.default ?? '').trim()
        if (def !== (c.initialDefault ?? '').trim()) {
          out.push(
            def
              ? `ALTER TABLE "${t}" ALTER COLUMN "${name}" SET DEFAULT ${def};`
              : `ALTER TABLE "${t}" ALTER COLUMN "${name}" DROP DEFAULT;`
          )
        }
        // Foreign key add / modify / drop. Modifying = drop the old constraint,
        // then add a new one (Postgres can't alter a FK's target/actions in place).
        const now = c.fkEnabled && c.fkTable && c.fkColumn ? { table: c.fkTable, column: c.fkColumn, onDelete: c.fkOnDelete, onUpdate: c.fkOnUpdate } : null
        if (JSON.stringify(c.initialFk) !== JSON.stringify(now)) {
          if (c.fk?.constraint) out.push(`ALTER TABLE "${t}" DROP CONSTRAINT "${c.fk.constraint}";`)
          if (now) {
            let s = `ALTER TABLE "${t}" ADD CONSTRAINT "${t}_${name}_fkey" FOREIGN KEY ("${name}") REFERENCES "${now.table}"("${now.column}")`
            if (now.onDelete) s += ` ON DELETE ${now.onDelete}`
            if (now.onUpdate) s += ` ON UPDATE ${now.onUpdate}`
            out.push(s + ';')
          }
        }
      }
    }
    for (const c of added) {
      if (!c.name.trim()) continue
      out.push(`ALTER TABLE "${t}" ADD COLUMN ${colDef(c)};`)
    }
    return out
  }

  const statements = buildStatements()
  const save = () => {
    if (!statements.length && !orderChanged) return
    // Run the stage action AND close the panel — otherwise the invisible
    // slide-over overlay stays mounted and blocks clicks (e.g. the Changes button).
    close(() => {
      if (statements.length) onStage(statements, table.name, 'edit')
      // Order is design, not DDL — it is saved with the diagram whether or not
      // this save also stages statements.
      if (orderChanged) onReorderColumns?.(drawnOrder())
      onClose()
    })
  }

  return (
    <SlideOverPanel
      show={show}
      close={close}
      title={table.name}
      footer={
        <>
          <Button variant="subtle" size="sm" onClick={() => close()}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={!statements.length && !orderChanged} onClick={save}>
            Save to changes
          </Button>
        </>
      }
    >
      <Label>Columns</Label>
          <div className="flex flex-col gap-3" {...exDrag.listProps}>
            {existing.map((c, i) => (
              <div
                key={c.originalName}
                className={`relative rounded-soft border p-2.5 ${
                  c.drop ? 'border-red/40 bg-red/5' : 'border-edge bg-elevated/40'
                } ${exDrag.dragging(i) ? 'opacity-40' : ''}`}
                {...exDrag.itemProps(i, c.originalName)}
              >
                {exDrag.indicator(i) && (
                  <div
                    className={`pointer-events-none absolute inset-x-0 z-10 h-[2px] rounded-full bg-green-bright ${
                      exDrag.indicator(i) === 'top' ? '-top-1.5' : '-bottom-1.5'
                    }`}
                  />
                )}
                <div className="flex items-center gap-2">
                  {existing.length > 1 && (
                    <DragHandle {...exDrag.handleProps(i)} title="Drag to reorder — how the diagram draws it" />
                  )}
                  <Input
                    className="!w-auto min-w-0 flex-1 ${c.drop ? 'line-through opacity-60' : ''}"
                    value={c.name}
                    disabled={c.drop}
                    onChange={(e) => setEx(i, { name: e.target.value })}
                  />
                  {isPg && !c.drop ? (
                    <Select
                      className={`${controlClass} !w-[128px] shrink-0`}
                      value={c.type}
                      onChange={(v) => setEx(i, { type: v })}
                      options={(types.some((t) => t.toLowerCase() === (c.type || '').toLowerCase())
                        ? types
                        : [c.type, ...types]
                      )
                        // SERIAL/BIGSERIAL are pseudo-types for new columns — not
                        // valid ALTER COLUMN TYPE targets, so hide them when editing.
                        .filter((t) => !/^(SERIAL|BIGSERIAL|SMALLSERIAL)$/i.test(t))
                        .map((t) => ({ value: t, label: t }))}
                    />
                  ) : (
                    <span className="shrink-0 font-mono text-[10px] text-ink-faint">{(c.type || '').toUpperCase()}</span>
                  )}
                  {c.pk && <span className="shrink-0 rounded bg-green/15 px-1 text-[9px] font-bold text-green-bright">PK</span>}
                  {c.fkEnabled && <span className="shrink-0 rounded bg-amber/15 px-1 text-[9px] font-bold text-amber">FK</span>}
                  {c.drop ? (
                    <TextButton className="shrink-0 !text-[11px] font-semibold" onClick={() => toggleDrop(i)}>
                      Undo
                    </TextButton>
                  ) : (
                    <Tooltip label="Drop column" placement="top">
                      <TextButton
                        className="h-[26px] w-[26px] shrink-0 justify-center rounded-[7px] hover:!text-red"
                        onClick={() => toggleDrop(i)}
                        aria-label="Drop column"
                      >
                        <TrashIcon width={14} height={14} />
                      </TextButton>
                    </Tooltip>
                  )}
                </div>
                {c.drop ? (
                  <div className="mt-2 px-0.5 text-[11px] font-semibold text-red">Will be dropped on save.</div>
                ) : (
                  <>
                    <div className="mt-2 flex items-center gap-3">
                      <div className={`flex items-center gap-1.5 text-[11px] ${isPg ? 'text-ink-dim' : 'text-ink-faint'}`}>
                        <Checkbox checked={c.notNull} disabled={!isPg} onChange={(v) => setEx(i, { notNull: v })} ariaLabel="Not null" />
                        Not null
                      </div>
                      <Input
                        className="!w-auto min-w-0 flex-1"
                        placeholder="default…"
                        value={c.default}
                        disabled={!isPg}
                        onChange={(e) => setEx(i, { default: e.target.value })}
                      />
                    </div>
                    {isPg ? (
                      <div className="mt-2 flex flex-col gap-2 px-0.5">
                        <div className="flex items-center gap-1.5 text-[11px] text-ink-dim">
                          <Checkbox
                            checked={c.fkEnabled}
                            disabled={tableNames.length === 0}
                            onChange={(v) => setEx(i, { fkEnabled: v })}
                            ariaLabel="Foreign key"
                          />
                          Foreign key
                        </div>
                        {c.fkEnabled && (
                          <>
                            <div className="flex items-center gap-2">
                              <span className="shrink-0 text-[11px] text-ink-faint">References</span>
                              <Select
                                className={`${controlClass} !w-auto min-w-0 flex-1`}
                                value={c.fkTable}
                                onChange={(v) => setEx(i, { fkTable: v, fkColumn: '' })}
                                placeholder="table"
                                options={tableNames.map((tn) => ({ value: tn, label: tn }))}
                              />
                              <Select
                                className={`${controlClass} !w-auto min-w-0 flex-1`}
                                value={c.fkColumn}
                                onChange={(v) => setEx(i, { fkColumn: v })}
                                placeholder="column"
                                options={(schema[c.fkTable] || []).map((cn) => ({ value: cn, label: cn }))}
                              />
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="shrink-0 text-[11px] text-ink-faint">On delete</span>
                              <Select
                                className={`${controlClass} !w-auto min-w-0 flex-1`}
                                value={c.fkOnDelete}
                                onChange={(v) => setEx(i, { fkOnDelete: v })}
                                options={FK_ACTIONS}
                              />
                              <span className="shrink-0 text-[11px] text-ink-faint">On update</span>
                              <Select
                                className={`${controlClass} !w-auto min-w-0 flex-1`}
                                value={c.fkOnUpdate}
                                onChange={(v) => setEx(i, { fkOnUpdate: v })}
                                options={FK_ACTIONS}
                              />
                            </div>
                          </>
                        )}
                      </div>
                    ) : (
                      c.fk && (
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-0.5 text-[11px] text-ink-faint">
                          <span>
                            References <span className="font-mono text-ink-dim">{c.fk.refTable}.{c.fk.refColumn}</span>
                          </span>
                          {c.fk.onDelete && c.fk.onDelete !== 'NO ACTION' && (
                            <span>
                              on delete <span className="font-mono text-ink-dim">{c.fk.onDelete}</span>
                            </span>
                          )}
                          {c.fk.onUpdate && c.fk.onUpdate !== 'NO ACTION' && (
                            <span>
                              on update <span className="font-mono text-ink-dim">{c.fk.onUpdate}</span>
                            </span>
                          )}
                        </div>
                      )
                    )}
                  </>
                )}
              </div>
            ))}
          </div>

          {/* Say what a reorder is, but only once someone has done one — the
              alternative is a standing paragraph about a thing nobody asked. */}
          {orderChanged && (
            <p className="mt-2 text-[11px] text-ink-faint">
              Column order is saved with the <span className="text-ink-dim">diagram</span>, not as SQL — no engine can move a
              column of an existing table with <span className="text-ink-dim">ALTER</span>.
            </p>
          )}

          {!isPg && (
            <p className="mt-2 text-[11px] text-ink-faint">
              SQLite supports renaming, dropping, and adding columns. Changing a column’s type, nullability,
              default, or foreign keys isn’t supported by SQLite — recreate the table for those. Some columns
              (e.g. primary or indexed keys) also can’t be dropped.
            </p>
          )}

          {added.length > 0 && <div className="mt-4 text-[11px] font-semibold text-ink-dim">New columns</div>}
          <div className="mt-2 flex flex-col gap-3" {...adDrag.listProps}>
            {added.map((c, i) => (
              <div
                key={c.id}
                className={`relative ${adDrag.dragging(i) ? 'opacity-40' : ''}`}
                {...adDrag.itemProps(i, c.id)}
              >
                {adDrag.indicator(i) && (
                  <div
                    className={`pointer-events-none absolute inset-x-0 z-10 h-[2px] rounded-full bg-green-bright ${
                      adDrag.indicator(i) === 'top' ? '-top-1.5' : '-bottom-1.5'
                    }`}
                  />
                )}
                <ColumnField
                  col={c}
                  types={types}
                  tableNames={tableNames}
                  schema={schema}
                  dragHandle={added.length > 1 ? <DragHandle {...adDrag.handleProps(i)} title="Drag to reorder new columns" /> : null}
                  onChange={(patch) => setAd(c.id, patch)}
                  onRemove={() => removeAdded(c.id)}
                />
              </div>
            ))}
          </div>

          <TextButton tone="green" className="mt-3 !text-[11px] font-semibold" onClick={addColumn}>
            <PlusIcon width={14} height={14} /> Add column
          </TextButton>

      <p className="mt-3 text-[11px] text-ink-faint">
        Default can be a literal or expression — e.g. <span className="text-ink-dim">0</span>,{' '}
        <span className="text-ink-dim">'active'</span>, <span className="text-ink-dim">now()</span>. Saving stages the ALTER
        statements in Changes.
      </p>
    </SlideOverPanel>
  )
}
