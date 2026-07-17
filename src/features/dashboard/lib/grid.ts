// Layout math for the widget grid: 12 columns, fixed-height rows, free
// placement (no auto-compaction, like New Relic) with hard collision checks —
// two widgets can never overlap.

import type { Widget, WidgetLayout } from '../types'

export const GRID_COLS = 12
export const GRID_ROW_H = 44
export const GRID_GAP = 10

export function collides(a: WidgetLayout, b: WidgetLayout): boolean {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y)
}

export function fits(candidate: WidgetLayout, others: WidgetLayout[]): boolean {
  if (candidate.x < 0 || candidate.y < 0 || candidate.x + candidate.w > GRID_COLS) return false
  return !others.some((o) => collides(candidate, o))
}

/** First free slot (row-major scan) for a w×h widget — used for add/duplicate/import. */
export function findFreeSlot(widgets: Widget[], w: number, h: number): WidgetLayout {
  const others = widgets.map((x) => x.layout)
  const maxY = others.reduce((m, l) => Math.max(m, l.y + l.h), 0)
  for (let y = 0; y <= maxY; y++) {
    for (let x = 0; x <= GRID_COLS - w; x++) {
      const candidate = { x, y, w, h }
      if (fits(candidate, others)) return candidate
    }
  }
  return { x: 0, y: maxY, w, h }
}
