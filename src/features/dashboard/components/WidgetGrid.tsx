import { useRef, useState, type ReactNode } from 'react'
import type { Widget, WidgetLayout } from '../types'
import { GRID_COLS, GRID_GAP, GRID_ROW_H, fits } from '../lib/grid'
import { useSize } from '../lib/useSize'

const PAD = 10 // container padding
const MIN_W = 2
const MIN_H = 2

type Interaction = {
  mode: 'move' | 'resize'
  id: string
  startX: number // pointer px at start
  startY: number
  origin: WidgetLayout // layout at start
  layout: WidgetLayout // last valid layout during the interaction
}

// Free-placement 12-column widget grid (New Relic style) with drag-to-move and
// corner drag-to-resize, both driven by pointer events. Collisions are hard-
// blocked: a widget only follows the pointer through positions where it fits,
// so two widgets can never overlap. Commits the final layout on pointer-up.
export default function WidgetGrid({
  widgets,
  editable = true,
  onLayoutCommit,
  renderWidget,
}: {
  widgets: Widget[]
  editable?: boolean
  onLayoutCommit: (id: string, layout: WidgetLayout) => void
  renderWidget: (w: Widget) => ReactNode
}) {
  const { ref, width } = useSize<HTMLDivElement>()
  const [action, setAction] = useState<Interaction | null>(null)
  const actionRef = useRef<Interaction | null>(null)

  const colW = width > 0 ? (width - 2 * PAD - (GRID_COLS - 1) * GRID_GAP) / GRID_COLS : 0
  const toPx = (l: WidgetLayout) => ({
    left: PAD + l.x * (colW + GRID_GAP),
    top: PAD + l.y * (GRID_ROW_H + GRID_GAP),
    width: l.w * colW + (l.w - 1) * GRID_GAP,
    height: l.h * GRID_ROW_H + (l.h - 1) * GRID_GAP,
  })

  const layoutOf = (w: Widget) => (action?.id === w.id ? action.layout : w.layout)
  const rows = widgets.reduce((m, w) => Math.max(m, layoutOf(w).y + layoutOf(w).h), 0)

  const startInteraction = (e: React.PointerEvent, widget: Widget, mode: Interaction['mode']) => {
    if (!editable || e.button !== 0) return
    e.preventDefault()
    const start: Interaction = {
      mode,
      id: widget.id,
      startX: e.clientX,
      startY: e.clientY,
      origin: widget.layout,
      layout: widget.layout,
    }
    actionRef.current = start
    setAction(start)

    const others = widgets.filter((w) => w.id !== widget.id).map((w) => w.layout)
    const onMove = (ev: PointerEvent) => {
      const a = actionRef.current
      if (!a) return
      const dx = Math.round((ev.clientX - a.startX) / (colW + GRID_GAP))
      const dy = Math.round((ev.clientY - a.startY) / (GRID_ROW_H + GRID_GAP))
      let candidate: WidgetLayout
      if (a.mode === 'move') {
        candidate = {
          ...a.origin,
          x: Math.min(GRID_COLS - a.origin.w, Math.max(0, a.origin.x + dx)),
          y: Math.max(0, a.origin.y + dy),
        }
      } else {
        candidate = {
          ...a.origin,
          w: Math.min(GRID_COLS - a.origin.x, Math.max(MIN_W, a.origin.w + dx)),
          h: Math.max(MIN_H, a.origin.h + dy),
        }
      }
      const same = candidate.x === a.layout.x && candidate.y === a.layout.y && candidate.w === a.layout.w && candidate.h === a.layout.h
      if (same || !fits(candidate, others)) return
      const next = { ...a, layout: candidate }
      actionRef.current = next
      setAction(next)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      const a = actionRef.current
      actionRef.current = null
      setAction(null)
      if (!a) return
      const l = a.layout
      const o = a.origin
      if (l.x !== o.x || l.y !== o.y || l.w !== o.w || l.h !== o.h) onLayoutCommit(a.id, l)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div ref={ref} className="relative" style={{ height: PAD * 2 + rows * GRID_ROW_H + Math.max(0, rows - 1) * GRID_GAP }}>
      {width > 0 &&
        widgets.map((w) => {
          const active = action?.id === w.id
          return (
            <div
              key={w.id}
              className={`absolute ${active ? 'z-20' : 'transition-[left,top,width,height] duration-150 ease-out'}`}
              style={toPx(layoutOf(w))}
              onPointerDown={(e) => {
                const t = e.target as HTMLElement
                // Buttons/menus inside the handle (widget actions) never start a drag.
                if (t.closest('button, [role="button"], input, a')) return
                if (t.closest('.widget-drag-handle')) startInteraction(e, w, 'move')
              }}
            >
              <div className={`h-full ${active ? 'opacity-90 shadow-2xl' : ''}`}>{renderWidget(w)}</div>
              {editable && (
                <div
                  className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize opacity-0 transition-opacity hover:opacity-100"
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    startInteraction(e, w, 'resize')
                  }}
                >
                  <span className="absolute bottom-[5px] right-[5px] h-1.5 w-1.5 border-b-2 border-r-2 border-ink-faint" />
                </div>
              )}
            </div>
          )
        })}
    </div>
  )
}
