import type { ReactNode } from 'react'

/**
 * The centred dialog shell: backdrop, popped card, title, body.
 *
 * The counterpart to `SlideOverPanel` — use this one when the dialog is a plain
 * form that the user finishes and dismisses (create a user, edit a role), and
 * the slide-over when the panel sits alongside what it's editing.
 *
 * The body scrolls at `maxHeight` rather than growing past the viewport, so a
 * tall form (a permission matrix, a long member list) stays usable on a laptop
 * without each caller remembering to cap it.
 *
 * Dismissal is `onMouseDown` on the backdrop, not `onClick`: a click that starts
 * inside the card and ends on the backdrop (dragging to select text in a field)
 * would otherwise close the dialog and lose the input.
 */
export default function Modal({
  title,
  children,
  onClose,
  width = 460,
}: {
  title: ReactNode
  children: ReactNode
  onClose: () => void
  /** Card max width in px. Default suits a short form; widen for a dense one. */
  width?: number
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex animate-fade items-center justify-center bg-black/60 p-6 backdrop-blur-[3px]"
      onMouseDown={onClose}
    >
      <div
        style={{ maxWidth: width }}
        className="flex max-h-[calc(100vh-6rem)] w-full animate-pop flex-col rounded-[16px] border border-edge-strong bg-panel p-5"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 shrink-0 text-sm font-bold text-ink">{title}</h3>
        {/* -mx/px so a focus ring inside the body isn't clipped by the scroller. */}
        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">{children}</div>
      </div>
    </div>
  )
}
