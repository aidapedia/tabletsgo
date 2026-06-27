import { useMemo, useState } from 'react'
import { CloseIcon, CodeIcon, FolderIcon, PlusIcon, RefreshIcon } from '../icons.jsx'
import { relativeTime } from '../../recents.js'
import { iconMini } from '../../ui.js'
import Segmented from '../ui/Segmented.jsx'
import Tooltip from '../ui/Tooltip.jsx'

export default function SavedQueriesPanel({ saved = [], recents, onOpen, onDeleteSaved, onNew, onRefresh, onClear }) {
  const [sort, setSort] = useState('az')

  const sortedSaved = useMemo(() => {
    const arr = [...saved]
    arr.sort((a, b) => (sort === 'az' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name)))
    return arr
  }, [saved, sort])

  const sortedRecents = useMemo(() => {
    const arr = [...recents]
    arr.sort((a, b) => (sort === 'az' ? a.sql.localeCompare(b.sql) : b.sql.localeCompare(a.sql)))
    return arr
  }, [recents, sort])

  return (
    <>
      <div className="flex items-center justify-between px-4 pb-2.5 pt-4">
        <span className="text-xs font-semibold">Saved queries</span>
        <div className="flex gap-1">
          <Tooltip label="Refresh" placement="bottom">
            <button className={iconMini} onClick={onRefresh}>
              <RefreshIcon />
            </button>
          </Tooltip>
          <Tooltip label="New query" placement="bottom">
            <button className={iconMini} onClick={onNew}>
              <PlusIcon width={14} height={14} />
            </button>
          </Tooltip>
          <Tooltip label="Folders (coming soon)" placement="bottom">
            <button className={iconMini}>
              <FolderIcon />
            </button>
          </Tooltip>
        </div>
      </div>

      <div className="px-3.5 pb-2">
        <Segmented
          value={sort}
          onChange={setSort}
          options={[
            { value: 'az', label: 'A–Z' },
            { value: 'za', label: 'Z–A' },
          ]}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {/* Saved (named) queries */}
        {saved.length === 0 ? (
          <div className="px-2 py-3 text-[11px] text-ink-faint">No saved queries yet.</div>
        ) : (
          <div className="flex flex-col gap-1">
            {sortedSaved.map((q) => (
              <div
                key={q.id}
                className="group flex items-start gap-2.5 rounded-[8px] px-2.5 py-2 text-ink-dim hover:bg-elevated hover:text-ink"
              >
                <CodeIcon className="mt-0.5 shrink-0 text-ink-faint" width={14} height={14} />
                <Tooltip label={q.sql} placement="right" multiline wrapperClassName="min-w-0 flex-1">
                  <button onClick={() => onOpen(q.sql)} className="w-full text-left">
                    <div className="truncate text-[12px] font-semibold text-ink">{q.name}</div>
                    <div className="mt-0.5 truncate font-mono text-[10px] text-ink-faint">{q.sql}</div>
                  </button>
                </Tooltip>
                <Tooltip label="Delete" placement="left">
                  <button
                    onClick={() => onDeleteSaved?.(q.id)}
                    className="shrink-0 text-ink-faint opacity-0 transition-opacity hover:text-red group-hover:opacity-100"
                  >
                    <CloseIcon width={13} height={13} />
                  </button>
                </Tooltip>
              </div>
            ))}
          </div>
        )}

        {/* Recent queries from history */}
        <div className="mt-2 flex items-center justify-between px-2 pb-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-dim">Recent</span>
          {recents.length > 0 && (
            <button className="text-[11px] text-ink-faint hover:text-ink" onClick={onClear}>
              Clear
            </button>
          )}
        </div>

        {recents.length === 0 ? (
          <div className="px-2 py-1 text-[11px] text-ink-faint">Run a query and it'll show up here.</div>
        ) : (
          <div className="flex flex-col gap-1">
            {sortedRecents.map((q, i) => (
              <Tooltip key={i} label={q.sql} placement="right" multiline wrapperClassName="w-full">
                <button
                  onClick={() => onOpen(q.sql)}
                  className="flex w-full items-start gap-2.5 rounded-[8px] px-2.5 py-2 text-left text-ink-dim hover:bg-elevated hover:text-ink"
                >
                  <CodeIcon className="mt-0.5 shrink-0 text-ink-faint" width={14} height={14} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-[11px] text-ink">{q.sql}</div>
                    <div className="mt-0.5 text-[10px] text-ink-faint">
                      {relativeTime(q.ts)}
                      {q.rows != null && ` · ${q.rows.toLocaleString()} rows`}
                    </div>
                  </div>
                </button>
              </Tooltip>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
