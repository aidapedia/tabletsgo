import type { ButtonHTMLAttributes, ReactNode } from 'react'

// Compact square icon-only button used in sidebar/panel headers, toolbars and
// dropdown triggers. `active` pins the hover look (e.g. an open menu/toggle).
const SIZES = {
  xs: 'h-[18px] w-[18px] rounded', // tab close button
  sm: 'h-6 w-6 rounded', // dropdown/kebab triggers
  md: 'h-[28px] w-[28px] rounded-[7px]', // default header/toolbar icon button
  lg: 'h-8 w-8 rounded-soft', // prominent sidebar toggle
  xl: 'h-10 w-10 rounded-soft', // icon rail nav buttons
  toolbar: 'h-[34px] w-[34px] rounded-[10px]', // console top toolbar icon button
}

type IconButtonProps = {
  active?: boolean
  size?: keyof typeof SIZES
  className?: string
  children?: ReactNode
} & ButtonHTMLAttributes<HTMLButtonElement>

export default function IconButton({ active = false, size = 'md', className = '', children, ...props }: IconButtonProps) {
  return (
    <button
      className={`flex items-center justify-center ${SIZES[size]} ${
        active ? 'bg-elevated text-ink' : 'text-ink-dim hover:bg-elevated hover:text-ink'
      } ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
