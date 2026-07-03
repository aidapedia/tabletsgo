import { useState } from 'react'
import Button from '@/shared/ui/Button'
import Checkbox from '@/shared/ui/Checkbox'
import Select from '@/shared/ui/Select'
import Tooltip from '@/shared/ui/Tooltip'
import { useSlideOver } from '@/shared/hooks/useSlideOver'
import { ChevronRight, PlusIcon, TrashIcon } from '@/shared/ui/icons'
import { controlClass } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Form'
import { ColumnField, FK_ACTIONS, colDef, newColumn } from '@/features/schema-designer/components/columnFields'

// Treat the SQL default (NO ACTION) as "unspecified" so it round-trips cleanly.
const normAction = (a) => (a && a !== 'NO ACTION' ? a : '')

export default function TableEditPanel({ table, dialect, types, tableNames = [], schema = {}, foreignKeys = [], onStage, onClose }) {
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
    if (!statements.length) return
    // Run the stage action AND close the panel — otherwise the invisible
    // slide-over overlay stays mounted and blocks clicks (e.g. the Changes button).
    close(() => {
      onStage(statements, table.name, 'edit')
      onClose()
    })
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex justify-end bg-black/50 transition-opacity duration-200 ${
        show ? 'opacity-100' : 'opacity-0'
      }`}
      onMouseDown={() => close()}
    >
      <div
        className={`flex h-full w-full max-w-[460px] flex-col border-l border-edge-strong bg-panel shadow-[-20px_0_60px_-20px_rgba(0,0,0,0.8)] transition-transform duration-200 ease-out ${
          show ? 'translate-x-0' : 'translate-x-full'
        }`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-edge px-5 py-4">
          <h3 className="text-sm font-bold">{table.name}</h3>
          <button
            className="flex h-8 w-8 items-center justify-center rounded-soft text-ink-dim hover:bg-elevated hover:text-ink"
            onClick={() => close()}
            aria-label="Close"
          >
            <ChevronRight />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <Label>Columns</Label>
          <div className="flex flex-col gap-3">
            {existing.map((c, i) => (
              <div
                key={c.originalName}
                className={`rounded-soft border p-2.5 ${
                  c.drop ? 'border-red/40 bg-red/5' : 'border-edge bg-elevated/40'
                }`}
              >
                <div className="flex items-center gap-2">
                  <input
                    className={`${controlClass} !w-auto min-w-0 flex-1 ${c.drop ? 'line-through opacity-60' : ''}`}
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
                    <button
                      type="button"
                      className="shrink-0 text-[11px] font-semibold text-ink-dim hover:text-ink"
                      onClick={() => toggleDrop(i)}
                    >
                      Undo
                    </button>
                  ) : (
                    <Tooltip label="Drop column" placement="top">
                      <button
                        type="button"
                        className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px] text-ink-dim hover:text-red"
                        onClick={() => toggleDrop(i)}
                        aria-label="Drop column"
                      >
                        <TrashIcon width={14} height={14} />
                      </button>
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
                      <input
                        className={`${controlClass} !w-auto min-w-0 flex-1`}
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

          {!isPg && (
            <p className="mt-2 text-[11px] text-ink-faint">
              SQLite supports renaming, dropping, and adding columns. Changing a column’s type, nullability,
              default, or foreign keys isn’t supported by SQLite — recreate the table for those. Some columns
              (e.g. primary or indexed keys) also can’t be dropped.
            </p>
          )}

          {added.length > 0 && <div className="mt-4 text-[11px] font-semibold text-ink-dim">New columns</div>}
          <div className="mt-2 flex flex-col gap-3">
            {added.map((c) => (
              <ColumnField
                key={c.id}
                col={c}
                types={types}
                tableNames={tableNames}
                schema={schema}
                onChange={(patch) => setAd(c.id, patch)}
                onRemove={() => removeAdded(c.id)}
              />
            ))}
          </div>

          <button
            type="button"
            className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-semibold text-green hover:text-green-bright"
            onClick={addColumn}
          >
            <PlusIcon width={14} height={14} /> Add column
          </button>

          <p className="mt-3 text-[11px] text-ink-faint">
            Default can be a literal or expression — e.g. <span className="text-ink-dim">0</span>,{' '}
            <span className="text-ink-dim">'active'</span>, <span className="text-ink-dim">now()</span>. Saving stages the ALTER
            statements in Changes.
          </p>
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-edge px-5 py-4">
          <Button variant="subtle" size="sm" onClick={() => close()}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={!statements.length} onClick={save}>
            Save to changes
          </Button>
        </div>
      </div>
    </div>
  )
}
