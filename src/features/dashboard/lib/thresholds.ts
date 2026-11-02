// Thresholds, shared by metric widgets and table columns: which step a value
// falls in, and what that step's color does — a tinted card and colored text
// for a metric, colored text or a bar's fill for a cell. Theme tones are
// classes (so they follow light/dark); a custom `#rrggbb` is inline style with
// the same alphas. Neutral leaves everything untouched.

import type { CSSProperties } from 'react'
import type { Threshold, ThresholdTone } from '../types'
import { toNumber } from './format'

/** The step a value falls in: the highest step it reached, else the base. */
export function activeStep<T extends Threshold>(value: unknown, thresholds: T[] = []): T | null {
  const base = thresholds.find((t) => t.from === undefined) ?? null
  const n = toNumber(value)
  if (n === null) return base
  return thresholds.reduce<T | null>(
    (hit, t) => (t.from !== undefined && n >= t.from && (hit?.from === undefined || t.from >= hit.from) ? t : hit),
    base
  )
}

const TONES: Record<Exclude<ThresholdTone, 'neutral'>, { card: string; text: string; fill: string }> = {
  green: { card: 'border-green/30 bg-green/5', text: 'text-green-bright', fill: 'bg-green' },
  amber: { card: 'border-amber/30 bg-amber/5', text: 'text-amber', fill: 'bg-amber' },
  red: { card: 'border-red/30 bg-red/5', text: 'text-red', fill: 'bg-red' },
}

export type ThresholdLook = {
  tinted: boolean
  cardClass: string
  cardStyle?: CSSProperties
  textClass: string
  textStyle?: CSSProperties
  /** A solid fill — a cell's bar, the editor's swatch. */
  fillClass: string
  fillStyle?: CSSProperties
}

export function thresholdLook(color?: string): ThresholdLook {
  if (!color || color === 'neutral') return { tinted: false, cardClass: 'border-edge bg-card', textClass: '', fillClass: '' }
  const tone = TONES[color as keyof typeof TONES]
  if (tone) return { tinted: true, cardClass: tone.card, textClass: tone.text, fillClass: tone.fill }
  return {
    tinted: true,
    cardClass: '',
    // #rrggbb + alpha: 30% border, 5% fill — the tones' own mix.
    cardStyle: { borderColor: `${color}4d`, background: `${color}0d` },
    textClass: '',
    textStyle: { color },
    fillClass: '',
    fillStyle: { background: color },
  }
}

/** The dot that stands for a threshold color in the editor. */
export function swatchLook(color?: string): { className: string; style?: CSSProperties } {
  const look = thresholdLook(color)
  return look.tinted ? { className: look.fillClass, style: look.fillStyle } : { className: 'bg-ink-faint' }
}
