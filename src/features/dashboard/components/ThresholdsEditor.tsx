import type { ReactNode } from 'react'
import NumberStepper from '@/shared/ui/form/NumberStepper'
import TextButton from '@/shared/ui/buttons/TextButton'
import IconButton from '@/shared/ui/buttons/IconButton'
import HelpTip from '@/shared/ui/HelpTip'
import { Input } from '@/shared/ui/form/Input'
import { TrashIcon } from '@/shared/ui/icons'
import type { MetricThreshold } from '../types'
import ColorSwatch from './ColorSwatch'

// Colors offered to each new step in turn — the usual "getting worse" ramp.
const NEXT_COLOR = ['amber', 'red', 'green']

// A thresholds list: the base step, then any number of "from this value up"
// steps, each with a color — and, with `captions`, a caption. Shared by the
// metric's Format tab and each table column. The caller frames it.
export default function ThresholdsEditor({
  value,
  onChange,
  captions = false,
  help,
}: {
  value?: MetricThreshold[]
  onChange: (thresholds: MetricThreshold[] | undefined) => void
  captions?: boolean
  help: ReactNode
}) {
  // Base first, then the steps by ascending `from` — the order they apply in.
  const base: MetricThreshold = value?.find((t) => t.from === undefined) ?? {}
  const steps = (value ?? []).filter((t) => t.from !== undefined)
  const set = (b: MetricThreshold, s: MetricThreshold[]) => {
    const sorted = [...s].sort((x, y) => x.from! - y.from!)
    const empty = !sorted.length && !b.color && !b.caption
    onChange(empty ? undefined : [b, ...sorted])
  }
  const patchStep = (i: number, f: Partial<MetricThreshold>) => set(base, steps.map((t, j) => (j === i ? { ...t, ...f } : t)))
  const addStep = () => {
    const last = steps[steps.length - 1]?.from
    set(base, [...steps, { from: last === undefined ? 1 : last + 1, color: NEXT_COLOR[steps.length % NEXT_COLOR.length] }])
  }
  const color = (c: string) => (c === 'neutral' ? undefined : c)

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-ink">
          Thresholds
          <HelpTip>{help}</HelpTip>
        </div>
        <TextButton onClick={addStep}>+ Add threshold</TextButton>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <ColorSwatch tones color={base.color ?? 'neutral'} onChange={(c) => set({ ...base, color: color(c) }, steps)} />
          <span className="w-[110px] shrink-0 text-[11px] font-semibold text-ink-dim">Base</span>
          {captions ? (
            <Input
              className="flex-1"
              value={base.caption ?? ''}
              onChange={(e) => set({ ...base, caption: e.target.value || undefined }, steps)}
              placeholder="Caption, e.g. every replica in sync"
            />
          ) : (
            <span className="flex-1 text-[11px] text-ink-faint">Below every step</span>
          )}
          {/* Keeps the base row aligned with the steps' (which have a delete button). */}
          {steps.length > 0 && <span className="w-[30px] shrink-0" />}
        </div>

        {steps.map((t, i) => (
          <div key={i} className="flex items-center gap-2">
            <ColorSwatch tones color={t.color ?? 'neutral'} onChange={(c) => patchStep(i, { color: color(c) })} />
            <div className="flex w-[110px] shrink-0 items-center gap-1.5">
              <span className="text-[12px] text-ink-faint">≥</span>
              <NumberStepper
                className="min-w-0 flex-1"
                ariaLabel="From value"
                min={-Number.MAX_SAFE_INTEGER}
                value={t.from ?? 0}
                onChange={(n) => patchStep(i, { from: n ?? 0 })}
              />
            </div>
            {captions ? (
              <Input
                className="flex-1"
                value={t.caption ?? ''}
                onChange={(e) => patchStep(i, { caption: e.target.value || undefined })}
                placeholder={[base, ...steps.slice(0, i)].reverse().find((s) => s.caption)?.caption ?? 'Caption'}
              />
            ) : (
              <span className="flex-1" />
            )}
            <IconButton aria-label="Remove threshold" onClick={() => set(base, steps.filter((_, j) => j !== i))}>
              <TrashIcon width={14} height={14} />
            </IconButton>
          </div>
        ))}
      </div>
    </div>
  )
}
