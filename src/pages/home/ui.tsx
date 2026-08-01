// Shared, left-aligned page primitives used by every home section page.
import type { ReactNode } from 'react'
import Tab from '@/shared/ui/navigation/Tab'

// Page header (title + subtitle + optional right-aligned action).
export function PageHeader({ title, desc, action }: { title: string; desc?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[22px] font-bold tracking-[-0.4px] max-[600px]:text-[19px]">{title}</h1>
        {desc && <p className="mt-1.5 text-[13px] text-ink-dim">{desc}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

// A titled content section with heading + description. Full width by default;
// pass `max` to cap it. `action` is the section's primary button, rendered in
// the header rather than inside the content — the same place ConnectionsPage
// puts "New connection", so every list page reads the same way.
export function Section({ title, desc, children, max, action }: any) {
  return (
    <div className="w-full" style={max ? { maxWidth: max } : undefined}>
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

// A section page whose child sections render as tabs (e.g. Workspace → General / Member / SMTP).
export function TabbedSection({
  title,
  desc,
  tabs,
  active,
  onTab,
  max,
}: {
  title: string
  desc?: string
  tabs: TabItem[]
  active: string
  onTab: (id: string) => void
  max?: number
}) {
  const current = tabs.find((t) => t.id === active) || tabs[0]
  return (
    <div className="w-full" style={max ? { maxWidth: max } : undefined}>
      <PageHeader title={title} desc={desc} />

      <div className="mt-6 flex items-center gap-5 border-b border-edge">
        {tabs.map((t) => (
          <Tab key={t.id} active={current.id === t.id} onClick={() => onTab(t.id)}>
            {t.label}
          </Tab>
        ))}
      </div>

      <div className="mt-7">{current.body}</div>
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
