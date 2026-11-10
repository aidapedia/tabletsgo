import type { FormEventHandler, ReactNode } from 'react'
import { ChevronRight } from '@/shared/ui/icons'
import { Button } from '@/shared/ui/button'
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/shared/ui/sheet'
import { cn } from '@/shared/lib/utils'

/**
 * The right-side slide-over shell every panel shares — shadcn's Sheet: backdrop, sliding panel,
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
  /** Accepted for old call sites; stacking now follows open order. */
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
  bodyClassName = 'px-5 py-4',
  footerClassName = 'justify-end',
  onSubmit,
  children,
}: SlideOverPanelProps) {
  const inner = (
    <>
      {(header || title != null) && (
        <SheetHeader className="flex shrink-0 flex-row items-center justify-between gap-2 border-b border-border px-5 py-4">
          {header ?? <SheetTitle className="min-w-0 truncate text-base font-bold">{title}</SheetTitle>}
          <Button variant="ghost" size="icon" type="button" onClick={() => close()} aria-label="Close">
            <ChevronRight />
          </Button>
        </SheetHeader>
      )}

      {subheader && <div className="shrink-0 border-b border-border px-5 py-3">{subheader}</div>}

      <div className={cn('min-h-0 flex-1 overflow-y-auto', bodyClassName)}>{children}</div>

      {error && (
        <div className="shrink-0 border-t border-border bg-destructive/10 px-5 py-2.5 font-mono text-[11px] text-destructive">
          {error}
        </div>
      )}

      {footer && (
        <SheetFooter className={cn('mt-0 flex shrink-0 flex-row items-center gap-3 border-t border-border px-5 py-4', footerClassName)}>
          {footer}
        </SheetFooter>
      )}
    </>
  )

  return (
    <Sheet open={show} onOpenChange={(open) => !open && close()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        aria-describedby={undefined}
        style={{ maxWidth: width }}
        className="gap-0 border-l border-input bg-sidebar p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-none"
      >
        {/* Radix wants a title; a custom header supplies its own text. */}
        {header && <SheetTitle className="sr-only">Panel</SheetTitle>}
        {onSubmit ? (
          <form onSubmit={onSubmit} className="flex h-full min-h-0 flex-col">
            {inner}
          </form>
        ) : (
          inner
        )}
      </SheetContent>
    </Sheet>
  )
}
