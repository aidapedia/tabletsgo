import type { ButtonHTMLAttributes, ComponentType, ReactNode } from 'react'
import { ChevronDown } from '@/shared/ui/icons'

type IconType = ComponentType<{ width?: number; height?: number; className?: string }>

const VARIANTS = {
  primary: 'bg-green text-white hover:bg-green-bright',
  ghost: 'border border-edge bg-elevated text-ink hover:bg-card-hover hover:border-edge-strong',
  danger: 'border border-red/30 bg-transparent text-red hover:bg-red/10',
  toolbar: 'text-ink-dim hover:bg-elevated hover:text-ink',
  subtle: 'text-ink-dim hover:bg-elevated hover:text-ink',
}

const SIZES = {
  sm: 'px-2.5 py-1.5 text-[11px] gap-1.5',
  md: 'px-3 py-2 text-xs gap-2',
  lg: 'px-[18px] py-2.5 text-xs gap-2', // prominent CTAs (auth/setup, modal footers)
}

/**
 * Reusable button used across toolbars/menus.
 * Props: variant, size, icon (component), iconRight (component), chevron, active.
 */
type ButtonProps = {
  variant?: keyof typeof VARIANTS
  size?: keyof typeof SIZES
  icon?: IconType
  iconRight?: IconType
  chevron?: boolean
  active?: boolean
  className?: string
  children?: ReactNode
} & ButtonHTMLAttributes<HTMLButtonElement>

export default function Button({
  variant = 'ghost',
  size = 'md',
  icon: Icon,
  iconRight: IconRight,
  chevron = false,
  active = false,
  className = '',
  children,
  ...props
}: ButtonProps) {
  const base =
    'inline-flex items-center justify-center whitespace-nowrap rounded-soft font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
  const look = active ? 'bg-elevated text-ink' : VARIANTS[variant]
  return (
    <button className={`${base} ${SIZES[size]} ${look} ${className}`} {...props}>
      {Icon && <Icon width={15} height={15} className="shrink-0" />}
      {children}
      {IconRight && <IconRight width={15} height={15} className="shrink-0" />}
      {chevron && <ChevronDown width={14} height={14} className="shrink-0 opacity-70" />}
    </button>
  )
}
