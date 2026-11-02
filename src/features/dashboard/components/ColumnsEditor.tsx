import { useState } from 'react'
import TextButton from '@/shared/ui/buttons/TextButton'
import IconButton from '@/shared/ui/buttons/IconButton'
import DragHandle from '@/shared/ui/DragHandle'
import HelpTip from '@/shared/ui/HelpTip'
import Toggle from '@/shared/ui/form/Toggle'
import Select from '@/shared/ui/form/Select'
import NumberStepper from '@/shared/ui/form/NumberStepper'
import { Input, controlClass } from '@/shared/ui/form/Input'
import { FormField } from '@/shared/ui/form/Form'
import { ChevronDown, TrashIcon } from '@/shared/ui/icons'
import { useDragReorder } from '@/shared/hooks/useDragReorder'
import { COLUMN_DISPLAYS, COLUMN_DISPLAYS_WITH_REF, type ColumnDisplay, type WidgetColumn } from '../types'
import { swatchLook } from '../lib/thresholds'
import ThresholdsEditor from './ThresholdsEditor'

const NUMBER_DISPLAYS: ColumnDisplay[] = ['number', 'compact', 'bytes']
// "Number (1,234)" → "Number", for the collapsed row.
const DISPLAY_NAME = Object.fromEntries(COLUMN_DISPLAYS.map((d) => [d.value, d.label.split(' (')[0]]))

// The `table` widget's columns. Empty = every query column as returned, so
// nothing to show; each column added is a row that collapses to a one-line
// summary and expands to its settings — header, display, affixes, thresholds.
export default function ColumnsEditor({
  value,
  onChange,
  queryColumns,
  sampleRow,
}: {
  value?: WidgetColumn[]
  onChange: (cols: WidgetColumn[] | undefined) => void
  /** Columns the query returns — empty until it has run once. */
  queryColumns: string[]
  /** A row of the result, to guess a starting display for each column. */
  sampleRow?: Record<string, unknown>
}) {
  const cols = value ?? []
  // Which rows are open, by index — kept in step when rows move or go.
  const [open, setOpen] = useState<number[]>([])
  const toggle = (i: number) => setOpen((o) => (o.includes(i) ? o.filter((j) => j !== i) : [...o, i]))

  const set = (next: WidgetColumn[]) => onChange(next.length ? next : undefined)
  const patchAt = (i: number, f: Partial<WidgetColumn>) => set(cols.map((c, j) => (j === i ? { ...c, ...f } : c)))
  const removeAt = (i: number) => {
    set(cols.filter((_, j) => j !== i))
    setOpen((o) => o.filter((j) => j !== i).map((j) => (j > i ? j - 1 : j)))
  }
  const move = (from: number, to: number) => {
    const next = [...cols]
    const [c] = next.splice(from, 1)
    next.splice(to, 0, c)
    set(next)
    // Where index j lands once `from` is lifted out and dropped at `to`.
    const at = (j: number) => (j === from ? to : from < to ? (j > from && j <= to ? j - 1 : j) : j >= to && j < from ? j + 1 : j)
    setOpen((o) => o.map(at))
  }
  const reorder = useDragReorder(cols.length, move)

  const guess = (column: string): WidgetColumn => (typeof sampleRow?.[column] === 'number' ? { column, display: 'number' } : { column })
  const unlisted = queryColumns.filter((c) => !cols.some((x) => x.column === c))
  const add = (added: WidgetColumn[], expand: boolean) => {
    set([...cols, ...added])
    if (expand) setOpen((o) => [...o, cols.length])
  }
  const columnOptions = queryColumns.map((c) => ({ value: c, label: c }))

  return (
    <div className="rounded-soft border border-edge bg-card p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-ink">
          Columns
          <HelpTip>
            Without any, every column shows as the query returns it. Once you add columns, only those show, in this order —
            each with its own header, display (numbers, bars, badges…), prefix, unit and thresholds. A column may be listed
            twice, say a count as a number and again as a bar.
          </HelpTip>
        </div>
        <div className="flex items-center gap-3">
          {unlisted.length > 0 && <TextButton onClick={() => add(unlisted.map(guess), false)}>+ Add all</TextButton>}
          <TextButton onClick={() => add([guess(unlisted[0] ?? queryColumns[0] ?? '')], true)}>+ Add column</TextButton>
        </div>
      </div>

      {!cols.length ? (
        <p className="mt-1 text-[11px] text-ink-faint">Every column shows as returned.</p>
      ) : (
        <div className="mt-2.5 space-y-1.5" {...reorder.listProps}>
          {cols.map((col, i) => {
            const display = col.display ?? 'text'
            const expanded = open.includes(i)
            const key = `${i}-${col.column}`
            const stepColors = (col.thresholds ?? []).filter((t) => t.color).map((t) => t.color!)
            return (
              <div key={key} className={`relative ${reorder.dragging(i) ? 'opacity-40' : ''}`} {...reorder.itemProps(i, key)}>
                {reorder.indicator(i) && (
                  <div
                    className={`pointer-events-none absolute inset-x-0 z-10 h-[2px] rounded-full bg-green-bright ${
                      reorder.indicator(i) === 'top' ? '-top-1' : '-bottom-1'
                    }`}
                  />
                )}
                <div className="rounded-soft border border-edge bg-elevated/40">
                  <div className="flex items-center gap-1.5 py-1 pl-1.5 pr-1">
                    <DragHandle {...reorder.handleProps(i)} title="Drag to reorder" />
                    <button
                      type="button"
                      onClick={() => toggle(i)}
                      aria-expanded={expanded}
                      className="flex min-w-0 flex-1 items-center gap-2 py-0.5 text-left"
                    >
                      <ChevronDown width={13} height={13} className={`shrink-0 text-ink-faint transition-transform ${expanded ? '' : '-rotate-90'}`} />
                      <span className="truncate font-mono text-[11px] text-ink">{col.column || <span className="text-ink-faint">pick a column</span>}</span>
                      {col.label && <span className="truncate text-[11px] text-ink-dim">→ {col.label}</span>}
                      <span className="ml-auto shrink-0 text-[10px] text-ink-faint">{DISPLAY_NAME[display]}</span>
                      {stepColors.length > 0 && (
                        <span className="flex shrink-0 gap-0.5" title="Thresholds">
                          {stepColors.map((c, k) => {
                            const s = swatchLook(c)
                            return <span key={k} className={`h-2 w-2 rounded-full ${s.className}`} style={s.style} />
                          })}
                        </span>
                      )}
                    </button>
                    <IconButton size="sm" aria-label="Remove column" onClick={() => removeAt(i)}>
                      <TrashIcon width={13} height={13} />
                    </IconButton>
                  </div>

                  {expanded && (
                    <div className="space-y-2.5 border-t border-edge/60 p-2.5">
                      <div className="flex items-end gap-2">
                        <FormField label="Column" className="flex-1">
                          {columnOptions.length ? (
                            <Select
                              className={controlClass}
                              value={col.column}
                              placeholder="Pick a column…"
                              onChange={(v: string) => patchAt(i, { column: v })}
                              options={columnOptions}
                            />
                          ) : (
                            <Input value={col.column} onChange={(e) => patchAt(i, { column: e.target.value })} placeholder="column name" />
                          )}
                        </FormField>
                        <FormField label="Header" className="flex-1">
                          <Input
                            value={col.label ?? ''}
                            onChange={(e) => patchAt(i, { label: e.target.value || undefined })}
                            placeholder={col.column || 'Header'}
                          />
                        </FormField>
                        <FormField label="Show as" className="w-[170px]">
                          <Select
                            className={controlClass}
                            value={display}
                            onChange={(v: ColumnDisplay) => patchAt(i, { display: v === 'text' ? undefined : v })}
                            options={COLUMN_DISPLAYS}
                          />
                        </FormField>
                      </div>

                      <div className="flex items-end gap-2">
                        {display !== 'bar' && (
                          <>
                            <FormField label="Prefix" className="w-[100px]">
                              <Input value={col.prefix ?? ''} onChange={(e) => patchAt(i, { prefix: e.target.value || undefined })} placeholder="broker " />
                            </FormField>
                            <FormField label="Unit" className="w-[90px]">
                              <Input value={col.unit ?? ''} onChange={(e) => patchAt(i, { unit: e.target.value || undefined })} placeholder="ms" />
                            </FormField>
                          </>
                        )}
                        {NUMBER_DISPLAYS.includes(display) && (
                          <FormField label="Decimals" className="w-[96px]">
                            <NumberStepper
                              ariaLabel="Decimals"
                              allowNull
                              min={0}
                              max={6}
                              value={col.decimals ?? null}
                              onChange={(n) => patchAt(i, { decimals: n ?? undefined })}
                            />
                          </FormField>
                        )}
                        {COLUMN_DISPLAYS_WITH_REF.includes(display) && (
                          <FormField
                            label={display === 'badges' ? 'Highlight items also in' : 'Out of the items in'}
                            className="flex-1"
                            help={
                              display === 'badges'
                                ? 'Items also listed in this column are filled, the rest dashed — e.g. replicas against the in-sync set.'
                                : 'Shows “n / m”, m being how many items this column lists — amber when n falls short, unless thresholds color it.'
                            }
                          >
                            <Select
                              className={controlClass}
                              value={col.ref ?? ''}
                              onChange={(v: string) => patchAt(i, { ref: v || undefined })}
                              options={[{ value: '', label: 'None' }, ...columnOptions.filter((o) => o.value !== col.column)]}
                            />
                          </FormField>
                        )}
                        <label className="mb-2 ml-auto flex items-center gap-2 text-[11px] text-ink-dim">
                          Monospace
                          <Toggle checked={!!col.mono} ariaLabel="Monospace" onChange={(on: boolean) => patchAt(i, { mono: on || undefined })} />
                        </label>
                      </div>

                      {display !== 'badges' && (
                        <div className="border-t border-edge/60 pt-2.5">
                          <ThresholdsEditor
                            value={col.thresholds}
                            onChange={(thresholds) => patchAt(i, { thresholds: thresholds?.map(({ from, color }) => ({ from, color })) })}
                            help={
                              display === 'bar'
                                ? 'The bar takes the color of the highest step its value reaches; below every step it uses the base (green when the base is neutral).'
                                : display === 'count'
                                  ? 'The count takes the color of the highest step it reaches; below every step it uses the base.'
                                  : 'The cell takes the color of the highest step its value reaches; below every step it uses the base. Cells that are not numbers keep the base.'
                            }
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!queryColumns.length && cols.length > 0 && (
        <p className="mt-2 text-[11px] text-ink-faint">Run the preview to pick columns from a list.</p>
      )}
    </div>
  )
}
