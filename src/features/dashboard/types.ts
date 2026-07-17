// Shapes of the dashboard `config` blob persisted by the backend
// (POST/PUT /api/connections/:id/dashboards). The server stores it opaquely,
// so these types are the single source of truth for the JSON export format too.

export type WidgetType = 'area' | 'line' | 'bar' | 'pie' | 'table' | 'metric' | 'text' | 'sankey'

// Grid units: 12 columns wide, rows are fixed-height units (see WidgetGrid).
export type WidgetLayout = { x: number; y: number; w: number; h: number }

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
  /** Per-series/slice color overrides (area/line/bar/pie), in series order. Falls back to the theme palette where unset. */
  colors?: string[]
  layout: WidgetLayout
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
}

export type DashboardConfig = { variables: DashboardVariable[]; widgets: Widget[] }

export type DashboardSummary = { id: string; name: string; ts: number }
export type Dashboard = DashboardSummary & { config: DashboardConfig }

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
        // Kept index-aligned with the series it colors — invalid/missing slots become '' (falls back to the palette), never removed.
        colors: Array.isArray(w.colors)
          ? w.colors.map((c: any) => (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : ''))
          : undefined,
        layout: {
          x: clampInt(w.layout?.x, 0, 11, 0),
          y: clampInt(w.layout?.y, 0, 10000, 0),
          w: clampInt(w.layout?.w, 1, 12, 4),
          h: clampInt(w.layout?.h, 1, 100, 3),
        },
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
      })),
  }
}

function clampInt(v: any, min: number, max: number, fallback: number) {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}
