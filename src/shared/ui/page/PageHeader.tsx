import type { ReactNode } from 'react'
import TextButton from '../buttons/TextButton'
import { ChevronLeft } from '../icons'

/**
 * The one page header every full-page view uses — list, detail and form alike.
 *
 * A page never sets its own width: `HomeLayout` owns the single content
 * container, so this header always spans it. Anything that reads badly at full
 * width wraps itself in `<Narrow>` instead.
 *
 * Props: `back` (a breadcrumb-style link out of a detail/form view), `media`
 * (a logo/avatar left of the title), `meta` (a status badge beside it) and
 * `action` (the primary buttons, right-aligned).
 */
export type PageBack = { label: string; onClick: () => void }

type PageHeaderProps = {
  title: ReactNode
  desc?: ReactNode
  action?: ReactNode
  back?: PageBack
  media?: ReactNode
  meta?: ReactNode
}

export default function PageHeader({ title, desc, action, back, media, meta }: PageHeaderProps) {
  return (
    <div>
      {back && (
        <TextButton onClick={back.onClick} className="mb-4">
          <ChevronLeft width={16} height={16} /> {back.label}
        </TextButton>
      )}

      <div className="flex items-start justify-between gap-4 max-[600px]:flex-col max-[600px]:items-stretch">
        <div className="flex min-w-0 items-center gap-3.5">
          {media && <div className="shrink-0">{media}</div>}
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h1 className="truncate text-[22px] font-bold tracking-[-0.4px] max-[600px]:text-[19px]">{title}</h1>
              {meta}
            </div>
            {desc && <p className="mt-1.5 text-[13px] text-ink-dim">{desc}</p>}
          </div>
        </div>
        {action && <div className="flex shrink-0 items-center gap-2 max-[600px]:flex-wrap">{action}</div>}
      </div>
    </div>
  )
}
