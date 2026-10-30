import type { ReactNode } from 'react'
import Button from '@/shared/ui/buttons/Button'
import IconButton from '@/shared/ui/buttons/IconButton'
import Tooltip from '@/shared/ui/overlay/Tooltip'
import Popover from '@/shared/ui/overlay/Popover'
import MenuItem from '@/shared/ui/navigation/MenuItem'
import { formatCombo } from '@/features/keymap'
import type { ConsoleKind } from '@/shared/config/databaseTypes'
import {
  CodeIcon,
  DiagramIcon,
  GridIcon,
  HistoryIcon,
  MenuIcon,
  MoreVerticalIcon,
  SearchIcon,
  SendIcon,
  TableIcon,
  TagIcon,
  TerminalIcon,
  TransferIcon,
  WorkflowIcon,
} from '@/shared/ui/icons'

type Props = {
  kind: ConsoleKind
  bindings: any
  schemaVersion: number
  changeCount: number
  /** False when nothing can be staged: Redis/Kafka, or Direct execute on. */
  showChanges: boolean
  onOpenDrawer: () => void
  onCreateTable: () => void
  onNewQuery: () => void
  onNewWorkflow: () => void
  onNewDashboard: () => void
  onOpenPalette: () => void
  onOpenHistory: () => void
  /** Kafka only: a blank produce form, no topic picked yet. */
  onProduce: () => void
  onOpenTransfer: () => void
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
  kind,
  bindings,
  schemaVersion,
  changeCount,
  showChanges,
  onOpenDrawer,
  onCreateTable,
  onNewQuery,
  onNewWorkflow,
  onNewDashboard,
  onOpenPalette,
  onOpenHistory,
  onProduce,
  onOpenTransfer,
  onOpenSchemaEditor,
  onOpenSchemaHistory,
  onOpenChanges,
  filePickers,
}: Props) {
  // Redis and Kafka have no tables to create, browse, export or diagram.
  const tableless = kind !== 'sql'
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
              {tableless ? <TerminalIcon width={16} height={16} /> : <CodeIcon width={16} height={16} />}
            </IconButton>
          </Tooltip>
        )}
      >
        {({ close }: any) => (
          <div className="p-1">
            {!tableless && (
              <MenuItem onClick={() => { onCreateTable(); close() }}>
                <TableIcon width={14} height={14} /> New table
              </MenuItem>
            )}
            <MenuItem onClick={() => { onNewQuery(); close() }}>
              {tableless ? <TerminalIcon width={14} height={14} /> : <CodeIcon width={14} height={14} />}
              {tableless ? 'New console' : 'New SQL query'}
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
          {kind === 'stream' && (
            <Tooltip label="Produce message" placement="bottom">
              <IconButton size="toolbar" onClick={onProduce} aria-label="Produce message">
                <SendIcon width={16} height={16} />
              </IconButton>
            </Tooltip>
          )}
          {/* Table rows out to / in from CSV, JSON or SQL files — one tab, its
              own Export/Import switch. Tableless engines (Redis, Kafka) have no rows
              to move, so it hides. */}
          {!tableless && (
            <Tooltip label="Export / Import" placement="bottom">
              <IconButton size="toolbar" onClick={onOpenTransfer} aria-label="Export / Import">
                <TransferIcon width={16} height={16} />
              </IconButton>
            </Tooltip>
          )}
          {/* Leaves the console for the Schema Editor page, so unlike the panel
              buttons there is no active state to mark. Schemaless engines
              (Redis, Kafka) have no diagram to draw, so it hides. */}
          {!tableless && (
            <Tooltip label="Schema editor" placement="bottom">
              <IconButton size="toolbar" onClick={onOpenSchemaEditor} aria-label="Schema editor">
                <DiagramIcon width={16} height={16} />
              </IconButton>
            </Tooltip>
          )}
        </div>

        {/* Mobile overflow: the history/produce/transfer/schema entries hidden above. */}
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
                {kind === 'stream' && (
                  <MenuItem onClick={() => { onProduce(); close() }}>
                    <SendIcon width={14} height={14} /> Produce message
                  </MenuItem>
                )}
                {!tableless && (
                  <MenuItem onClick={() => { onOpenTransfer(); close() }}>
                    <TransferIcon width={14} height={14} /> Export / Import
                  </MenuItem>
                )}
                {!tableless && (
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

        {showChanges && (
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
        )}
      </div>
    </div>
  )
}
