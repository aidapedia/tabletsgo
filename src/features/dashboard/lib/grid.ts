// Layout config + placement helper for the widget grid. Rendering, drag and
// resize are handled by react-grid-layout (WidgetGrid), configured for free
// placement (no auto-compaction, no overlap); this module owns the shared grid
// constants and the "first free slot" search used when adding, duplicating or
// importing widgets.

import type { Breakpoint, Widget, WidgetLayout } from '../types'

export const GRID_COLS = 12 // `lg` base column count (see GRID_COLS_BP)
export const GRID_ROW_H = 44
export const GRID_GAP = 10
export const GRID_PAD = 10 // container padding (RGL containerPadding)

// react-grid-layout responsive breakpoints (min container width → cols). `lg`
// is the 12-column base layout stored on each widget; md/sm keep optional
// overrides and otherwise derive from `lg`. xs/xxs are phone breakpoints — not
// stored per-widget; RGL auto-generates their layouts from `sm`, bounds-corrected
// down to 4/1 columns so widgets stack (near) full-width on small screens.
export type RglBreakpoint = Breakpoint | 'xs' | 'xxs'
export const BREAKPOINTS: Record<RglBreakpoint, number> = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }
export const GRID_COLS_BP: Record<RglBreakpoint, number> = { lg: GRID_COLS, md: 10, sm: 6, xs: 4, xxs: 1 }
export const isStoredBp = (bp: RglBreakpoint): bp is Breakpoint => bp === 'lg' || bp === 'md' || bp === 'sm'

export function collides(a: WidgetLayout, b: WidgetLayout): boolean {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y)
}

export function fits(candidate: WidgetLayout, others: WidgetLayout[], cols: number = GRID_COLS): boolean {
  if (candidate.x < 0 || candidate.y < 0 || candidate.x + candidate.w > cols) return false
  return !others.some((o) => collides(candidate, o))
}

/** Grid cell (col/row) under a client point, for placing a right-click-added widget. */
export function cellFromPoint(gridEl: HTMLElement, clientX: number, clientY: number, cols: number = GRID_COLS): { x: number; y: number } {
  const rect = gridEl.getBoundingClientRect()
  const colW = (gridEl.clientWidth - 2 * GRID_PAD - (cols - 1) * GRID_GAP) / cols
  const x = Math.floor((clientX - rect.left - GRID_PAD) / (colW + GRID_GAP))
  const y = Math.floor((clientY - rect.top - GRID_PAD) / (GRID_ROW_H + GRID_GAP))
  return { x: Math.max(0, x), y: Math.max(0, y) }
}

/** The requested x,y for a w×h widget if it fits there, else the first free slot. */
export function slotAtOrFree(widgets: Widget[], w: number, h: number, x: number, y: number, cols: number = GRID_COLS): WidgetLayout {
  const candidate = { x: Math.min(Math.max(0, x), cols - w), y: Math.max(0, y), w, h }
  if (fits(candidate, widgets.map((wd) => wd.layout), cols)) return candidate
  return findFreeSlot(widgets, w, h)
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
