// Composition helpers shared by every section page. The header/tab/column
// primitives themselves live in `shared/ui/page` so the feature components
// rendered inside a page (connection detail, connection form) can use the exact
// same ones without importing back out of `pages/`.
import type { ReactNode } from 'react'
import PageHeader from '@/shared/ui/page/PageHeader'
import PageTabs from '@/shared/ui/page/PageTabs'
import Narrow from '@/shared/ui/page/Narrow'

export { PageHeader, PageTabs, Narrow }

/**
 * A plain section page: header + content.
 *
 * No width prop — every page fills HomeLayout's container so headers, tables
 * and tab bars line up across sections. Content that needs to be narrower says
 * so itself with `<Narrow>`.
 */
export function Section({
  title,
  desc,
  children,
  action,
}: {
  title: string
  desc?: string
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="w-full">
      <PageHeader title={title} desc={desc} action={action} />
      <div className="mt-7">{children}</div>
    </div>
  )
}

// Sub-heading inside a tab body.
export function SubHead({ title, desc }: { title: string; desc?: string }) {
  return (
    <div className="mb-5">
      <h2 className="text-[16px] font-bold tracking-[-0.2px]">{title}</h2>
      {desc && <p className="mt-1 text-[12px] text-ink-dim">{desc}</p>}
    </div>
  )
}

type TabItem = { id: string; label: string; body: ReactNode }

/**
 * A section page whose children are tabs (Workspace → General / Member / …).
 *
 * `active` is whatever the URL says; an unknown or empty value falls back to
 * the first tab, and the page is expected to rewrite the URL to match (see
 * `useTabRoute`) so every tab has an address you can paste.
 */
export function TabbedSection({
  title,
  desc,
  tabs,
  active,
  onTab,
  action,
}: {
  title: string
  desc?: string
  tabs: TabItem[]
  active: string
  onTab: (id: string) => void
  action?: ReactNode
}) {
  const current = tabs.find((t) => t.id === active) || tabs[0]
  return (
    <div className="w-full">
      <PageHeader title={title} desc={desc} action={action} />
      <PageTabs tabs={tabs.map(({ id, label }) => ({ id, label }))} active={current.id} onTab={onTab}>
        {current.body}
      </PageTabs>
    </div>
  )
}

// Placeholder for features that aren't built yet.
export function ComingSoon({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-card border border-dashed border-edge-strong py-20 text-center">
      <span className="rounded-[8px] border border-edge bg-elevated px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink-faint">
        Coming soon
      </span>
      <h3 className="mt-4 text-[15px] font-semibold text-ink">{title}</h3>
      <p className="mt-1.5 max-w-[340px] text-[12px] leading-relaxed text-ink-dim">{desc}</p>
    </div>
  )
}
