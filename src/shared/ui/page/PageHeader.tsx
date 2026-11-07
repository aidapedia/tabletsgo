import type { ReactNode } from 'react'
import type { Crumb } from '../navigation/Breadcrumb'
import { useSetPageCrumbs } from './PageTrail'

/**
 * The one page header every full-page view uses — list, detail and form alike.
 *
 * A page never sets its own width: `HomeLayout` owns the single content
 * container, so this header always spans it. Anything that reads badly at full
 * width wraps itself in `<Narrow>` instead.
 *
 * Props: `crumbs` (what comes after the section in the trail, for a page the
 * address can't name — `HomeLayout` draws the trail itself, see `PageTrail`),
 * `media` (a logo/avatar left of the title), `meta` (a status badge beside it)
 * and `action` (the primary buttons, right-aligned).
 */
type PageHeaderProps = {
  title: ReactNode
  desc?: ReactNode
  action?: ReactNode
  crumbs?: Crumb[]
  media?: ReactNode
  meta?: ReactNode
}

export default function PageHeader({ title, desc, action, crumbs, media, meta }: PageHeaderProps) {
  useSetPageCrumbs(crumbs)
  return (
    <div>
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
