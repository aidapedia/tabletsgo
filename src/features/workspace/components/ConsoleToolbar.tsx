import type { ReactNode } from 'react'
import Button from '@/shared/ui/buttons/Button'
import IconButton from '@/shared/ui/buttons/IconButton'
import Tooltip from '@/shared/ui/overlay/Tooltip'
import Popover from '@/shared/ui/overlay/Popover'
import MenuItem from '@/shared/ui/navigation/MenuItem'
import { formatCombo } from '@/features/keymap'
import {
  CodeIcon,
  DiagramIcon,
  GridIcon,
  HistoryIcon,
  MenuIcon,
  MoreVerticalIcon,
  SearchIcon,
  TableIcon,
  TagIcon,
  TerminalIcon,
  WorkflowIcon,
} from '@/shared/ui/icons'

type Props = {
  isRedis: boolean
  bindings: any
  schemaVersion: number
  changeCount: number
  onOpenDrawer: () => void
  onCreateTable: () => void
  onNewQuery: () => void
  onNewWorkflow: () => void
  onNewDashboard: () => void
  onOpenPalette: () => void
  onOpenHistory: () => void
  onOpenSchemaEditor: () => void
  onOpenSchemaHistory: () => void
  onOpenChanges: () => void
  /** The hidden file inputs the import entries drive, rendered inline. */
  filePickers?: ReactNode
}

/**
 * The console's top bar: one "New" menu, the command-palette search, and the
 * staged-changes counter.
 *
 * The New menu deliberately mirrors the palette's Create group — same entries,
 * same actions — so neither becomes the only way to reach something. What the
 * bar can't fit on a narrow screen moves into the overflow menu rather than
 * disappearing.
 */
export default function ConsoleToolbar({
  isRedis,
  bindings,
  schemaVersion,
  changeCount,
  onOpenDrawer,
  onCreateTable,
  onNewQuery,
  onNewWorkflow,
  onNewDashboard,
  onOpenPalette,
  onOpenHistory,
  onOpenSchemaEditor,
  onOpenSchemaHistory,
  onOpenChanges,
  filePickers,
}: Props) {
  return (
    <div className="flex items-center gap-3 border-b border-edge px-[18px] py-3 max-[720px]:px-3">
      <div className="hidden max-[720px]:block">
        <IconButton size="toolbar" className="!rounded-soft" onClick={onOpenDrawer} aria-label="Open tables">
          <MenuIcon />
        </IconButton>
      </div>

      <Popover
        width={230}
        trigger={({ open, toggle }: any) => (
          <Tooltip label="New…" placement="bottom">
            <IconButton size="toolbar" active={open} onClick={toggle} aria-label="Create new">
              {isRedis ? <TerminalIcon width={16} height={16} /> : <CodeIcon width={16} height={16} />}
            </IconButton>
          </Tooltip>
        )}
      >
        {({ close }: any) => (
          <div className="p-1">
            {!isRedis && (
              <MenuItem onClick={() => { onCreateTable(); close() }}>
                <TableIcon width={14} height={14} /> New table
              </MenuItem>
            )}
            <MenuItem onClick={() => { onNewQuery(); close() }}>
              {isRedis ? <TerminalIcon width={14} height={14} /> : <CodeIcon width={14} height={14} />}
              {isRedis ? 'New console' : 'New SQL query'}
              <kbd className="ml-auto rounded-[5px] border border-edge bg-elevated px-1.5 py-px text-[11px] text-ink-faint">
                {formatCombo(bindings['general.newTab'])}
              </kbd>
            </MenuItem>
            <MenuItem onClick={() => { onNewWorkflow(); close() }}>
              <WorkflowIcon width={14} height={14} /> New workflow
            </MenuItem>
            <MenuItem onClick={() => { onNewDashboard(); close() }}>
              <GridIcon width={14} height={14} /> New dashboard
            </MenuItem>
          </div>
        )}
      </Popover>

      {filePickers}

      <button
        type="button"
        onClick={onOpenPalette}
        className="relative flex min-w-0 max-w-[560px] flex-1 items-center rounded-[10px] border border-edge bg-elevated py-[9px] pl-10 pr-3.5 text-left text-xs text-ink-faint transition-colors hover:border-edge-strong"
      >
        <SearchIcon width={16} height={16} className="absolute left-3.5 text-ink-faint" />
        <span>Search or run commands…</span>
        <kbd className="absolute right-3 rounded-[5px] border border-edge bg-card px-1.5 py-px text-[11px] text-ink-faint max-[720px]:hidden">
          {formatCombo(bindings['general.search'])}
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-2">
        {/* Environment + schema version live in the bottom status bar. */}
        <div className="flex items-center gap-2 max-[720px]:hidden">
          <Tooltip label="Query history" placement="bottom">
            <IconButton size="toolbar" onClick={onOpenHistory} aria-label="Query history">
              <HistoryIcon width={16} height={16} />
            </IconButton>
          </Tooltip>
          {/* Leaves the console for the Schema Editor page, so unlike the panel
              buttons there is no active state to mark. Schemaless engines
              (Redis) have no diagram to draw, so it hides. */}
          {!isRedis && (
            <Tooltip label="Schema editor" placement="bottom">
              <IconButton size="toolbar" onClick={onOpenSchemaEditor} aria-label="Schema editor">
                <DiagramIcon width={16} height={16} />
              </IconButton>
            </Tooltip>
          )}
        </div>

        {/* Mobile overflow: the history/schema entries hidden above. */}
        <div className="hidden max-[720px]:block">
          <Popover
            align="right"
            width={210}
            trigger={({ open, toggle }: any) => (
              <IconButton size="toolbar" active={open} onClick={toggle} aria-label="More actions">
                <MoreVerticalIcon width={16} height={16} />
              </IconButton>
            )}
          >
            {({ close }: any) => (
              <div className="p-1">
                <MenuItem onClick={() => { onOpenHistory(); close() }}>
                  <HistoryIcon width={14} height={14} /> Query history
                </MenuItem>
                {!isRedis && (
                  <MenuItem onClick={() => { onOpenSchemaEditor(); close() }}>
                    <DiagramIcon width={14} height={14} /> Schema editor
                  </MenuItem>
                )}
                <MenuItem onClick={() => { onOpenSchemaHistory(); close() }}>
                  <TagIcon width={14} height={14} /> Schema history (v{schemaVersion})
                </MenuItem>
              </div>
            )}
          </Popover>
        </div>

        <Button variant="ghost" onClick={onOpenChanges} title="View changes">
          <span className="max-[720px]:hidden">Changes</span>
          <span
            className={`rounded-[20px] px-[7px] text-xs ${
              changeCount > 0 ? 'bg-green text-white' : 'bg-edge text-ink-faint'
            }`}
          >
            {changeCount}
          </span>
        </Button>
      </div>
    </div>
  )
}
