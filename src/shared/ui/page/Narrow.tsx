import type { ReactNode } from 'react'

/**
 * A capped content column inside a full-width page.
 *
 * Pages themselves are all the same width (HomeLayout's container). When a
 * *piece* of content reads badly wide — a settings form, a paragraph — wrap
 * that piece in `<Narrow>` rather than shrinking the page, so the header and
 * tabs still line up with every other page.
 */
export default function Narrow({
  width = 760,
  className = '',
  children,
}: {
  width?: number
  className?: string
  children: ReactNode
}) {
  return (
    <div className={`w-full ${className}`} style={{ maxWidth: width }}>
      {children}
    </div>
  )
}
