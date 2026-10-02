import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Drives a slide-over panel with symmetric enter/exit animation.
 *
 *   const { show, close } = useSlideOver(onClose)
 *
 * Render the backdrop/panel with `show` toggling the transition classes:
 *   backdrop: `transition-opacity duration-200 ${show ? 'opacity-100' : 'opacity-0'}`
 *   panel:    `transition-transform duration-200 ${show ? 'translate-x-0' : 'translate-x-full'}`
 *
 * `close(commit)` plays the exit animation, then runs `commit` (if given) and
 * always `onClose` — so saving and cancelling both animate out the same way, and
 * a commit never has to remember to unmount the panel itself. (It used to run
 * `commit` *instead of* `onClose`, which left the invisible overlay mounted and
 * swallowing every click whenever a caller's commit forgot to close.)
 */
const DURATION = 200

export function useSlideOver(onClose?: () => void) {
  const [show, setShow] = useState(false)
  const closing = useRef(false)

  // Mount off-screen, then flip on the next frame so the enter transition runs.
  useEffect(() => {
    const id = requestAnimationFrame(() => setShow(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const close = useCallback(
    (commit?: unknown) => {
      if (closing.current) return
      closing.current = true
      setShow(false)
      setTimeout(() => {
        if (typeof commit === 'function') commit()
        onClose?.()
      }, DURATION)
    },
    [onClose]
  )

  return { show, close }
}
