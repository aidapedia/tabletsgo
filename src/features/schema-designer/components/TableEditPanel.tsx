import { useState } from 'react'
import Button from '@/shared/ui/Button'
import Checkbox from '@/shared/ui/Checkbox'
import { useSlideOver } from '@/shared/hooks/useSlideOver'
import { ChevronRight, PlusIcon } from '@/shared/ui/icons'
import { fieldInput, fieldLabel } from '@/shared/lib/styles'
import { ColumnField, colDef, newColumn } from '@/features/schema-designer/components/columnFields'

export default function TableEditPanel({ table, dialect, types, tableNames = [], schema = {}, onStage, onClose }) {
  const isPg = dialect === 'postgresql'
  const { show, close } = useSlideOver(onClose)

  const [existing, setExisting] = useState(() =>
    table.columns.map((c) => ({
      originalName: c.name,
      name: c.name,
      type: c.type,
      pk: c.pk,
      notNull: !!c.notnull,
      initialNotNull: !!c.notnull,
      default: c.default == null ? '' : String(c.default),
      initialDefault: c.default == null ? '' : String(c.default),
    }))
  )
  const [added, setAdded] = useState([])

  const setEx = (i, patch) => setExisting((cs) => cs.map((c, idx) => (idx === i ? { ...c, ...patch } : c)))
  const setAd = (id, patch) => setAdded((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  const addColumn = () => setAdded((cs) => [...cs, newColumn(types[0])])
  const removeAdded = (id) => setAdded((cs) => cs.filter((c) => c.id !== id))

  const buildStatements = () => {
    const t = table.name
    const out = []
    for (const c of existing) {
      const name = c.name.trim() || c.originalName
      if (name !== c.originalName) out.push(`ALTER TABLE "${t}" RENAME COLUMN "${c.originalName}" TO "${name}";`)
      // Nullability / default changes are only safely alterable in PostgreSQL.
      if (isPg) {
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
          <label className={fieldLabel}>Columns</label>
          <div className="flex flex-col gap-3">
            {existing.map((c, i) => (
              <div key={c.originalName} className="rounded-soft border border-edge bg-elevated/40 p-2.5">
                <div className="flex items-center gap-2">
                  <input
                    className={`${fieldInput} !w-auto min-w-0 flex-1`}
                    value={c.name}
                    onChange={(e) => setEx(i, { name: e.target.value })}
                  />
                  <span className="shrink-0 font-mono text-[10px] text-ink-faint">{(c.type || '').toUpperCase()}</span>
                  {c.pk && <span className="shrink-0 rounded bg-green/15 px-1 text-[9px] font-bold text-green-bright">PK</span>}
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <div className={`flex items-center gap-1.5 text-[11px] ${isPg ? 'text-ink-dim' : 'text-ink-faint'}`}>
                    <Checkbox checked={c.notNull} disabled={!isPg} onChange={(v) => setEx(i, { notNull: v })} ariaLabel="Not null" />
                    Not null
                  </div>
                  <input
                    className={`${fieldInput} !w-auto min-w-0 flex-1`}
                    placeholder="default…"
                    value={c.default}
                    disabled={!isPg}
                    onChange={(e) => setEx(i, { default: e.target.value })}
                  />
                </div>
              </div>
            ))}
          </div>

          {!isPg && (
            <p className="mt-2 text-[11px] text-ink-faint">
              SQLite only supports renaming existing columns or adding new ones.
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
