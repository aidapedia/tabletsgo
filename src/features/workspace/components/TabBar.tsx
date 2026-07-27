import { useState } from 'react'
import {
  CloseIcon,
  CodeIcon,
  ColumnsIcon,
  DiagramIcon,
  GridIcon,
  HistoryIcon,
  TableIcon,
  WandIcon,
  WorkflowIcon,
} from '@/shared/ui/icons'
import IconButton from '@/shared/ui/buttons/IconButton'

// One icon per tab kind; anything unknown falls back to a table.
const KIND_ICON = {
  query: CodeIcon,
  schema: ColumnsIcon,
  schemaEditor: DiagramIcon,
  history: HistoryIcon,
  schemaHistory: HistoryIcon,
  function: CodeIcon,
  workflow: WorkflowIcon,
  dashboard: GridIcon,
  template: WandIcon,
}

/**
 * The console's open-tab strip. Tabs can be dragged left/right to reorder:
 * dragging shows an insertion caret on the half of the tab the pointer is
 * nearest, and the move is committed on drop via `onReorder(fromKey, toKey,
 * before)`. Dropping past the last tab (the trailing filler) passes
 * `toKey = null`, meaning "move to the end".
 */
export default function TabBar({ tabs = [], activeTab, onSelect, onClose, onContextMenu, onReorder }) {
  const [dragKey, setDragKey] = useState(null) // key of the tab being dragged
  const [dropAt, setDropAt] = useState(null) // { key: string | null, before: boolean }

  const clearDrag = () => {
    setDragKey(null)
    setDropAt(null)
  }

  // A drop is a no-op when it lands on either side of the dragged tab itself.
  const isNoop = (key, before) => {
    if (key === dragKey) return true
    const from = tabs.findIndex((t) => t.key === dragKey)
    const to = tabs.findIndex((t) => t.key === key)
    if (from === -1 || to === -1) return false
    return before ? to === from + 1 : to === from - 1
  }

  const dragOverTab = (key) => (e) => {
    if (!dragKey) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = e.currentTarget.getBoundingClientRect()
    const before = e.clientX < rect.left + rect.width / 2
    setDropAt(isNoop(key, before) ? null : { key, before })
  }

  // Commit at the caret's position (no caret = the pointer sits where the tab
  // already is, so the drop is a no-op).
  const dropOnTab = (e) => {
    if (!dragKey) return
    e.preventDefault()
    if (dropAt) onReorder?.(dragKey, dropAt.key, dropAt.before)
    clearDrag()
  }

  // Trailing zone: dropping here always means "append", unless already last.
  const atEnd = dragKey && tabs[tabs.length - 1]?.key !== dragKey
  const endProps = {
    onDragOver: (e) => {
      if (!atEnd) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setDropAt({ key: null, before: false })
    },
    onDrop: (e) => {
      if (!atEnd) return
      e.preventDefault()
      onReorder?.(dragKey, null, false)
      clearDrag()
    },
  }

  // Insertion caret; positioned by the caller relative to its (relative) parent.
  const caret = (pos) => <span className={`absolute inset-y-1 w-[2px] rounded-full bg-green ${pos}`} />

  return (
    <div className="flex items-stretch gap-1 overflow-x-auto border-b border-edge bg-panel px-1.5 pt-1.5">
      {tabs.map((t) => {
        const active = activeTab === t.key
        const Icon = KIND_ICON[t.kind] || TableIcon
        return (
          <div
            key={t.key}
            draggable
            onDragStart={(e) => {
              setDragKey(t.key)
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/plain', t.key)
            }}
            onDragEnd={clearDrag}
            onDragOver={dragOverTab(t.key)}
            onDrop={dropOnTab}
            onClick={() => onSelect(t.key)}
            onContextMenu={(e) => onContextMenu(e, t.key)}
            className={`group/tab relative flex cursor-pointer items-center gap-2.5 whitespace-nowrap rounded-t-[8px] px-3.5 py-2.5 text-xs transition-colors ${
              active ? 'bg-elevated font-medium text-ink' : 'text-ink-dim hover:bg-elevated/40 hover:text-ink'
            } ${dragKey === t.key ? 'opacity-50' : ''}`}
          >
            {active && <span className="absolute inset-x-0 bottom-0 h-[2px] bg-green" />}
            {dropAt?.key === t.key && caret(dropAt.before ? '-left-[3px]' : '-right-[3px]')}
            <Icon className={active ? 'text-ink' : 'text-ink-faint'} />
            <span>{t.title}</span>
            <IconButton
              size="xs"
              className="shrink-0 !text-ink-faint opacity-70 group-hover/tab:opacity-100"
              onClick={(e) => onClose(e, t.key)}
              aria-label="Close tab"
            >
              <CloseIcon width={13} height={13} />
            </IconButton>
          </div>
        )
      })}
      {tabs.length === 0 && <div className="px-3 py-2.5 text-[11px] text-ink-faint">No open tabs</div>}
      {/* Free space after the last tab — an "append here" drop target. Collapses
          to nothing once the tabs overflow (then the last tab's right half does it). */}
      <div className="relative min-w-0 flex-1" {...endProps}>
        {dropAt?.key === null && caret('left-0')}
      </div>
    </div>
  )
}
