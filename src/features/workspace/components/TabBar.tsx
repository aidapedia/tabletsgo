import { useEffect, useRef, useState } from 'react'
import {
  CloseIcon,
  CodeIcon,
  ColumnsIcon,
  DiagramIcon,
  GridIcon,
  HistoryIcon,
  TableIcon,
  WandIcon,
  WorkflowIcon,
} from '@/shared/ui/icons'
import IconButton from '@/shared/ui/buttons/IconButton'

// One icon per tab kind; anything unknown falls back to a table.
const KIND_ICON = {
  query: CodeIcon,
  schema: ColumnsIcon,
  schemaEditor: DiagramIcon,
  history: HistoryIcon,
  schemaHistory: HistoryIcon,
  function: CodeIcon,
  workflow: WorkflowIcon,
  dashboard: GridIcon,
  template: WandIcon,
}

/**
 * The console's open-tab strip. Tabs can be dragged left/right to reorder: the
 * tabs the pointer has passed slide aside and the dragged tab slides into the
 * slot they open up, so the new order is visible before the drop. The move is
 * committed on drop via `onReorder(fromKey, toKey, before)` (`toKey = null`
 * means "move to the end").
 *
 * The slide is pure `translateX` on top of a layout frozen at drag start, so
 * the tabs moving around can never feed back into the drop-target math. On
 * commit the real order lands exactly where the transforms had drawn it, and
 * they're dropped in the same frame with the transition off (`snap`) — the
 * hand-off is invisible.
 */
export default function TabBar({ tabs = [], activeTab, onSelect, onClose, onContextMenu, onReorder }) {
  const stripRef = useRef(null)
  const itemRefs = useRef(new Map())
  const layout = useRef(null) // geometry frozen at drag start
  const [dragKey, setDragKey] = useState(null) // key of the tab being dragged
  const [target, setTarget] = useState(null) // index the dragged tab would land on
  const [snap, setSnap] = useState(false) // one frame with transitions off, right after a commit

  // Measure every tab in the strip's own (scroll-independent) coordinates.
  const measure = (from) => {
    const strip = stripRef.current
    if (!strip) return null
    const base = strip.getBoundingClientRect().left - strip.scrollLeft
    const lefts = []
    const widths = []
    for (const t of tabs) {
      const rect = itemRefs.current.get(t.key)?.getBoundingClientRect()
      lefts.push(rect ? rect.left - base : 0)
      widths.push(rect ? rect.width : 0)
    }
    const gap = tabs.length > 1 ? Math.max(0, lefts[1] - (lefts[0] + widths[0])) : 0
    return { from, lefts, widths, gap, slot: widths[from] + gap }
  }

  const endDrag = () => {
    layout.current = null
    setDragKey(null)
    setTarget(null)
  }

  const startDrag = (key, index) => (e) => {
    layout.current = measure(index)
    setDragKey(key)
    setTarget(index)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', key)
  }

  // The dragged tab lands after every *other* tab whose original centre the
  // pointer has passed — monotonic in x, so the preview can't flicker.
  const dragOver = (e) => {
    const l = layout.current
    if (!dragKey || !l || l.lefts.length !== tabs.length) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const strip = stripRef.current
    const x = e.clientX - strip.getBoundingClientRect().left + strip.scrollLeft
    let at = 0
    tabs.forEach((_, i) => {
      if (i !== l.from && l.lefts[i] + l.widths[i] / 2 < x) at += 1
    })
    setTarget(at)
  }

  const drop = (e) => {
    const l = layout.current
    if (!dragKey || !l) return
    e.preventDefault()
    const at = target ?? l.from
    if (at !== l.from) {
      // `at` indexes the list without the dragged tab, which is exactly what
      // "insert before this key" means; past the end it becomes an append.
      const anchor = tabs.filter((t) => t.key !== dragKey)[at]
      onReorder?.(dragKey, anchor ? anchor.key : null, true)
      setSnap(true)
    }
    endDrag()
  }

  // How far tab `i` has to slide for the current preview order.
  const shiftFor = (i) => {
    const l = layout.current
    if (!l || target == null) return 0
    const { from, widths, gap, slot } = l
    if (i === from) {
      let d = 0
      for (let k = from + 1; k <= target; k++) d += widths[k] + gap
      for (let k = target; k < from; k++) d -= widths[k] + gap
      return d
    }
    if (i < from && i >= target) return slot
    if (i > from && i <= target) return -slot
    return 0
  }

  // Let the committed order paint once before transitions come back, so the
  // transforms falling to zero isn't animated as a second, wrong move.
  useEffect(() => {
    if (!snap) return
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setSnap(false))
    })
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
    }
  }, [snap])

  return (
    <div
      ref={stripRef}
      onDragOver={dragOver}
      onDrop={drop}
      className="flex items-stretch gap-1 overflow-x-auto border-b border-edge bg-panel px-1.5 pt-1.5"
    >
      {tabs.map((t, i) => {
        const active = activeTab === t.key
        const dragging = dragKey === t.key
        const Icon = KIND_ICON[t.kind] || TableIcon
        const dx = shiftFor(i)
        return (
          <div
            key={t.key}
            ref={(el) => {
              if (el) itemRefs.current.set(t.key, el)
              else itemRefs.current.delete(t.key)
            }}
            draggable
            onDragStart={startDrag(t.key, i)}
            onDragEnd={endDrag}
            onClick={() => onSelect(t.key)}
            onContextMenu={(e) => onContextMenu(e, t.key)}
            style={{ transform: dx ? `translateX(${dx}px)` : undefined }}
            className={`group/tab relative flex cursor-pointer items-center gap-2.5 whitespace-nowrap rounded-t-[8px] px-3.5 py-2.5 text-xs ${
              snap ? '' : 'transition-[color,background-color,transform] duration-150 ease-out'
            } ${active ? 'bg-elevated font-medium text-ink' : 'text-ink-dim hover:bg-elevated/40 hover:text-ink'} ${
              dragging ? 'z-10 opacity-60 shadow-lg' : ''
            }`}
          >
            {active && <span className="absolute inset-x-0 bottom-0 h-[2px] bg-green" />}
            <Icon className={active ? 'text-ink' : 'text-ink-faint'} />
            <span>{t.title}</span>
            <IconButton
              size="xs"
              className="shrink-0 !text-ink-faint opacity-70 group-hover/tab:opacity-100"
              onClick={(e) => onClose(e, t.key)}
              aria-label="Close tab"
            >
              <CloseIcon width={13} height={13} />
            </IconButton>
          </div>
        )
      })}
      {tabs.length === 0 && <div className="px-3 py-2.5 text-[11px] text-ink-faint">No open tabs</div>}
      {/* Free space after the last tab — dropping out here appends. */}
      <div className="min-w-0 flex-1" />
    </div>
  )
}
