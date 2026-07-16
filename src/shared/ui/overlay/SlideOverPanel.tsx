import { useEffect } from 'react'
import type { FormEventHandler, ReactNode } from 'react'
import IconButton from '@/shared/ui/buttons/IconButton'
import { ChevronRight } from '@/shared/ui/icons'

/**
 * The right-side slide-over shell every panel shares: backdrop, sliding panel,
 * header with a close button, scrolling body, optional error strip and footer.
 *
 * Animation state stays with the caller so it can commit on the way out:
 *
 *   const { show, close } = useSlideOver(onClose)
 *   <SlideOverPanel show={show} close={close} title="Inspector" footer={…}>
 *
 * `close(commit)` plays the exit animation and then runs `commit`, so a panel
 * saves with `close(() => onSave(value))` — see `useSlideOver`.
 *
 * Pass `title` for the standard heading, or `header` to render custom left-hand
 * content (an icon, a badge, a subtitle) in its place. `onSubmit` wraps the
 * whole panel in a <form> so a footer `type="submit"` button works.
 */
type SlideOverPanelProps = {
  show: boolean
  close: (commit?: unknown) => void
  title?: ReactNode
  header?: ReactNode
  /** Fixed band under the header — for a toggle/tabs that shouldn't scroll away. */
  subheader?: ReactNode
  footer?: ReactNode
  error?: ReactNode
  /** Panel max width in px. */
  width?: number
  /** Stacking context — raise it for a slide-over opened from another overlay. */
  zClassName?: string
  bodyClassName?: string
  footerClassName?: string
  onSubmit?: FormEventHandler<HTMLFormElement>
  children?: ReactNode
}

export default function SlideOverPanel({
  show,
  close,
  title,
  header,
  subheader,
  footer,
  error,
  width = 460,
  zClassName = 'z-50',
  bodyClassName = 'px-5 py-4',
  footerClassName = 'justify-end',
  onSubmit,
  children,
}: SlideOverPanelProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  const inner = (
    <>
      {(header || title != null) && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-edge px-5 py-4">
          {header ?? <h3 className="min-w-0 truncate text-base font-bold">{title}</h3>}
          <IconButton type="button" size="lg" onClick={() => close()} aria-label="Close">
            <ChevronRight />
          </IconButton>
        </div>
      )}

      {subheader && <div className="shrink-0 border-b border-edge px-5 py-3">{subheader}</div>}

      <div className={`min-h-0 flex-1 overflow-y-auto ${bodyClassName}`}>{children}</div>

      {error && (
        <div className="shrink-0 border-t border-edge bg-red/10 px-5 py-2.5 font-mono text-[11px] text-[#ff9b9b]">
          {error}
        </div>
      )}

      {footer && (
        <div className={`flex shrink-0 items-center gap-3 border-t border-edge px-5 py-4 ${footerClassName}`}>
          {footer}
        </div>
      )}
    </>
  )

  return (
    <div
      className={`fixed inset-0 ${zClassName} flex justify-end bg-black/50 transition-opacity duration-200 ${
        show ? 'opacity-100' : 'opacity-0'
      }`}
      onMouseDown={() => close()}
    >
      <div
        className={`flex h-full w-full flex-col border-l border-edge-strong bg-panel shadow-[-20px_0_60px_-20px_rgba(0,0,0,0.8)] transition-transform duration-200 ease-out ${
          show ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{ maxWidth: width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {onSubmit ? (
          <form onSubmit={onSubmit} className="flex h-full min-h-0 flex-col">
            {inner}
          </form>
        ) : (
          inner
        )}
      </div>
    </div>
  )
}
