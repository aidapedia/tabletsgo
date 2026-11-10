import NumberStepper from '@/shared/ui/form/NumberStepper'
import {
  METRIC_AGGREGATES,
  NUMBER_FORMATS,
  type MetricAggregate,
  type NumberFormat,
  type Widget,
  type WidgetMetric,
} from '../types'
import { RATE_SAMPLE_MS } from '../lib/metric'
import ThresholdsEditor from './ThresholdsEditor'
import OptionSelect from '@/shared/ui/form/OptionSelect'
import { FormField } from '@/shared/ui/form/FormField'
import { Input } from '@/shared/ui/input'

// The `metric` widget's Format tab: how the result becomes one value, how that
// value reads, and its thresholds (see ThresholdsEditor), each step with its
// own color and caption.
export default function MetricEditor({
  widget,
  onChange,
  queryColumns,
}: {
  widget: Widget
  onChange: (fields: Partial<Widget>) => void
  /** Columns the query returns — empty until it has run once. */
  queryColumns: string[]
}) {
  const m = widget.metric ?? {}
  const patch = (f: Partial<WidgetMetric>) => {
    const next = { ...m, ...f }
    onChange({ metric: Object.values(next).some((v) => v !== undefined) ? next : undefined })
  }
  const agg = m.aggregate ?? 'first'
  const countsRows = agg === 'count' && !m.column

  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        <FormField label="Value" className="w-[170px]">
          <OptionSelect
            
            value={agg}
            onChange={(v: MetricAggregate) => patch({ aggregate: v === 'first' ? undefined : v })}
            options={METRIC_AGGREGATES}
          />
        </FormField>
        <FormField
          label="Of column"
          className="flex-1"
          help={
            agg === 'count'
              ? 'Count rows — or, with a column, the rows where it is set (true, non-zero, non-empty).'
              : agg === 'rate'
                ? `The column is summed, then re-read every ${RATE_SAMPLE_MS / 1000} s; the value is how fast that sum grows per second.`
                : undefined
          }
        >
          {queryColumns.length ? (
            <OptionSelect
              
              value={m.column ?? ''}
              onChange={(v: string) => patch({ column: v || undefined })}
              options={[{ value: '', label: agg === 'count' ? 'Every row' : 'First column' }, ...queryColumns.map((c) => ({ value: c, label: c }))]}
            />
          ) : (
            <Input value={m.column ?? ''} onChange={(e) => patch({ column: e.target.value || undefined })} placeholder={countsRows ? 'every row' : 'first column'} />
          )}
        </FormField>
        <FormField label="Look" className="w-[150px]">
          <OptionSelect
            
            value={m.variant ?? 'hero'}
            onChange={(v: 'hero' | 'tile') => patch({ variant: v === 'tile' ? 'tile' : undefined })}
            options={[
              { value: 'hero', label: 'Big number' },
              { value: 'tile', label: 'Stat tile' },
            ]}
          />
        </FormField>
      </div>

      <div className="flex gap-3">
        <FormField label="Format" className="w-[170px]">
          <OptionSelect
            
            value={m.format ?? 'number'}
            onChange={(v: NumberFormat) => patch({ format: v === 'number' ? undefined : v })}
            options={NUMBER_FORMATS}
          />
        </FormField>
        <FormField label="Decimals" className="w-[110px]">
          <NumberStepper ariaLabel="Decimals" allowNull min={0} max={6} value={m.decimals ?? null} onChange={(n) => patch({ decimals: n ?? undefined })} />
        </FormField>
        <FormField label="Unit" className="flex-1" help="Shown after the value, e.g. “ms”, “%”, “msg/s”.">
          <Input value={widget.unit ?? ''} onChange={(e) => onChange({ unit: e.target.value })} placeholder="ms, %…" />
        </FormField>
      </div>

      <div className="rounded-lg border border-border bg-card p-3">
        <ThresholdsEditor
          captions
          value={m.thresholds}
          onChange={(thresholds) => patch({ thresholds })}
          help={
            <>
              The value takes the color and caption of the highest step it reaches; below every step it uses the base. A
              color tints the whole widget. Captions can use {'{{variable}}'} placeholders.
            </>
          }
        />
      </div>
    </div>
  )
}
