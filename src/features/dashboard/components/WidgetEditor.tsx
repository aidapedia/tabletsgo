import { useMemo, useState } from 'react'
import Button from '@/shared/ui/buttons/Button'
import TextButton from '@/shared/ui/buttons/TextButton'
import Badge from '@/shared/ui/Badge'
import { Input, Textarea, controlClass } from '@/shared/ui/form/Input'
import { FormField } from '@/shared/ui/form/Form'
import Select from '@/shared/ui/form/Select'
import SqlEditor from '@/shared/ui/SqlEditor'
import Popover from '@/shared/ui/overlay/Popover'
import { CloseIcon, PlayIcon } from '@/shared/ui/icons'
import { runQuery } from '@/shared/api/database'
import type { DashboardVariable, Widget, WidgetType } from '../types'
import { WIDGET_TYPE_LABEL } from '../types'
import { substituteVariables } from '../lib/variables'
import { sampleResult } from '../lib/sampleData'
import { WIDGET_GUIDE } from '../lib/widgetGuide'
import { toXYSeries, toPieData, type QueryResult } from '../lib/queryData'
import { useChartPalette, MAX_SERIES } from '../lib/palette'
import WidgetChart from './WidgetChart'
import MarkdownText from './MarkdownText'
import ShapeGuide from './ShapeGuide'

const COLORABLE: WidgetType[] = ['area', 'line', 'bar', 'pie']

// Preset swatches offered by the color picker (a fixed, curated set — not the
// chart palette itself, so users can pick outside the validated series colors).
const PRESET_COLORS = [
  '#8e8e93', '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#30b0c7',
  '#55b6f2', '#007aff', '#5856d6', '#af52de', '#bf5af2', '#ff2d55', '#ff375f',
]

// Swatch button that opens a small preset-color grid, closer to a native
// system color picker than the browser's <input type="color"> dialog.
function ColorSwatch({ color, onChange }: { color: string; onChange: (c: string) => void }) {
  return (
    <Popover
      portal
      width={300}
      trigger={({ toggle }) => (
        <button
          type="button"
          aria-label="Pick color"
          onClick={toggle}
          className="h-5 w-5 shrink-0 rounded-full border border-edge-strong"
          style={{ background: color }}
        />
      )}
    >
      {({ close }) => (
        <div className="flex flex-wrap gap-2 p-2.5">
          <button
            type="button"
            aria-label="Close"
            onClick={close}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-elevated text-ink-faint hover:text-ink"
          >
            <CloseIcon width={12} height={12} />
          </button>
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              onClick={() => {
                onChange(c)
                close()
              }}
              className="h-7 w-7 rounded-full border border-black/10"
              style={{ background: c }}
            />
          ))}
        </div>
      )}
    </Popover>
  )
}

const TYPE_OPTIONS = (Object.entries(WIDGET_TYPE_LABEL) as [WidgetType, string][]).map(([value, label]) => ({
  value,
  label,
}))

// Create/edit one widget. Works on a draft copy; `onSave` receives the final
// widget (layout untouched — placement is the grid's job).
export default function WidgetEditor({
  conn,
  dialect,
  schema,
  widget,
  variables,
  variableValues,
  onSave,
  onClose,
}: {
  conn: any
  dialect?: string
  schema?: Record<string, string[]>
  widget: Widget
  variables: DashboardVariable[]
  variableValues: Record<string, string>
  onSave: (w: Widget) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState<Widget>({ ...widget })
  const [preview, setPreview] = useState<QueryResult | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const patch = (fields: Partial<Widget>) => setDraft((d) => ({ ...d, ...fields }))

  const isText = draft.type === 'text'
  const canSave = draft.title.trim() && (isText ? true : !!draft.query?.trim())

  // Until a query has run, preview the selected type with sample data so the
  // diagram is visible while picking a type / writing SQL.
  const isSample = !preview
  const shown = preview ?? sampleResult(draft.type)

  const palette = useChartPalette()
  const isColorable = COLORABLE.includes(draft.type)
  // Labels for the color pickers, in the same order colors are applied — series
  // names for xy charts, slice names for pie (sample data while no real preview ran).
  const colorLabels = useMemo(() => {
    if (!isColorable) return []
    if (draft.type === 'pie') return toPieData(shown).slice(0, MAX_SERIES).map((d) => d.name)
    return toXYSeries(shown).seriesKeys.slice(0, MAX_SERIES)
  }, [isColorable, draft.type, shown])

  const setColor = (i: number, color: string) => {
    const colors = [...(draft.colors ?? [])]
    colors[i] = color
    patch({ colors })
  }
  const resetColor = (i: number) => {
    const colors = [...(draft.colors ?? [])]
    colors[i] = ''
    patch({ colors: colors.some(Boolean) ? colors : undefined })
  }

  const runPreview = async () => {
    if (!draft.query?.trim()) return
    setPreviewing(true)
    const r = (await runQuery(conn, substituteVariables(draft.query, variableValues))) as QueryResult
    setPreview(r)
    setPreviewing(false)
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex animate-fade items-center justify-center bg-black/60 p-6 backdrop-blur-[3px]"
      onMouseDown={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-[760px] animate-pop flex-col rounded-[16px] border border-edge-strong bg-panel"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="border-b border-edge px-5 py-4 text-sm font-bold text-ink">
          {widget.title ? 'Edit widget' : 'New widget'}
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <div className="flex gap-3">
            <FormField label="Title" className="flex-1">
              <Input
                autoFocus
                value={draft.title}
                onChange={(e) => patch({ title: e.target.value })}
                placeholder="e.g. Notifications by channel"
              />
            </FormField>
            <FormField label="Type" className="w-[190px]">
              <Select
                className={controlClass}
                value={draft.type}
                onChange={(type: WidgetType) => {
                  setPreview(null)
                  patch({ type })
                }}
                options={TYPE_OPTIONS}
              />
            </FormField>
            {draft.type === 'metric' && (
              <FormField label="Unit" className="w-[110px]">
                <Input value={draft.unit ?? ''} onChange={(e) => patch({ unit: e.target.value })} placeholder="ms, %…" />
              </FormField>
            )}
          </div>

          {isText ? (
            <FormField label="Text" hint="Markdown-style: # headings, **bold**, *italic*, `code`, - lists, [links](url).">
              <Textarea
                rows={8}
                className="font-mono !text-[12px]"
                value={draft.text ?? ''}
                onChange={(e) => patch({ text: e.target.value })}
                placeholder={'# Heading\nSome **bold** context for this dashboard…'}
              />
            </FormField>
          ) : (
            <div>
              <FormField
                label="Query"
                hint={
                  variables.length > 0 ? (
                    <>
                      Variables:{' '}
                      {variables.map((v, i) => (
                        <code key={v.id} className="text-ink-dim">
                          {i > 0 && ', '}
                          {`{{${v.name}}}`}
                        </code>
                      ))}
                    </>
                  ) : undefined
                }
              >
                <div className="overflow-hidden rounded-soft border border-edge">
                  <SqlEditor
                    value={draft.query ?? ''}
                    onChange={(query) => patch({ query })}
                    dialect={dialect}
                    schema={schema}
                    minHeight="120px"
                    maxHeight="260px"
                    placeholder="SELECT channel, COUNT(*) FROM notifications WHERE event = {{event}} GROUP BY channel"
                  />
                </div>
              </FormField>
              <ShapeGuide type={draft.type} schema={schema} onUseExample={(query) => patch({ query })} />
            </div>
          )}

          {isText ? (
            <div className="rounded-soft border border-edge bg-card p-4">
              <MarkdownText text={draft.text} />
            </div>
          ) : (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold text-ink-dim">Preview</span>
                  {isSample && <Badge tone="faint">Sample data</Badge>}
                </div>
                <Button size="sm" icon={PlayIcon} onClick={runPreview} disabled={!draft.query?.trim() || previewing}>
                  {previewing ? 'Running…' : 'Run preview'}
                </Button>
              </div>
              <div className="h-[240px] overflow-hidden rounded-soft border border-edge bg-card p-3">
                {preview?.error ? (
                  <div className="overflow-y-auto whitespace-pre-wrap break-words text-[11px] text-red">{preview.error}</div>
                ) : (
                  shown && (
                    <div className={`h-full ${isSample ? 'opacity-70' : ''}`}>
                      <WidgetChart widget={draft} result={shown} />
                    </div>
                  )
                )}
              </div>
              {isSample && !preview?.error && (
                <p className="mt-1.5 text-[11px] text-ink-faint">
                  Showing what a {WIDGET_TYPE_LABEL[draft.type].toLowerCase()} looks like — run the query to preview your
                  own data. {WIDGET_GUIDE[draft.type].hint}
                </p>
              )}
            </div>
          )}

          {isColorable && colorLabels.length > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-semibold text-ink-dim">Colors</span>
                {draft.colors?.some(Boolean) && (
                  <TextButton onClick={() => patch({ colors: undefined })}>Reset all</TextButton>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {colorLabels.map((label, i) => {
                  const custom = draft.colors?.[i]
                  const color = custom || palette.series[i]
                  return (
                    <div
                      key={`${label}-${i}`}
                      className="flex items-center gap-1.5 rounded-soft border border-edge bg-card py-1 pl-1 pr-2"
                    >
                      <ColorSwatch color={color} onChange={(c) => setColor(i, c)} />
                      <span className="max-w-[110px] truncate text-[11px] text-ink-dim">{label}</span>
                      {custom && (
                        <button
                          type="button"
                          className="text-[11px] text-ink-faint hover:text-ink"
                          onClick={() => resetColor(i)}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-edge px-5 py-4">
          <Button variant="subtle" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={!canSave} onClick={() => onSave({ ...draft, title: draft.title.trim() })}>
            Save widget
          </Button>
        </div>
      </div>
    </div>
  )
}
