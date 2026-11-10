import { useState, type ComponentProps } from 'react'
import { Button } from '@/shared/ui/button'
import { RefreshIcon } from '@/shared/ui/icons'

type RefreshButtonProps = {
  /** May return a promise — the icon keeps turning until it settles. */
  onRefresh: () => unknown
  /** Also spin while the owner is loading on its own (initial load, a reload it triggered). */
  busy?: boolean
  iconSize?: number
} & Omit<ComponentProps<typeof Button>, 'onClick'>

// The icon-only refresh button: its icon turns until the data is back.
export default function RefreshButton({ onRefresh, busy = false, iconSize = 16, variant = 'ghost', size = 'icon-sm', ...props }: RefreshButtonProps) {
  const [pending, setPending] = useState(false)

  const refresh = async () => {
    setPending(true)
    try {
      await onRefresh()
    } finally {
      setPending(false)
    }
  }

  return (
    <Button variant={variant} size={size} onClick={refresh} {...props}>
      <RefreshIcon width={iconSize} height={iconSize} spinning={pending || busy} />
    </Button>
  )
}
