import { useState, type ComponentProps } from 'react'
import IconButton from './IconButton'
import { RefreshIcon } from '@/shared/ui/icons'

type RefreshButtonProps = {
  /** May return a promise — the icon keeps turning until it settles. */
  onRefresh: () => unknown
  /** Also spin while the owner is loading on its own (initial load, a reload it triggered). */
  busy?: boolean
  iconSize?: number
} & Omit<ComponentProps<typeof IconButton>, 'onClick'>

// The icon-only refresh button: its icon turns until the data is back.
export default function RefreshButton({ onRefresh, busy = false, iconSize = 16, ...props }: RefreshButtonProps) {
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
    <IconButton onClick={refresh} {...props}>
      <RefreshIcon width={iconSize} height={iconSize} spinning={pending || busy} />
    </IconButton>
  )
}
