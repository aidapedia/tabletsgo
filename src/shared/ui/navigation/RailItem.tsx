import type { ComponentType, MouseEvent } from 'react'
import NavItem from '@/shared/ui/navigation/NavItem'
import Tooltip from '@/shared/ui/overlay/Tooltip'

type IconType = ComponentType<{ width?: number; height?: number; className?: string }>

/**
 * One row of a 56px icon rail: a 40px target holding just an icon, named by a
 * tooltip on the right because the label has nowhere to render.
 *
 * Both rails in the app are built from this — the console's `IconRail` and the
 * home sidebar in its collapsed state — so the two read as the same object.
 * `href` makes it a real link (the home rail's rows are routes); without one it
 * stays a button (the console's rows toggle panels in place).
 *
 * The row is a fixed 40x40 box, so the rail that owns it only has to supply an
 * 8px gutter to centre it in 56px. The tooltip wrapper is pinned to that size
 * too — as a stretched flex item it would otherwise take the container's width
 * and anchor the tooltip to that instead of to the button.
 */
export default function RailItem({
  icon,
  label,
  active = false,
  href,
  onClick,
}: {
  icon: IconType
  label: string
  active?: boolean
  href?: string
  onClick?: (e: MouseEvent) => void
}) {
  return (
    <Tooltip label={label} placement="right" wrapperClassName="w-10">
      <NavItem collapsed active={active} icon={icon} href={href} onClick={onClick as any}>
        {label}
      </NavItem>
    </Tooltip>
  )
}

// The hairline between rail groups: 28px, centred by the rail's own gutter.
export const RailDivider = () => <div className="mx-1.5 my-2 h-px bg-edge" />
