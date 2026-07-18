import { useRef, type ReactNode } from 'react'
import { Responsive, WidthProvider, type Layout } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import type { Breakpoint, Widget, WidgetLayout } from '../types'
import { BREAKPOINTS, GRID_COLS_BP, GRID_GAP, GRID_PAD, GRID_ROW_H, fits, isStoredBp, type RglBreakpoint } from '../lib/grid'

const ResponsiveGridLayout = WidthProvider(Responsive)

const PAD = GRID_PAD // container padding
const MIN_W = 2
const MIN_H = 2

export type LayoutUpdate = { id: string; layout: WidgetLayout }

// The layout to seed react-grid-layout with for a given breakpoint: an explicit
// per-breakpoint override if the user has dragged this widget at that size,
// otherwise the `lg` base (which RGL bounds-corrects to fit the breakpoint's
// column count).
const bpLayout = (w: Widget, bp: Breakpoint): WidgetLayout => (bp === 'lg' ? w.layout : w.layouts?.[bp] ?? w.layout)

const toItems = (widgets: Widget[], bp: Breakpoint): Layout[] =>
  widgets.map((w) => ({ i: w.id, ...bpLayout(w, bp), minW: MIN_W, minH: MIN_H }))

const clientPoint = (e: MouseEvent | TouchEvent): { x: number; y: number } | null => {
  if ('clientX' in e && typeof e.clientX === 'number') return { x: e.clientX, y: e.clientY }
  const t = (e as TouchEvent).changedTouches?.[0]
  return t ? { x: t.clientX, y: t.clientY } : null
}

// The id of the widget sitting under the drop point (the one visually beneath
// the dragged card), or null when over empty space. `elementsFromPoint` returns
// painted elements top-to-bottom; the dragged card is on top (z-20), so the
// first `[data-widget-id]` that isn't the dragged one is the swap target. The
// preview only translates a target's inner card — the positioned grid cell
// (which carries data-widget-id) stays put — so detection stays stable mid-drag.
const targetUnderPoint = (e: MouseEvent | TouchEvent, draggedId: string): string | null => {
  const p = clientPoint(e)
  if (!p) return null
  for (const el of document.elementsFromPoint(p.x, p.y)) {
    const item = (el as HTMLElement).closest?.('[data-widget-id]')
    const id = item?.getAttribute('data-widget-id')
    if (id && id !== draggedId) return id
  }
  return null
}

// Would swapping `dragged` (at oldItem) with `target` keep the layout legal?
const swapFits = (widgets: Widget[], oldItem: Layout, target: Widget, bp: Breakpoint, cols: number) => {
  const tO = bpLayout(target, bp)
  const draggedNew: WidgetLayout = { x: tO.x, y: tO.y, w: oldItem.w, h: oldItem.h }
  const targetNew: WidgetLayout = { x: oldItem.x, y: oldItem.y, w: tO.w, h: tO.h }
  const others = widgets.filter((w) => w.id !== oldItem.i && w.id !== target.id).map((w) => bpLayout(w, bp))
  const ok = fits(draggedNew, [targetNew, ...others], cols) && fits(targetNew, [draggedNew, ...others], cols)
  return ok ? { draggedNew, targetNew } : null
}

// Responsive 12-column widget grid backed by react-grid-layout. Free placement
// (compactType=null): widgets stay exactly where they're dropped, gaps allowed,
// and preventCollision stops overlap. Dragging a widget over another previews a
// swap live — the target card slides into the dragged widget's slot — and the
// swap commits on release (each widget keeps its own size); mirrors the old
// hand-rolled grid. Dragging uses the widget header (`.widget-drag-handle`); the
// bottom-right corner resizes. Layout changes commit on drag/resize end, scoped
// to the currently active breakpoint so smaller-screen tweaks don't clobber `lg`.
export default function WidgetGrid({
  widgets,
  editable = true,
  onLayoutsCommit,
  renderWidget,
}: {
  widgets: Widget[]
  editable?: boolean
  onLayoutsCommit: (updates: LayoutUpdate[], breakpoint: Breakpoint) => void
  renderWidget: (w: Widget) => ReactNode
}) {
  // Current RGL breakpoint (may be a phone breakpoint xs/xxs that isn't stored).
  const bpRef = useRef<RglBreakpoint>('lg')
  // The target card currently shifted for the live swap preview, so we can put
  // it back when the cursor leaves it or the drag ends.
  const previewRef = useRef<{ id: string; el: HTMLElement } | null>(null)

  const layouts: Record<Breakpoint, Layout[]> = {
    lg: toItems(widgets, 'lg'),
    md: toItems(widgets, 'md'),
    sm: toItems(widgets, 'sm'),
  }

  const clearPreview = () => {
    const p = previewRef.current
    if (!p) return
    p.el.style.transform = ''
    p.el.style.transition = ''
    previewRef.current = null
  }

  // Persist every item RGL reports — free placement never moves siblings, but
  // committing the full set keeps the draft in sync in one shot. Phone
  // breakpoints (xs/xxs) are view-only: their layouts derive from `sm` and
  // aren't stored, so edits there are ignored.
  const commitAll = (layout: Layout[]) => {
    const bp = bpRef.current
    if (!isStoredBp(bp)) return
    onLayoutsCommit(
      layout.map((l) => ({ id: l.i, layout: { x: l.x, y: l.y, w: l.w, h: l.h } })),
      bp
    )
  }

  // Live swap preview: while dragging over a valid swap target, slide that
  // target's card into the dragged widget's original slot so the user sees the
  // outcome before releasing. Purely visual (imperative transform on the inner
  // card) because RGL ignores layout prop changes during an active drag.
  const onDrag = (_layout: Layout[], oldItem: Layout, _n: Layout, _p: Layout, e: MouseEvent, element: HTMLElement) => {
    const bp = bpRef.current
    if (!isStoredBp(bp)) return clearPreview()
    const cols = GRID_COLS_BP[bp]
    const targetId = targetUnderPoint(e, oldItem.i)
    const target = targetId ? widgets.find((w) => w.id === targetId) : undefined
    const swap = target && swapFits(widgets, oldItem, target, bp, cols)

    if (!target || !swap) return clearPreview()
    if (previewRef.current?.id === target.id) return // already previewing this target

    clearPreview()
    const container = element.closest('.widget-grid') as HTMLElement | null
    const item = container?.querySelector(`[data-widget-id="${target.id}"]`) as HTMLElement | null
    const inner = item?.firstElementChild as HTMLElement | null
    if (!container || !inner) return

    const colW = (container.clientWidth - 2 * PAD - (cols - 1) * GRID_GAP) / cols
    const tO = bpLayout(target, bp)
    const dx = (oldItem.x - tO.x) * (colW + GRID_GAP)
    const dy = (oldItem.y - tO.y) * (GRID_ROW_H + GRID_GAP)
    inner.style.transition = 'transform 120ms ease'
    inner.style.transform = `translate(${dx}px, ${dy}px)`
    previewRef.current = { id: target.id, el: inner }
  }

  // On release, swap with the widget under the cursor when the swap is legal,
  // otherwise accept RGL's (collision-free) drop position.
  const onDragStop = (layout: Layout[], oldItem: Layout, _n: Layout, _p: Layout, e: MouseEvent) => {
    clearPreview()
    const bp = bpRef.current
    if (!isStoredBp(bp)) return
    const cols = GRID_COLS_BP[bp]
    const targetId = targetUnderPoint(e, oldItem.i)
    const target = targetId ? widgets.find((w) => w.id === targetId) : undefined
    const swap = target && swapFits(widgets, oldItem, target, bp, cols)

    if (target && swap) {
      onLayoutsCommit([{ id: oldItem.i, layout: swap.draggedNew }, { id: target.id, layout: swap.targetNew }], bp)
      return
    }
    if (target) {
      // Over a widget but the swap doesn't fit — revert to the original slot.
      onLayoutsCommit([{ id: oldItem.i, layout: { x: oldItem.x, y: oldItem.y, w: oldItem.w, h: oldItem.h } }], bp)
      return
    }
    commitAll(layout)
  }

  return (
    <ResponsiveGridLayout
      className="widget-grid"
      layouts={layouts}
      breakpoints={BREAKPOINTS}
      cols={GRID_COLS_BP}
      rowHeight={GRID_ROW_H}
      margin={[GRID_GAP, GRID_GAP]}
      containerPadding={[PAD, PAD]}
      compactType={null}
      preventCollision
      isDraggable={editable}
      isResizable={editable}
      draggableHandle=".widget-drag-handle"
      draggableCancel="button,[role='button'],input,a,select,textarea"
      resizeHandles={['se']}
      onBreakpointChange={(bp) => {
        bpRef.current = bp as RglBreakpoint
      }}
      onDragStart={clearPreview}
      onDrag={onDrag}
      onDragStop={onDragStop}
      onResizeStop={commitAll}
    >
      {widgets.map((w) => (
        <div key={w.id} data-widget-id={w.id} className="widget-grid-item">
          {renderWidget(w)}
        </div>
      ))}
    </ResponsiveGridLayout>
  )
}
