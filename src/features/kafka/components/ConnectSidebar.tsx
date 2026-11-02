import { useCallback, useEffect, useMemo, useState } from 'react'
import IconButton from '@/shared/ui/buttons/IconButton'
import RefreshButton from '@/shared/ui/buttons/RefreshButton'
import ListRow from '@/shared/ui/ListRow'
import RowLabel from '@/shared/ui/RowLabel'
import Tooltip from '@/shared/ui/overlay/Tooltip'
import SearchInput from '@/shared/ui/form/SearchInput'
import { PlusIcon, SearchIcon } from '@/shared/ui/icons'
import { listConnectors, type ConnectorSummary } from '../lib/api'
import { StateDot } from './ConnectorView'

/**
 * The console's sidebar for the connection's Kafka Connect cluster (its own
 * rail entry): connectors with their state and task counts, failed ones first.
 * A connector opens in a tab; + opens a tab for a new one.
 */
export default function ConnectSidebar({
  conn,
  activeConnector,
  onOpenConnector,
}: {
  conn: any
  activeConnector?: string | null
  /** null opens a new connector. */
  onOpenConnector: (name: string | null) => void
}) {
  const [connectors, setConnectors] = useState<ConnectorSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)

  const load = useCallback(
    () =>
      listConnectors(conn)
        .then((list) => {
          setConnectors(list)
          setError(null)
        })
        .catch((e) => setError(e.message)),
    [conn]
  )
  useEffect(() => {
    load()
  }, [load])

  const needle = filter.trim().toLowerCase()
  const shown = useMemo(
    () =>
      (connectors || [])
        .filter((c) => !needle || c.name.toLowerCase().includes(needle) || (c.className || '').toLowerCase().includes(needle))
        .sort((a, b) => b.failedTasks - a.failedTasks || a.name.localeCompare(b.name)),
    [connectors, needle]
  )

  return (
    <>
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <span className="text-xs font-semibold">Kafka Connect</span>
        <div className="flex gap-1">
          <Tooltip label="Refresh" placement="bottom">
            <RefreshButton onRefresh={load} aria-label="Refresh connectors" />
          </Tooltip>
          <Tooltip label="Search connectors" placement="bottom">
            <IconButton
              active={searchOpen}
              onClick={() => {
                if (searchOpen) setFilter('')
                setSearchOpen((o) => !o)
              }}
              aria-label="Search connectors"
            >
              <SearchIcon width={15} height={15} />
            </IconButton>
          </Tooltip>
          <Tooltip label="New connector" placement="bottom">
            <IconButton onClick={() => onOpenConnector(null)} aria-label="New connector">
              <PlusIcon width={15} height={15} />
            </IconButton>
          </Tooltip>
        </div>
      </div>

      {searchOpen && (
        <SearchInput
          autoFocus
          className="mx-3.5 mb-2"
          placeholder="Filter by name or class"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setFilter('')
              setSearchOpen(false)
            }
          }}
          inputClassName="!rounded-[9px] !text-xs"
        />
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
        {error && <div className="m-2 rounded-[9px] border border-red/25 bg-red/10 px-3 py-2.5 text-[11px] text-[#ff9b9b]">{error}</div>}
        {!error && connectors === null && <div className="p-6 text-center text-xs text-ink-faint">Reading connectors…</div>}
        {!error && connectors && !shown.length && (
          <div className="p-6 text-center text-xs text-ink-faint">{needle ? `No connectors match "${filter.trim()}".` : 'No connectors yet.'}</div>
        )}
        {shown.map((c) => (
          <ListRow
            key={c.name}
            active={activeConnector === c.name}
            onClick={() => onOpenConnector(c.name)}
            title={c.className || c.name}
            icon={<StateDot state={c.failedTasks ? 'FAILED' : c.state} />}
            className="!py-2"
          >
            <span className="min-w-0 flex-1">
              <RowLabel className={`block ${activeConnector === c.name ? 'font-medium' : ''}`}>{c.name}</RowLabel>
              <span className="block truncate text-[10px] text-ink-faint">
                {c.type || 'connector'} · {c.state.toLowerCase()} · {c.tasks.length} task{c.tasks.length === 1 ? '' : 's'}
                {c.failedTasks ? <span className="text-red"> · {c.failedTasks} failed</span> : null}
              </span>
            </span>
          </ListRow>
        ))}
      </div>

      {connectors && (
        <div className="border-t border-edge px-4 py-2 text-[10px] text-ink-faint">
          {connectors.length} connector{connectors.length === 1 ? '' : 's'}
          {connectors.some((c) => c.failedTasks) && <span className="text-red"> · {connectors.filter((c) => c.failedTasks).length} with failed tasks</span>}
        </div>
      )}
    </>
  )
}
