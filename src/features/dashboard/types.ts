// Shapes of the dashboard `config` blob persisted by the backend
// (POST/PUT /api/connections/:id/dashboards). The server stores it opaquely,
// so these types are the single source of truth for the JSON export format too.

export type WidgetType = 'area' | 'line' | 'bar' | 'pie' | 'table' | 'metric' | 'text' | 'sankey'

// Grid units: rows are fixed-height units (see WidgetGrid). Column count is
// per-breakpoint (see grid.ts GRID_COLS_BP); `lg` is the 12-column base.
export type WidgetLayout = { x: number; y: number; w: number; h: number }

// Responsive breakpoints for the widget grid (react-grid-layout). `lg` is the
// base layout stored in `Widget.layout`; smaller breakpoints keep optional
// overrides in `Widget.layouts` and otherwise inherit/derive from `lg`.
export type Breakpoint = 'lg' | 'md' | 'sm'

/** Button style for a row action; maps to a subset of the shared Button variants. */
export type WidgetRowActionVariant = 'primary' | 'ghost' | 'danger'
export const ROW_ACTION_VARIANTS: WidgetRowActionVariant[] = ['ghost', 'primary', 'danger']

/** Comparison operators for a row-action condition. `empty`/`notEmpty` ignore `value`. */
export type WidgetRowActionOperator = 'eq' | 'ne' | 'empty' | 'notEmpty'
export const ROW_ACTION_OPERATORS: { value: WidgetRowActionOperator; label: string; needsValue: boolean }[] = [
  { value: 'eq', label: 'equals', needsValue: true },
  { value: 'ne', label: 'does not equal', needsValue: true },
  { value: 'empty', label: 'is empty', needsValue: false },
  { value: 'notEmpty', label: 'is not empty', needsValue: false },
]

/** Enable/visibility rule evaluated per row against a column value. When the
 * comparison matches, `effect` is applied to the button; otherwise it stays active. */
export type WidgetRowActionCondition = {
  /** Column name read from the row (as returned by the widget query). */
  column: string
  operator: WidgetRowActionOperator
  /** Compared value for `eq`/`ne`; ignored otherwise. */
  value?: string
  /** What happens when the comparison matches. Defaults to 'disable'. */
  effect: 'disable' | 'hide'
}

/** One per-row "run workflow" button on a `table` widget. The clicked row (as a
 * column→value object) is sent as the workflow's trigger input. */
export type WidgetRowAction = {
  workflowId: string
  /** Snapshot of the workflow's name — display fallback when the id doesn't resolve (import, deleted workflow). */
  workflowName?: string
  /** Button text; defaults to "Run". */
  label?: string
  /** Button style; defaults to 'ghost'. */
  variant?: WidgetRowActionVariant
  /** Icon key into ROW_ACTION_ICONS (lib/rowActionIcons). Omitted = text-only button. */
  icon?: string
  /** Optional per-row enable/visibility rule. Unset = always active. */
  condition?: WidgetRowActionCondition
}

/** Per-row button state from its condition. `row` is the column→value object. */
export function rowActionState(action: WidgetRowAction, row: Record<string, unknown>): { hidden: boolean; disabled: boolean } {
  const c = action.condition
  if (!c || !c.column) return { hidden: false, disabled: false }
  const raw = row[c.column]
  const isEmpty = raw === null || raw === undefined || String(raw) === ''
  let matched: boolean
  switch (c.operator) {
    case 'eq': matched = String(raw ?? '') === (c.value ?? ''); break
    case 'ne': matched = String(raw ?? '') !== (c.value ?? ''); break
    case 'empty': matched = isEmpty; break
    case 'notEmpty': matched = !isEmpty; break
    default: matched = false
  }
  if (!matched) return { hidden: false, disabled: false }
  return { hidden: c.effect === 'hide', disabled: c.effect === 'disable' }
}

/** Cap on row-action buttons per table widget — row width and sanity, not a hard server limit. */
export const MAX_TABLE_ROW_ACTIONS = 3

/** A table widget's row actions, tolerating the pre-list `rowAction` (single object) shape. */
export function widgetRowActions(w: Widget): WidgetRowAction[] {
  return w.rowActions ?? ((w as any).rowAction ? [(w as any).rowAction as WidgetRowAction] : [])
}

export type Widget = {
  id: string
  type: WidgetType
  title: string
  /** SQL powering the widget (every type except `text`). May reference variables as `{{name}}`. */
  query?: string
  /** Markdown-ish body for `text` widgets. */
  text?: string
  /** Optional suffix rendered after a `metric` value (e.g. "ms", "%"). */
  unit?: string
  /** `table` only: rows per page. Unset = no pagination (all rows at once, current behavior). */
  pageSize?: number
  /** `table` only: per-row workflow buttons (max MAX_TABLE_ROW_ACTIONS). */
  rowActions?: WidgetRowAction[]
  /** Per-series/slice color overrides (area/line/bar/pie), in series order. Falls back to the theme palette where unset. */
  colors?: string[]
  /** Base (`lg`) layout — the 12-column grid position. */
  layout: WidgetLayout
  /** Optional per-breakpoint overrides for smaller screens; absent breakpoints derive from `layout`. */
  layouts?: Partial<Record<Exclude<Breakpoint, 'lg'>, WidgetLayout>>
}

export type VariableSource = 'query' | 'static'

export type DashboardVariable = {
  id: string
  /** Referenced in widget SQL as {{name}}. */
  name: string
  /** Optional display label shown above the picker; falls back to name. */
  label?: string
  source: VariableSource
  /** `query` source: first column = value, optional second column = display label. */
  query?: string
  /** `static` source: comma-separated values, e.g. `1, 2, "local"`. */
  values?: string
  defaultValue?: string
  /** When true, the filter lets you pick several values at once; {{name}} then
   *  expands to a SQL list (e.g. `'a','b'` / `1,2`) for use in `IN (...)`. */
  multi?: boolean
}

// A variable's current selection: a single value (single-select) or a list of
// values (multi-select variables). Threaded from the VariableBar into widgets.
export type VariableValues = Record<string, string | string[]>

export type DashboardConfig = { variables: DashboardVariable[]; widgets: Widget[] }

export type DashboardSummary = { id: string; name: string; ts: number; folderId?: string | null }
export type Dashboard = DashboardSummary & { config: DashboardConfig }

// A folder in the dashboards rail. `parentId` builds the tree (null = root);
// nesting is capped at 3 levels (enforced server-side).
export type DashboardFolder = { id: string; name: string; parentId: string | null; ts: number }

// Max folder nesting depth surfaced in the UI (matches the server cap).
export const MAX_DASHBOARD_FOLDER_DEPTH = 3

/** The JSON export/import document (config + name, no ids tied to a server). */
export type DashboardExport = { kind: 'dashboard'; version: 1; name: string; config: DashboardConfig }

export const WIDGET_TYPE_LABEL: Record<WidgetType, string> = {
  area: 'Area Chart',
  line: 'Line Chart',
  bar: 'Bar Chart',
  pie: 'Pie Chart',
  table: 'Table',
  metric: 'Metric',
  text: 'Custom Text',
  sankey: 'Sankey Diagram',
}

export function emptyConfig(): DashboardConfig {
  return { variables: [], widgets: [] }
}

/** Normalize an untrusted parsed config (import path) into a safe DashboardConfig. */
export function sanitizeConfig(raw: any): DashboardConfig {
  const widgets = Array.isArray(raw?.widgets) ? raw.widgets : []
  const variables = Array.isArray(raw?.variables) ? raw.variables : []
  return {
    widgets: widgets
      .filter((w: any) => w && typeof w === 'object' && w.type in WIDGET_TYPE_LABEL)
      .map((w: any, i: number) => ({
        id: typeof w.id === 'string' ? w.id : `w${Date.now()}-${i}`,
        type: w.type,
        title: typeof w.title === 'string' ? w.title : 'Untitled',
        query: typeof w.query === 'string' ? w.query : undefined,
        text: typeof w.text === 'string' ? w.text : undefined,
        unit: typeof w.unit === 'string' ? w.unit : undefined,
        pageSize: Number.isFinite(Number(w.pageSize)) && Number(w.pageSize) > 0 ? clampInt(w.pageSize, 1, 500, 25) : undefined,
        rowActions: sanitizeRowActions(w.rowActions ?? w.rowAction),
        // Kept index-aligned with the series it colors — invalid/missing slots become '' (falls back to the palette), never removed.
        colors: Array.isArray(w.colors)
          ? w.colors.map((c: any) => (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : ''))
          : undefined,
        layout: sanitizeLayout(w.layout, 4, 3),
        layouts: sanitizeLayouts(w.layouts),
      })),
    variables: variables
      .filter((v: any) => v && typeof v === 'object' && typeof v.name === 'string' && v.name.trim())
      .map((v: any, i: number) => ({
        id: typeof v.id === 'string' ? v.id : `v${Date.now()}-${i}`,
        name: v.name.trim(),
        label: typeof v.label === 'string' ? v.label : undefined,
        source: v.source === 'query' ? 'query' : 'static',
        query: typeof v.query === 'string' ? v.query : undefined,
        values: typeof v.values === 'string' ? v.values : undefined,
        defaultValue: typeof v.defaultValue === 'string' ? v.defaultValue : undefined,
        multi: v.multi === true,
      })),
  }
}

function sanitizeRowActionCondition(raw: any): WidgetRowActionCondition | undefined {
  if (!raw || typeof raw !== 'object' || typeof raw.column !== 'string' || !raw.column.trim()) return undefined
  const operator = ROW_ACTION_OPERATORS.some((o) => o.value === raw.operator) ? raw.operator : 'eq'
  return {
    column: raw.column,
    operator,
    value: typeof raw.value === 'string' ? raw.value : undefined,
    effect: raw.effect === 'hide' ? 'hide' : 'disable',
  }
}

// Accepts a list or the legacy single-object `rowAction` shape.
function sanitizeRowActions(raw: any): WidgetRowAction[] | undefined {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : []
  const out = list
    .filter((a: any) => a && typeof a === 'object' && typeof a.workflowId === 'string' && a.workflowId.trim())
    .slice(0, MAX_TABLE_ROW_ACTIONS)
    .map((a: any) => ({
      workflowId: a.workflowId,
      workflowName: typeof a.workflowName === 'string' ? a.workflowName : undefined,
      label: typeof a.label === 'string' ? a.label : undefined,
      variant: ROW_ACTION_VARIANTS.includes(a.variant) ? a.variant : undefined,
      // Any string is kept; an unknown key just renders text-only (see rowActionIcon).
      icon: typeof a.icon === 'string' && a.icon ? a.icon : undefined,
      condition: sanitizeRowActionCondition(a.condition),
    }))
  return out.length ? out : undefined
}

function clampInt(v: any, min: number, max: number, fallback: number) {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

// Bounds match the 12-column `lg` base; react-grid-layout corrects/compacts to
// each smaller breakpoint's column count on render, so clamping to 12 is safe.
function sanitizeLayout(l: any, defW: number, defH: number): WidgetLayout {
  return {
    x: clampInt(l?.x, 0, 11, 0),
    y: clampInt(l?.y, 0, 10000, 0),
    w: clampInt(l?.w, 1, 12, defW),
    h: clampInt(l?.h, 1, 100, defH),
  }
}

function sanitizeLayouts(raw: any): Widget['layouts'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out: NonNullable<Widget['layouts']> = {}
  for (const bp of ['md', 'sm'] as const) {
    if (raw[bp] && typeof raw[bp] === 'object') out[bp] = sanitizeLayout(raw[bp], 4, 3)
  }
  return Object.keys(out).length ? out : undefined
}
