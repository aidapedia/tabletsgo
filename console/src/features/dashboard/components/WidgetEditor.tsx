import { sqlDialectOf } from '@/shared/lib/sqlDialect'
import { useEffect, useMemo, useState } from 'react'
import NumberStepper from '@/shared/ui/form/NumberStepper'
import Tab from '@/shared/ui/navigation/Tab'
import { listWorkflows, type WorkflowSummary } from '@/features/workflow'
import SqlEditor from '@/shared/ui/SqlEditor'
import Popover from '@/shared/ui/overlay/Popover'
import { ChevronDown, PlayIcon, TrashIcon } from '@/shared/ui/icons'
import { runQuery } from '@/shared/api/database'
import type {
  DashboardVariable,
  VariableValues,
  Widget,
  WidgetRowAction,
  WidgetRowActionCondition,
  WidgetRowActionOperator,
  WidgetRowActionVariant,
  WidgetType,
} from '../types'
import { DEFAULT_TABLE_PAGE_SIZE, MAX_TABLE_PAGE_SIZE, MAX_TABLE_ROW_ACTIONS, TABLE_PAGE_SIZES, ROW_ACTION_OPERATORS, ROW_ACTION_BUTTON, ROW_ACTION_VARIANTS, WIDGET_TYPE_LABEL, widgetRowActions } from '../types'
import { ROW_ACTION_ICONS, ROW_ACTION_ICON_KEYS, rowActionIcon } from '../lib/rowActionIcons'
import { referencedVariables, substituteVariables, isVariableSet } from '../lib/variables'
import { sampleResult } from '../lib/sampleData'
import { WIDGET_GUIDE } from '../lib/widgetGuide'
import { toXYSeries, toPieData, type QueryResult } from '../lib/queryData'
import { useChartPalette, MAX_SERIES } from '../lib/palette'
import WidgetChart from './WidgetChart'
import MarkdownText from './MarkdownText'
import ShapeGuide from './ShapeGuide'
import ColorSwatch from './ColorSwatch'
import ColumnsEditor from './ColumnsEditor'
import MetricEditor from './MetricEditor'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { Switch } from '@/shared/ui/switch'
import OptionSelect from '@/shared/ui/form/OptionSelect'
import { FormField } from '@/shared/ui/form/FormField'
import { Textarea } from '@/shared/ui/textarea'
import { Input } from '@/shared/ui/input'
import { Dialog, DialogContent, DialogTitle } from '@/shared/ui/dialog'

const COLORABLE: WidgetType[] = ['area', 'line', 'bar', 'pie']

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
          className="flex h-[34px] w-[42px] items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground hover:text-foreground"
        >
          {Current ? <Current width={15} height={15} /> : <span className="text-[10px] text-faint">None</span>}
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
              className={`flex h-8 w-8 items-center justify-center rounded-lg text-[9px] text-faint hover:bg-accent ${!value ? 'ring-1 ring-primary' : ''}`}
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
                  className={`flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground ${value === key ? 'ring-1 ring-primary text-foreground' : ''}`}
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
  variableValues: VariableValues
  onSave: (w: Widget) => void
  onClose: () => void
}) {
  // Normalize the legacy single `rowAction` shape into the `rowActions` list on open.
  const [draft, setDraft] = useState<Widget>(() => {
    const { rowAction: _legacy, ...rest } = widget as any
    const actions = widgetRowActions(widget)
    return { ...rest, rowActions: actions.length ? actions : undefined }
  })
  // A size outside the list opens on "Custom…"; picking it keeps the stepper up
  // even when the number typed happens to be one of the listed sizes.
  const [customPageSize, setCustomPageSize] = useState(() => !!draft.pageSize && !TABLE_PAGE_SIZES.includes(draft.pageSize))
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
  // Columns offered to the column, metric and row-action condition pickers. A
  // run preview provides them for free; otherwise fetch them by running the
  // query once (a one-row page) so each picker is a proper single-select
  // without forcing a manual "Run preview".
  const [fetched, setFetched] = useState<QueryResult | null>(null)
  const columnSource = preview?.columns?.length ? preview : fetched
  const queryColumns = columnSource?.columns ?? []
  const hasRowActions = isTable && !!draft.rowActions?.length
  const needsColumns = hasRowActions || activeTab === 'table' || activeTab === 'format'
  useEffect(() => {
    if (!needsColumns || preview?.columns?.length) return
    const q = draft.query?.trim()
    if (!q) return
    // Same rule as WidgetCard: don't run until every referenced {{variable}} is resolved.
    if (referencedVariables(draft.query).some((n) => !isVariableSet(variableValues[n]))) return
    let alive = true
    runQuery(conn, substituteVariables(q, variableValues, sqlDialectOf(conn?.type)), { page: { limit: 1, offset: 0 } }).then((r: QueryResult) => {
      if (alive && r?.columns?.length) setFetched(r)
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsColumns, draft.query, variableValues, preview?.columns, conn?.id])
  const sampleRow = useMemo(() => {
    const row = columnSource?.rows?.[0]
    if (!row) return undefined
    const cols = columnSource!.columns ?? []
    return Array.isArray(row) ? Object.fromEntries(cols.map((c, j) => [c, row[j]])) : row
  }, [columnSource])

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
    const r = (await runQuery(conn, substituteVariables(draft.query, variableValues, sqlDialectOf(conn?.type)))) as QueryResult
    setPreview(r)
    setPreviewing(false)
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} aria-describedby={undefined} className="flex max-h-[90vh] sm:max-w-[760px] flex-col p-0 gap-0">
        <DialogTitle className="sr-only">Edit widget</DialogTitle>
        <div className="border-b border-border px-5 py-4 text-sm font-bold text-foreground">
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
              <OptionSelect
              
                value={draft.type}
                onChange={(type: WidgetType) => {
                  setPreview(null)
                  // Row actions and columns are table-only, the value settings metric-only — drop them when the type changes.
                  patch({
                    type,
                    ...(type !== 'table' ? { rowActions: undefined, tableColumns: undefined } : null),
                    ...(type !== 'metric' ? { metric: undefined } : null),
                  })
                }}
                options={TYPE_OPTIONS}
              />
            </FormField>
          </div>
        </div>

        {/* Tab bar — only shown when there's more than one tab to switch between. */}
        {tabs.length > 1 && (
          <div className="mt-3 flex gap-4 border-b border-border px-5">
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
                        <code key={v.id} className="text-muted-foreground">
                          {i > 0 && ', '}
                          {`{{${v.name}}}`}
                        </code>
                      ))}
                    </>
                  ) : undefined
                }
              >
                <div className="overflow-hidden rounded-lg border border-border">
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

          {activeTab === 'format' && <MetricEditor widget={draft} onChange={patch} queryColumns={queryColumns} />}

          {activeTab === 'table' && (
            <div className="space-y-3">
              <FormField
                label="Rows per page"
                help="Paginated tables fetch one page at a time — pages stay stable when the query returns rows in a fixed order."
              >
                <div className="flex items-center gap-2">
                  <OptionSelect
                    className="!w-[220px] shrink-0"
                    value={customPageSize ? 'custom' : String(draft.pageSize || DEFAULT_TABLE_PAGE_SIZE)}
                    onChange={(v: string) => {
                      setCustomPageSize(v === 'custom')
                      if (v === 'custom') patch({ pageSize: draft.pageSize || DEFAULT_TABLE_PAGE_SIZE })
                      else patch({ pageSize: Number(v) })
                    }}
                    options={[
                      ...TABLE_PAGE_SIZES.map((n) => ({ value: String(n), label: `${n} rows` })),
                      { value: 'custom', label: 'Custom…' },
                    ]}
                  />
                  {customPageSize && (
                    <NumberStepper
                      className="w-[110px]"
                      ariaLabel="Rows per page"
                      autoFocus
                      min={1}
                      max={MAX_TABLE_PAGE_SIZE}
                      value={draft.pageSize ?? DEFAULT_TABLE_PAGE_SIZE}
                      onChange={(n) => patch({ pageSize: n ?? DEFAULT_TABLE_PAGE_SIZE })}
                    />
                  )}
                </div>
              </FormField>

              <ColumnsEditor
                value={draft.tableColumns}
                onChange={(tableColumns) => patch({ tableColumns })}
                queryColumns={queryColumns}
                sampleRow={sampleRow}
              />

              <div className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-semibold text-foreground">Row action buttons</div>
                    <div className="mt-0.5 text-[11px] text-faint">
                      Adds buttons to every row that run a workflow with that row as its input.
                    </div>
                  </div>
                  <Switch
                    checked={!!draft.rowActions}
                    disabled={workflows?.length === 0}
                    aria-label="Row action buttons"
                    onCheckedChange={(on) => patch({ rowActions: on ? [{ workflowId: '' }] : undefined })}
                  />
                </div>
                {workflows?.length === 0 ? (
                  <p className="mt-2 text-[11px] text-faint">
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
                            <div key={i} className="rounded-lg border border-border bg-muted/40 p-2.5">
                              <div className="flex items-end gap-2">
                                <FormField label="Workflow" className="flex-1">
                                  <OptionSelect
                                  
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
                                <Button variant="ghost" size="icon-sm"
                                  aria-label="Remove action"
                                  onClick={() => {
                                    const next = draft.rowActions!.filter((_, j) => j !== i)
                                    patch({ rowActions: next.length ? next : undefined })
                                  }}
                                >
                                  <TrashIcon width={14} height={14} />
                                </Button>
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
                                  <OptionSelect
                                  
                                    value={action.variant ?? 'ghost'}
                                    onChange={(v: WidgetRowActionVariant) => patchAction({ variant: v })}
                                    options={VARIANT_OPTIONS}
                                  />
                                </FormField>
                                <FormField label="Icon">
                                  <IconPicker value={action.icon} onChange={(icon) => patchAction({ icon })} />
                                </FormField>
                              </div>
                              <div className="mt-2 border-t border-border/60 pt-2">
                                <div className="flex items-center justify-between">
                                  <span className="text-[11px] text-muted-foreground">Only active on a condition</span>
                                  <Switch
                                    checked={!!action.condition}
                                    aria-label="Conditional button"
                                    onCheckedChange={(on) =>
                                      patchAction({
                                        condition: on ? { column: queryColumns[0] ?? '', operator: 'eq', effect: 'disable' } : undefined,
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
                                            {queryColumns.length ? (
                                              <OptionSelect
                                              
                                                value={cond.column}
                                                placeholder="Pick a column…"
                                                onChange={(v: string) => patchCond({ column: v })}
                                                options={queryColumns.map((c) => ({ value: c, label: c }))}
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
                                            <OptionSelect
                                            
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
                                          <span className="text-[11px] text-faint">then</span>
                                          <OptionSelect
                                            className="w-[150px]"
                                            value={cond.effect}
                                            onChange={(v: 'disable' | 'hide') => patchCond({ effect: v })}
                                            options={[
                                              { value: 'disable', label: 'Disable button' },
                                              { value: 'hide', label: 'Hide button' },
                                            ]}
                                          />
                                          <span className="text-[11px] text-faint">this button</span>
                                        </div>
                                        {!queryColumns.length && (
                                          <p className="mt-1.5 text-[11px] text-faint">
                                            Columns load from the query automatically — type the name for now, or run the
                                            preview / resolve variables to pick from a list.
                                          </p>
                                        )}
                                      </>
                                    )
                                  })()}
                              </div>

                              <div className="mt-2 flex items-center gap-2">
                                <span className="text-[10px] text-faint">Preview</span>
                                <Button size="sm" variant={ROW_ACTION_BUTTON[action.variant ?? 'ghost']} className="!rounded-[6px] !py-0.5 pointer-events-none">
                                  <PreviewIcon width={15} height={15} />
                                  {action.label?.trim() || 'Run'}
                                </Button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                      {draft.rowActions.length < MAX_TABLE_ROW_ACTIONS && (
                        <Button variant="link" size="inline" type="button"
                          className="text-muted-foreground hover:text-foreground mt-2.5"
                          onClick={() => patch({ rowActions: [...draft.rowActions!, { workflowId: '' }] })}
                        >
                          + Add another button
                        </Button>
                      )}
                      <p className="mt-2 text-[11px] text-faint">
                        The clicked row is the workflow's input — query nodes can inline values as{' '}
                        <code className="text-muted-foreground">{'{{input.column}}'}</code>, JS nodes read{' '}
                        <code className="text-muted-foreground">input.column</code>. Include a key column (e.g. id) in the query so
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
                  <span className="text-[11px] font-semibold text-muted-foreground">Colors</span>
                  {draft.colors?.some(Boolean) && (
                    <Button variant="link" size="inline" type="button" className="text-muted-foreground hover:text-foreground" onClick={() => patch({ colors: undefined })}>Reset all</Button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {colorLabels.map((label, i) => {
                    const custom = draft.colors?.[i]
                    const color = custom || palette.series[i]
                    return (
                      <div
                        key={`${label}-${i}`}
                        className="flex items-center gap-1.5 rounded-lg border border-border bg-card py-1 pl-1 pr-2"
                      >
                        <ColorSwatch color={color} onChange={(c) => setColor(i, c)} />
                        <span className="max-w-[110px] truncate text-[11px] text-muted-foreground">{label}</span>
                        {custom && (
                          <button
                            type="button"
                            className="text-[11px] text-faint hover:text-foreground"
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
              <p className="text-[11px] text-faint">
                Run the preview to load this chart's series, then pick a color for each.
              </p>
            ))}
        </div>

        {/* Preview is persistent — it stays visible whichever tab is active, and
            collapses to just its header via the chevron to reclaim vertical space. */}
        <div className="border-t border-border px-5 py-3">
          <div className={`flex items-center justify-between ${previewOpen ? 'mb-2' : ''}`}>
            <button
              type="button"
              onClick={() => setPreviewOpen((o) => !o)}
              aria-expanded={previewOpen}
              className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
            >
              <ChevronDown width={14} height={14} className={`transition-transform ${previewOpen ? '' : '-rotate-90'}`} />
              <span className="text-[11px] font-semibold">Preview</span>
              {!isText && isSample && <Badge variant="faint">Sample data</Badge>}
            </button>
            {!isText && (
              <Button variant="outline" size="sm" onClick={runPreview} disabled={!draft.query?.trim() || previewing}>
                <PlayIcon width={15} height={15} />
                {previewing ? 'Running…' : 'Run preview'}
              </Button>
            )}
          </div>
          {previewOpen &&
            (isText ? (
              <div className="max-h-[200px] overflow-y-auto rounded-lg border border-border bg-card p-4">
                <MarkdownText text={draft.text} />
              </div>
            ) : (
              <>
                <div className="h-[200px] overflow-hidden rounded-lg border border-border bg-card p-3">
                  {preview?.error ? (
                    <div className="overflow-y-auto whitespace-pre-wrap break-words text-[11px] text-destructive">{preview.error}</div>
                  ) : (
                    shown && (
                      <div className={`h-full ${isSample ? 'opacity-70' : ''}`}>
                        <WidgetChart widget={draft} result={shown} values={variableValues} />
                      </div>
                    )
                  )}
                </div>
                {isSample && !preview?.error && (
                  <p className="mt-1.5 text-[11px] text-faint">
                    Showing what a {WIDGET_TYPE_LABEL[draft.type].toLowerCase()} looks like — run the query to preview your
                    own data. {WIDGET_GUIDE[draft.type].hint}
                  </p>
                )}
              </>
            ))}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="default" size="sm" disabled={!canSave} onClick={() => onSave({ ...draft, title: draft.title.trim() })}>
            Save widget
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
