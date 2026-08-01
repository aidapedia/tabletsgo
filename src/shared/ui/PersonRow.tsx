import type { ReactNode } from 'react'
import Avatar from '@/shared/ui/Avatar'

// The avatar + name + email trio used in member/people lists. Renders a
// fragment so it can sit inside any flex row (plain rows, CheckboxRow, …);
// the parent supplies layout, trailing actions, and borders.
//
// `stacked` puts the email under the name instead of at the far right of the
// row — what a table cell wants, where a right-aligned email would drift away
// from the person it belongs to.
export default function PersonRow({
  name,
  email,
  size = 'sm',
  suffix,
  stacked = false,
  emailClassName = '',
}: {
  name?: string
  email: string
  size?: 'sm' | 'md'
  suffix?: ReactNode
  stacked?: boolean
  emailClassName?: string
}) {
  if (stacked)
    return (
      <>
        <Avatar size={size} label={name || email} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[12px]">
            {name || email}
            {suffix}
          </span>
          {/* Only worth a second line when the name isn't already the email. */}
          {name && <span className={`truncate text-[10px] text-ink-faint ${emailClassName}`}>{email}</span>}
        </span>
      </>
    )

  return (
    <>
      <Avatar size={size} label={name || email} />
      <span className="min-w-0 flex-1 truncate text-[12px]">
        {name || email}
        {suffix}
      </span>
      <span className={`shrink-0 text-[10px] text-ink-faint ${emailClassName}`}>{email}</span>
    </>
  )
}
