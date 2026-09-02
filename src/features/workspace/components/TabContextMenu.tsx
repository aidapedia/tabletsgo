import ContextMenu from '@/shared/ui/overlay/ContextMenu'
import MenuItem from '@/shared/ui/navigation/MenuItem'
import { SplitHorizontalIcon, SplitVerticalIcon } from '@/shared/ui/icons'
import type { ConsoleTab, SplitDir } from '../hooks/useConsoleTabs'

/**
 * Right-clicking a tab. Every "close …" entry acts inside that tab's own pane —
 * the other pane's tabs are a separate group and are never touched — and
 * splitting is just "move this tab to the other pane", so which side it lands
 * on is the split's orientation.
 */
export default function TabContextMenu({
  menu,
  tabs,
  splitDir,
  paneOf,
  onClose,
  onCloseTab,
  onCloseOthers,
  onCloseToRight,
  onCloseAll,
  onMoveToPane,
}: {
  menu: { x: number; y: number; key: string }
  tabs: ConsoleTab[]
  splitDir: SplitDir
  paneOf: (key: string) => number
  onClose: () => void
  onCloseTab: (key: string) => void
  onCloseOthers: (key: string) => void
  onCloseToRight: (key: string) => void
  onCloseAll: (pane: number) => void
  onMoveToPane: (key: string, pane: number, dir?: SplitDir) => void
}) {
  const pane = paneOf(menu.key)
  const own = tabs.filter((t) => t.pane === pane)
  const isLast = own.findIndex((t) => t.key === menu.key) === own.length - 1
  const act = (fn: () => void) => () => {
    fn()
    onClose()
  }

  return (
    <ContextMenu x={menu.x} y={menu.y} width={190} onClose={onClose}>
      <MenuItem onClick={act(() => onCloseTab(menu.key))}>Close</MenuItem>
      <MenuItem disabled={own.length < 2} onClick={act(() => onCloseOthers(menu.key))}>
        Close other tabs
      </MenuItem>
      <MenuItem disabled={isLast} onClick={act(() => onCloseToRight(menu.key))}>
        Close tabs to the right
      </MenuItem>
      <MenuItem onClick={act(() => onCloseAll(pane))}>Close all tabs</MenuItem>
      <div className="my-1 h-px bg-edge" />
      {pane === 1 || splitDir ? (
        <MenuItem onClick={act(() => onMoveToPane(menu.key, pane === 1 ? 0 : 1))}>
          <SplitVerticalIcon width={14} height={14} /> Move to other group
        </MenuItem>
      ) : (
        <>
          <MenuItem onClick={act(() => onMoveToPane(menu.key, 1, 'vertical'))}>
            <SplitVerticalIcon width={14} height={14} /> Split right
          </MenuItem>
          <MenuItem onClick={act(() => onMoveToPane(menu.key, 1, 'horizontal'))}>
            <SplitHorizontalIcon width={14} height={14} /> Split down
          </MenuItem>
        </>
      )}
    </ContextMenu>
  )
}
