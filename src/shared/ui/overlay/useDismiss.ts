import { useEffect, useRef } from 'react'

/**
 * Dismisses an open overlay on an outside press or Escape. `refs` are the
 * overlay's own elements (panel, and for an anchored overlay its trigger) —
 * a press inside any of them is "inside" and never dismisses.
 *
 * Listens for `mousedown` on the capture phase, which is what keeps only one
 * menu on screen at a time: a bubble-phase listener never hears the press when
 * something between the target and window calls stopPropagation (e.g. a
 * sidebar row that swallows clicks around its action button), so the old menu
 * would stay open alongside the new one. Capture runs before any of that.
 *
 * Capture also means the press that *opens* an overlay can't immediately close
 * it: menus open on `contextmenu`/`click`, both of which fire after the
 * mousedown that preceded them.
 */
export default function useDismiss(refs, onClose, active = true) {
  const latest = useRef({ refs, onClose })
  latest.current = { refs, onClose }

  useEffect(() => {
    if (!active) return
    const close = () => latest.current.onClose?.()
    const onDown = (e) => {
      if (latest.current.refs.some((r) => r.current?.contains(e.target))) return
      close()
    }
    const onKey = (e) => e.key === 'Escape' && close()
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [active])
}
