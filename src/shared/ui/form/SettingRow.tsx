import type { ReactNode } from 'react'

/**
 * One labelled settings row: title + description on the left, control(s) on
 * the right, in a bordered card. The shared look for settings lists
 * (Settings > Data, Workspace > Config).
 */
export default function SettingRow({
  title,
  desc,
  children,
}: {
  title: string
  desc?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-card border border-edge bg-card p-4">
      <div className="min-w-0">
        <div className="text-[13px] font-semibold">{title}</div>
        {desc && <div className="mt-0.5 text-[11px] leading-relaxed text-ink-dim">{desc}</div>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  )
}
