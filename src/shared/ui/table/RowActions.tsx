import type { ComponentType, ReactNode } from 'react'
import Button from '@/shared/ui/buttons/Button'
import Popover from '@/shared/ui/overlay/Popover'
import Tooltip from '@/shared/ui/overlay/Tooltip'
import { MoreVerticalIcon } from '@/shared/ui/icons'

/**
 * The action cell of a `DataTable` row — one look for every table in the app.
 *
 *   {
 *     key: 'actions', header: '', align: 'right', width: 120,
 *     render: (row) => (
 *       <RowActions>
 *         <RowAction icon={KeyIcon} label="Change password" aria={…} onClick={…} />
 *         <RowAction icon={TrashIcon} label="Delete" tone="danger" aria={…} onClick={…} />
 *         <RowMenu label="Storage actions">{({ close }) => …}</RowMenu>
 *       </RowActions>
 *     ),
 *   }
 *
 * Two shapes, deliberately the same size and surface: a direct action
 * (`RowAction`) and an overflow menu (`RowMenu`). Mixing them in one row should
 * look like one control strip, not two kinds of button, so the menu trigger is
 * the same button as the actions beside it.
 */
type IconType = ComponentType<{ width?: number; height?: number; className?: string }>

// The row's own click usually opens a detail view; an action button is not a
// request to also open it, so the whole strip stops the click here rather than
// every table remembering to.
export function RowActions({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex items-center justify-end gap-1.5 ${className}`} onClick={(e) => e.stopPropagation()}>
      {children}
    </div>
  )
}

// What the button means, not what colour it is: the hover tint follows.
const TONES = {
  default: '',
  positive: 'hover:!text-green hover:!border-green/40',
  danger: 'hover:!text-red hover:!border-red/40',
}

/** The shared geometry — a compact square-ish icon button on the ghost surface. */
const ACTION_CLASS = '!px-2 !py-1.5'

/**
 * One direct action. Icon-only, with the label on a tooltip — a row can hold
 * three of these without turning into a sentence.
 *
 * An action that doesn't apply to this row is disabled with `disabledHint`
 * rather than dropped, so the column doesn't reshuffle from row to row and a
 * dead button still says why. The tooltip wraps the button (a disabled button
 * swallows its own mouse events, which is exactly the case that needs the
 * explanation).
 */
export function RowAction({
  icon,
  label,
  aria,
  disabledHint,
  tone = 'default',
  disabled = false,
  onClick,
}: {
  icon: IconType
  label: string
  /** Full accessible name — the terse visual label doesn't say which row. */
  aria: string
  disabledHint?: string
  tone?: keyof typeof TONES
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <Tooltip label={disabled && disabledHint ? disabledHint : label}>
      <Button
        size="sm"
        icon={icon}
        aria-label={aria}
        disabled={disabled}
        onClick={onClick}
        className={`${ACTION_CLASS} text-ink-dim ${disabled ? '' : TONES[tone]}`}
      />
    </Tooltip>
  )
}

/**
 * The overflow menu: the same button, opening a `MenuItem` list. Use it once a
 * row has more actions than fit as icons, or for actions that need words
 * ("Copy as URL", "Export as JSON").
 *
 * Always portaled — a `DataTable`'s body scrolls horizontally, which clips an
 * in-flow panel.
 */
export function RowMenu({
  children,
  label = 'Row actions',
  width = 170,
}: {
  children: (ctx: { close: () => void }) => ReactNode
  /** Accessible name for the trigger — say which row's actions these are. */
  label?: string
  width?: number
}) {
  return (
    <Popover
      align="right"
      width={width}
      portal
      trigger={({ open, toggle }) => (
        <Button
          size="sm"
          icon={MoreVerticalIcon}
          active={open}
          aria-label={label}
          onClick={toggle}
          // `text-ink-dim` only while closed — an open menu keeps `active`'s
          // full-strength text, and the two colour utilities would otherwise
          // race by stylesheet order.
          className={`${ACTION_CLASS} ${open ? '' : 'text-ink-dim'}`}
        />
      )}
    >
      {children}
    </Popover>
  )
}
