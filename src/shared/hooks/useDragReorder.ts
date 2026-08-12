import { useLayoutEffect, useRef, useState } from 'react'

/**
 * Drag-to-reorder for a vertical list of cards, with the cards animating into
 * their new places on drop.
 *
 *   const reorder = useDragReorder(columns.length, move)
 *   <div {...reorder.listProps}>
 *     {columns.map((c, i) => (
 *       <div key={c.id} {...reorder.itemProps(i, c.id)} className={reorder.dragging(i) ? 'opacity-40' : ''}>
 *         <Grip {...reorder.handleProps(i)} />
 *         {reorder.indicator(i) === 'top' && <line/>}
 *       </div>
 *     ))}
 *   </div>
 *
 * Native HTML5 drag deliberately, not pointer maths: the browser gives the drag
 * image, the cursor and escape-to-cancel for free, and a list of cards has no
 * exotic hit-testing to do. (It does mean this can't live inside a React Flow
 * canvas — React Flow's d3-drag calls `dragDisable`, which blocks `dragstart`
 * window-wide for the gesture.) Only the grip starts a drag (`handleProps`),
 * while the whole card is the drop target (`itemProps`) — so text selection in
 * the card's inputs still works and a drop anywhere on a row counts.
 *
 * The indicator answers where the dragged card would land: above the row it is
 * over when it came from below, under it when it came from above — which is
 * where the lift-and-drop of `moveColumn` actually puts it.
 *
 * `onMove(from, to)` is called on drop, never with `from === to`. The caller
 * owns the list; this hook only tracks the gesture and animates the outcome.
 */
const DURATION = 220
const EASING = 'cubic-bezier(0.2, 0, 0, 1)'

export function useDragReorder(count: number, onMove: (from: number, to: number) => void) {
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null)
  const listRef = useRef<HTMLElement | null>(null)
  // Where each card sat *just before* the reorder — the "first" of a FLIP. Read
  // synchronously in the drop handler, because one React render later the cards
  // have already jumped.
  const first = useRef<Map<string, DOMRect> | null>(null)
  const running = useRef<Animation[]>([])

  const cards = () => Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-reorder-key]') || [])

  /**
   * Play each card from where it was to where it now is.
   *
   * Runs after every render and costs nothing on the ones that aren't a
   * reorder (no captured positions → straight out). Transforms only, so the
   * list's real layout is already final while the cards are still travelling —
   * a drag started mid-animation lands where the card is going, not where it
   * appears to be.
   */
  useLayoutEffect(() => {
    const from = first.current
    first.current = null
    if (!from || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    for (const a of running.current) a.cancel()
    running.current = []
    for (const el of cards()) {
      const was = from.get(el.dataset.reorderKey as string)
      if (!was) continue // a card that wasn't there before has nowhere to come from
      const now = el.getBoundingClientRect()
      const dx = was.left - now.left
      const dy = was.top - now.top
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue
      running.current.push(
        el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: DURATION, easing: EASING })
      )
    }
  })

  return {
    /** Spread on the list container — it's what the animation measures inside. */
    listProps: { ref: listRef as any },
    /** The card being dragged, for fading it out. */
    dragging: (i: number) => drag?.from === i,
    /** 'top' | 'bottom' | null — which edge of row `i` shows the drop line. */
    indicator: (i: number): 'top' | 'bottom' | null =>
      !drag || drag.over !== i || drag.from === i ? null : drag.from > i ? 'top' : 'bottom',
    /**
     * Spread on each card: it is a drop target while a drag is in progress, and
     * `key` is the identity the animation follows it by — a stable id, never the
     * index, which is the thing that changes.
     */
    itemProps: (i: number, key: string | number) => ({
      'data-reorder-key': String(key),
      ...(drag
        ? {
            onDragOver: (e: React.DragEvent) => {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              if (drag.over !== i) setDrag({ ...drag, over: i })
            },
            onDrop: (e: React.DragEvent) => {
              e.preventDefault()
              const from = drag.from
              setDrag(null)
              if (from === i || i >= count) return
              // Measure before the move, animate after it lands.
              first.current = new Map(cards().map((el) => [el.dataset.reorderKey as string, el.getBoundingClientRect()]))
              onMove(from, i)
            },
          }
        : {}),
    }),
    /** Spread on the grip: the only thing that starts a drag. */
    handleProps: (i: number) => ({
      draggable: true,
      onDragStart: (e: React.DragEvent) => {
        // Firefox refuses to start a drag with no payload.
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', String(i))
        setDrag({ from: i, over: i })
      },
      onDragEnd: () => setDrag(null),
    }),
  }
}
