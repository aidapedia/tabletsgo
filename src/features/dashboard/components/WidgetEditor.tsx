import { useEffect, useMemo, useState } from 'react'
import Button from '@/shared/ui/buttons/Button'
import TextButton from '@/shared/ui/buttons/TextButton'
import Badge from '@/shared/ui/Badge'
import { Input, Textarea, controlClass } from '@/shared/ui/form/Input'
import { FormField } from '@/shared/ui/form/Form'
import Select from '@/shared/ui/form/Select'
import Toggle from '@/shared/ui/form/Toggle'
import Tab from '@/shared/ui/navigation/Tab'
import { listWorkflows, type WorkflowSummary } from '@/features/workflow'
import SqlEditor from '@/shared/ui/SqlEditor'
import Popover from '@/shared/ui/overlay/Popover'
import { ChevronDown, CloseIcon, PlayIcon, TrashIcon } from '@/shared/ui/icons'
import { runQuery } from '@/shared/api/database'
import IconButton from '@/shared/ui/buttons/IconButton'
import type {
  DashboardVariable,
  Widget,
  WidgetRowAction,
  WidgetRowActionCondition,
  WidgetRowActionOperator,
  WidgetRowActionVariant,
  WidgetType,
} from '../types'
import { MAX_TABLE_ROW_ACTIONS, ROW_ACTION_OPERATORS, ROW_ACTION_VARIANTS, WIDGET_TYPE_LABEL, widgetRowActions } from '../types'
import { ROW_ACTION_ICONS, ROW_ACTION_ICON_KEYS, rowActionIcon } from '../lib/rowActionIcons'
import { referencedVariables, substituteVariables } from '../lib/variables'
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

const VARIANT_LABEL: Record<WidgetRowActionVariant, string> = {
  ghost: 'Neutral',
  primary: 'Primary',
  danger: 'Danger',
}
const VARIANT_OPTIONS = ROW_ACTION_VARIANTS.map((value) => ({ value, label: VARIANT_LABEL[value] }))

// Popover grid to pick (or clear) a row-action button icon. Mirrors ColorSwatch.
function IconPicker({ value, onChange }: { value?: string; onChange: (key: string | undefined) => void }) {
  const Current = rowActionIcon(value)
  return (
    <Popover
      portal
      width={230}
      trigger={({ toggle }) => (
        <button
          type="button"
          aria-label="Pick icon"
          onClick={toggle}
          className="flex h-[34px] w-[42px] items-center justify-center rounded-soft border border-edge bg-elevated text-ink-dim hover:text-ink"
        >
          {Current ? <Current width={15} height={15} /> : <span className="text-[10px] text-ink-faint">None</span>}
        </button>
      )}
    >
      {({ close }) => (
        <div className="p-2">
          <div className="grid grid-cols-6 gap-1.5">
            <button
              type="button"
              aria-label="No icon"
              onClick={() => { onChange(undefined); close() }}
              className={`flex h-8 w-8 items-center justify-center rounded-soft text-[9px] text-ink-faint hover:bg-card-hover ${!value ? 'ring-1 ring-green' : ''}`}
            >
              None
            </button>
            {ROW_ACTION_ICON_KEYS.map((key) => {
              const { label, Icon } = ROW_ACTION_ICONS[key]
              return (
                <button
                  key={key}
                  type="button"
                  aria-label={label}
                  title={label}
                  onClick={() => { onChange(key); close() }}
                  className={`flex h-8 w-8 items-center justify-center rounded-soft text-ink-dim hover:bg-card-hover hover:text-ink ${value === key ? 'ring-1 ring-green text-ink' : ''}`}
                >
                  <Icon width={15} height={15} />
                </button>
              )
            })}
          </div>
        </div>
      )}
    </Popover>
  )
}

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
  // Normalize the legacy single `rowAction` shape into the `rowActions` list on open.
  const [draft, setDraft] = useState<Widget>(() => {
    const { rowAction: _legacy, ...rest } = widget as any
    const actions = widgetRowActions(widget)
    return { ...rest, rowActions: actions.length ? actions : undefined }
  })
  const [preview, setPreview] = useState<QueryResult | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(true)
  const patch = (fields: Partial<Widget>) => setDraft((d) => ({ ...d, ...fields }))

  const isText = draft.type === 'text'
  const isTable = draft.type === 'table'
  const isMetric = draft.type === 'metric'
  const canSave =
    draft.title.trim() &&
    (isText ? true : !!draft.query?.trim()) &&
    // Every row action needs a workflow picked before the widget can be saved.
    (!draft.rowActions || draft.rowActions.every((a) => a.workflowId))

  // Workflows for the row-action picker — loaded once, only when editing a table widget.
  const [workflows, setWorkflows] = useState<WorkflowSummary[] | null>(null)
  useEffect(() => {
    if (!isTable || workflows !== null) return
    listWorkflows(conn.id).then((ws) => {
      setWorkflows(ws)
      // No workflows to pick from: drop half-configured (empty-id) actions so the
      // toggle resets instead of silently blocking Save. Fully configured ones are
      // kept — the list can be empty because of a fetch hiccup, not just deletion.
      if (!ws.length)
        setDraft((d) => {
          const kept = d.rowActions?.filter((a) => a.workflowId)
          return { ...d, rowActions: kept?.length ? kept : undefined }
        })
    })
  }, [isTable, workflows, conn.id])

  // Columns offered to the row-action condition picker. A run preview provides
  // them for free; otherwise fetch them by running the query once (LIMIT 1) so
  // the picker is a proper single-select without forcing a manual "Run preview".
  const [fetchedColumns, setFetchedColumns] = useState<string[]>([])
  const conditionColumns = preview?.columns?.length ? preview.columns : fetchedColumns
  const hasRowActions = isTable && !!draft.rowActions?.length
  useEffect(() => {
    if (!hasRowActions || preview?.columns?.length) return
    const q = draft.query?.trim()
    if (!q) return
    // Same rule as WidgetCard: don't run until every referenced {{variable}} is resolved.
    if (referencedVariables(draft.query).some((n) => !variableValues[n])) return
    let alive = true
    const sql = `SELECT * FROM (${substituteVariables(q, variableValues).replace(/;+\s*$/, '')}) AS _cols LIMIT 1`
    runQuery(conn, sql).then((r: QueryResult) => {
      if (alive && r?.columns?.length) setFetchedColumns(r.columns)
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasRowActions, draft.query, variableValues, preview?.columns, conn?.id])

  // Until a query has run, preview the selected type with sample data so the
  // diagram is visible while picking a type / writing SQL.
  const isSample = !preview
  const shown = preview ?? sampleResult(draft.type)

  const palette = useChartPalette()
  const isColorable = COLORABLE.includes(draft.type)

  // Editor tabs — the preview lives outside this set (always visible). Which
  // tabs exist depends on the widget type; 'query'/'content' is always first.
  type EditorTab = 'content' | 'query' | 'table' | 'style' | 'format'
  const tabs: { key: EditorTab; label: string }[] = isText
    ? [{ key: 'content', label: 'Content' }]
    : [
        { key: 'query', label: 'Query' },
        ...(isTable ? [{ key: 'table' as EditorTab, label: 'Table' }] : []),
        ...(isMetric ? [{ key: 'format' as EditorTab, label: 'Format' }] : []),
        ...(isColorable ? [{ key: 'style' as EditorTab, label: 'Colors' }] : []),
      ]
  const [activeTab, setActiveTab] = useState<EditorTab>(isText ? 'content' : 'query')
  // Type changes can remove the active tab (e.g. table→pie drops 'table') — snap back to the default.
  useEffect(() => {
    setActiveTab(draft.type === 'text' ? 'content' : 'query')
  }, [draft.type])
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

        {/* Identity fields stay visible above the tabs — they're not tab-specific. */}
        <div className="px-5 pt-4">
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
                  // Row actions are a table-only, deliberate choice — drop them when the type changes.
                  patch({ type, ...(type !== 'table' ? { rowActions: undefined } : null) })
                }}
                options={TYPE_OPTIONS}
              />
            </FormField>
          </div>
        </div>

        {/* Tab bar — only shown when there's more than one tab to switch between. */}
        {tabs.length > 1 && (
          <div className="mt-3 flex gap-4 border-b border-edge px-5">
            {tabs.map((t) => (
              <Tab key={t.key} active={activeTab === t.key} onClick={() => setActiveTab(t.key)}>
                {t.label}
              </Tab>
            ))}
          </div>
        )}

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {activeTab === 'content' && isText && (
            <FormField label="Text" hint="Markdown-style: # headings, **bold**, *italic*, `code`, - lists, [links](url).">
              <Textarea
                rows={8}
                className="font-mono !text-[12px]"
                value={draft.text ?? ''}
                onChange={(e) => patch({ text: e.target.value })}
                placeholder={'# Heading\nSome **bold** context for this dashboard…'}
              />
            </FormField>
          )}
          {activeTab === 'query' && !isText && (
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

          {activeTab === 'format' && (
            <FormField
              label="Unit"
              className="w-[220px]"
              hint="Shown after the value, e.g. “ms”, “%”, “req/s”. Leave blank for none."
            >
              <Input value={draft.unit ?? ''} onChange={(e) => patch({ unit: e.target.value })} placeholder="ms, %…" />
            </FormField>
          )}

          {activeTab === 'table' && (
            <div className="space-y-3">
              <FormField
                label="Rows per page"
                className="w-[220px]"
                hint="Paginated tables fetch one page at a time — add an ORDER BY so pages stay stable."
              >
                <Select
                  className={controlClass}
                  value={draft.pageSize ? String(draft.pageSize) : ''}
                  onChange={(v: string) => patch({ pageSize: v ? Number(v) : undefined })}
                  options={[
                    { value: '', label: 'All rows (no pagination)' },
                    ...['10', '25', '50', '100'].map((n) => ({ value: n, label: `${n} rows` })),
                  ]}
                />
              </FormField>

              <div className="rounded-soft border border-edge bg-card p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-semibold text-ink">Row action buttons</div>
                    <div className="mt-0.5 text-[11px] text-ink-faint">
                      Adds buttons to every row that run a workflow with that row as its input.
                    </div>
                  </div>
                  <Toggle
                    checked={!!draft.rowActions}
                    disabled={workflows?.length === 0}
                    ariaLabel="Row action buttons"
                    onChange={(on: boolean) => patch({ rowActions: on ? [{ workflowId: '' }] : undefined })}
                  />
                </div>
                {workflows?.length === 0 ? (
                  <p className="mt-2 text-[11px] text-ink-faint">
                    This connection has no workflows yet — create one in the console's Workflows panel first.
                  </p>
                ) : (
                  draft.rowActions && (
                    <>
                      <div className="mt-3 space-y-2">
                        {draft.rowActions.map((action, i) => {
                          const patchAction = (fields: Partial<WidgetRowAction>) =>
                            patch({ rowActions: draft.rowActions!.map((a, j) => (j === i ? { ...a, ...fields } : a)) })
                          const PreviewIcon = rowActionIcon(action.icon)
                          return (
                            <div key={i} className="rounded-soft border border-edge bg-elevated/40 p-2.5">
                              <div className="flex items-end gap-2">
                                <FormField label="Workflow" className="flex-1">
                                  <Select
                                    className={controlClass}
                                    value={action.workflowId}
                                    placeholder={workflows === null ? 'Loading…' : 'Pick a workflow…'}
                                    disabled={workflows === null}
                                    onChange={(id: string) => {
                                      const wf = workflows?.find((w) => w.id === id)
                                      patchAction({ workflowId: id, workflowName: wf?.name })
                                    }}
                                    options={(workflows ?? []).map((w) => ({ value: w.id, label: w.name }))}
                                  />
                                </FormField>
                                <IconButton
                                  aria-label="Remove action"
                                  onClick={() => {
                                    const next = draft.rowActions!.filter((_, j) => j !== i)
                                    patch({ rowActions: next.length ? next : undefined })
                                  }}
                                >
                                  <TrashIcon width={14} height={14} />
                                </IconButton>
                              </div>
                              <div className="mt-2 flex items-end gap-2">
                                <FormField label="Label" className="flex-1">
                                  <Input
                                    value={action.label ?? ''}
                                    onChange={(e) => patchAction({ label: e.target.value })}
                                    placeholder="Run"
                                  />
                                </FormField>
                                <FormField label="Style" className="w-[120px]">
                                  <Select
                                    className={controlClass}
                                    value={action.variant ?? 'ghost'}
                                    onChange={(v: WidgetRowActionVariant) => patchAction({ variant: v })}
                                    options={VARIANT_OPTIONS}
                                  />
                                </FormField>
                                <FormField label="Icon">
                                  <IconPicker value={action.icon} onChange={(icon) => patchAction({ icon })} />
                                </FormField>
                              </div>
                              <div className="mt-2 border-t border-edge/60 pt-2">
                                <div className="flex items-center justify-between">
                                  <span className="text-[11px] text-ink-dim">Only active on a condition</span>
                                  <Toggle
                                    checked={!!action.condition}
                                    ariaLabel="Conditional button"
                                    onChange={(on: boolean) =>
                                      patchAction({
                                        condition: on ? { column: conditionColumns[0] ?? '', operator: 'eq', effect: 'disable' } : undefined,
                                      })
                                    }
                                  />
                                </div>
                                {action.condition &&
                                  (() => {
                                    const cond = action.condition!
                                    const patchCond = (f: Partial<WidgetRowActionCondition>) =>
                                      patchAction({ condition: { ...cond, ...f } })
                                    const needsValue = ROW_ACTION_OPERATORS.find((o) => o.value === cond.operator)?.needsValue
                                    return (
                                      <>
                                        <div className="mt-2 flex items-end gap-2">
                                          <FormField label="When column" className="flex-1">
                                            {conditionColumns.length ? (
                                              <Select
                                                className={controlClass}
                                                value={cond.column}
                                                placeholder="Pick a column…"
                                                onChange={(v: string) => patchCond({ column: v })}
                                                options={conditionColumns.map((c) => ({ value: c, label: c }))}
                                              />
                                            ) : (
                                              <Input
                                                value={cond.column}
                                                onChange={(e) => patchCond({ column: e.target.value })}
                                                placeholder="column name"
                                              />
                                            )}
                                          </FormField>
                                          <FormField label="Test" className="w-[140px]">
                                            <Select
                                              className={controlClass}
                                              value={cond.operator}
                                              onChange={(v: WidgetRowActionOperator) => patchCond({ operator: v })}
                                              options={ROW_ACTION_OPERATORS.map((o) => ({ value: o.value, label: o.label }))}
                                            />
                                          </FormField>
                                          {needsValue && (
                                            <FormField label="Value" className="w-[110px]">
                                              <Input
                                                value={cond.value ?? ''}
                                                onChange={(e) => patchCond({ value: e.target.value })}
                                                placeholder="value"
                                              />
                                            </FormField>
                                          )}
                                        </div>
                                        <div className="mt-2 flex items-center gap-2">
                                          <span className="text-[11px] text-ink-faint">then</span>
                                          <Select
                                            className={`${controlClass} w-[150px]`}
                                            value={cond.effect}
                                            onChange={(v: 'disable' | 'hide') => patchCond({ effect: v })}
                                            options={[
                                              { value: 'disable', label: 'Disable button' },
                                              { value: 'hide', label: 'Hide button' },
                                            ]}
                                          />
                                          <span className="text-[11px] text-ink-faint">this button</span>
                                        </div>
                                        {!conditionColumns.length && (
                                          <p className="mt-1.5 text-[11px] text-ink-faint">
                                            Columns load from the query automatically — type the name for now, or run the
                                            preview / resolve variables to pick from a list.
                                          </p>
                                        )}
                                      </>
                                    )
                                  })()}
                              </div>

                              <div className="mt-2 flex items-center gap-2">
                                <span className="text-[10px] text-ink-faint">Preview</span>
                                <Button size="sm" variant={action.variant ?? 'ghost'} icon={PreviewIcon} className="!rounded-[6px] !py-0.5 pointer-events-none">
                                  {action.label?.trim() || 'Run'}
                                </Button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                      {draft.rowActions.length < MAX_TABLE_ROW_ACTIONS && (
                        <TextButton
                          className="mt-2.5"
                          onClick={() => patch({ rowActions: [...draft.rowActions!, { workflowId: '' }] })}
                        >
                          + Add another button
                        </TextButton>
                      )}
                      <p className="mt-2 text-[11px] text-ink-faint">
                        The clicked row is the workflow's input — query nodes can inline values as{' '}
                        <code className="text-ink-dim">{'{{input.column}}'}</code>, JS nodes read{' '}
                        <code className="text-ink-dim">input.column</code>. Include a key column (e.g. id) in the query so
                        the workflow can target the row.
                      </p>
                    </>
                  )
                )}
              </div>
            </div>
          )}

          {activeTab === 'style' &&
            (colorLabels.length > 0 ? (
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
            ) : (
              <p className="text-[11px] text-ink-faint">
                Run the preview to load this chart's series, then pick a color for each.
              </p>
            ))}
        </div>

        {/* Preview is persistent — it stays visible whichever tab is active, and
            collapses to just its header via the chevron to reclaim vertical space. */}
        <div className="border-t border-edge px-5 py-3">
          <div className={`flex items-center justify-between ${previewOpen ? 'mb-2' : ''}`}>
            <button
              type="button"
              onClick={() => setPreviewOpen((o) => !o)}
              aria-expanded={previewOpen}
              className="flex items-center gap-1.5 text-ink-dim hover:text-ink"
            >
              <ChevronDown width={14} height={14} className={`transition-transform ${previewOpen ? '' : '-rotate-90'}`} />
              <span className="text-[11px] font-semibold">Preview</span>
              {!isText && isSample && <Badge tone="faint">Sample data</Badge>}
            </button>
            {!isText && (
              <Button size="sm" icon={PlayIcon} onClick={runPreview} disabled={!draft.query?.trim() || previewing}>
                {previewing ? 'Running…' : 'Run preview'}
              </Button>
            )}
          </div>
          {previewOpen &&
            (isText ? (
              <div className="max-h-[200px] overflow-y-auto rounded-soft border border-edge bg-card p-4">
                <MarkdownText text={draft.text} />
              </div>
            ) : (
              <>
                <div className="h-[200px] overflow-hidden rounded-soft border border-edge bg-card p-3">
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
              </>
            ))}
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
