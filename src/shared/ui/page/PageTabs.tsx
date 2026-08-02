import type { ReactNode } from 'react'
import Tab from '../navigation/Tab'

/**
 * The tab bar under a `PageHeader`, plus the body of the active tab.
 *
 * Owning both halves is what keeps the spacing identical everywhere — a tabbed
 * page never hand-rolls its own `border-b` row and margins again. A tab is
 * always addressable: `onTab` gets the id, and callers push it into the URL.
 */
export type PageTab = { id: string; label: string }

type PageTabsProps = {
  tabs: PageTab[]
  active: string
  onTab: (id: string) => void
  children?: ReactNode
}

export default function PageTabs({ tabs, active, onTab, children }: PageTabsProps) {
  return (
    <>
      <div className="mt-6 flex items-center gap-5 overflow-x-auto border-b border-edge">
        {tabs.map((t) => (
          <Tab key={t.id} active={active === t.id} onClick={() => onTab(t.id)} className="shrink-0">
            {t.label}
          </Tab>
        ))}
      </div>
      {children !== undefined && <div className="mt-7">{children}</div>}
    </>
  )
}
