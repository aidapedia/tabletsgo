import type { ReactNode } from 'react'
import Avatar from '@/shared/ui/Avatar'

// The avatar + name + email trio used in member/people lists. Renders a
// fragment so it can sit inside any flex row (plain rows, CheckboxRow, …);
// the parent supplies layout, trailing actions, and borders.
export default function PersonRow({
  name,
  email,
  size = 'sm',
  suffix,
  emailClassName = '',
}: {
  name?: string
  email: string
  size?: 'sm' | 'md'
  suffix?: ReactNode
  emailClassName?: string
}) {
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
