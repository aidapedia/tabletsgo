import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import SearchInput from '@/shared/ui/form/SearchInput'
import Tooltip from '@/shared/ui/overlay/Tooltip'
import CommandDocView from '@/shared/ui/CommandDocView'
import type { CommandDoc } from '@/shared/ui/CommandDocView'
import { ChevronLeft, ChevronRight } from '@/shared/ui/icons'

type Command = {
  name: string
  args: string
  desc?: string
  /** Short trailing label, e.g. the version it arrived in. */
  tag?: string
  /** Why the connected server can't run it — dims the row and explains on hover. */
  unavailable?: string
}
type Group = { label?: string; commands: Command[] }

/**
 * A command console's side panel: the catalog as a clickable list. Clicking a
 * row hands `NAME ` to `onInsert`; its trailing chevron swaps the list for that
 * command's docs (from `docFor`, with `loadDoc`'s live additions merged over
 * them once they arrive), whose examples can be copied or run (`onRun`).
 * `filterable` adds a name filter for long catalogs.
 */
export default function CommandReference({
  groups,
  filterable = false,
  footer,
  onInsert,
  onRun,
  docFor,
  loadDoc,
}: {
  groups: Group[]
  filterable?: boolean
  footer?: ReactNode
  onInsert: (text: string) => void
  onRun?: (text: string) => void
  docFor?: (name: string) => CommandDoc | null
  loadDoc?: (name: string) => Promise<Partial<CommandDoc> | null>
}) {
  const [filter, setFilter] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  // Live additions per command: undefined = not asked yet, 'loading', or the answer (null = none).
  const [live, setLive] = useState<Record<string, Partial<CommandDoc> | null | 'loading'>>({})

  useEffect(() => {
    if (!open || !loadDoc || live[open] !== undefined) return
    const name = open
    setLive((l) => ({ ...l, [name]: 'loading' }))
    loadDoc(name)
      .catch(() => null)
      .then((extra) => setLive((l) => ({ ...l, [name]: extra })))
  }, [open, loadDoc, live])

  const extra = open ? live[open] : undefined
  const base = open && docFor ? docFor(open) : null
  const doc = base && extra && extra !== 'loading' ? { ...base, ...extra } : base
  const needle = filter.trim().toUpperCase()
  const shown = groups
    .map((g) => ({ ...g, commands: g.commands.filter((c) => !needle || c.name.includes(needle)) }))
    .filter((g) => g.commands.length)

  return (
    <aside
      aria-label="Command reference"
      className="flex w-[340px] shrink-0 flex-col border-l border-edge bg-panel max-[1100px]:hidden"
    >
      {open ? (
        <div className="flex items-center gap-1.5 border-b border-edge px-2 py-2">
          <Tooltip label="Back to commands" placement="bottom">
            <button
              type="button"
              onClick={() => setOpen(null)}
              aria-label="Back to commands"
              className="flex h-6 w-6 items-center justify-center rounded text-ink-dim hover:bg-elevated hover:text-ink"
            >
              <ChevronLeft width={14} height={14} />
            </button>
          </Tooltip>
          <p className="min-w-0 flex-1 truncate font-mono text-xs font-semibold">{open}</p>
          <button
            type="button"
            onClick={() => onInsert(`${open} `)}
            className="rounded px-2 py-1 text-[11px] text-ink-dim hover:bg-elevated hover:text-ink"
          >
            Insert
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between border-b border-edge px-4 py-2.5">
            <p className="text-xs font-semibold">Commands</p>
            <span className="text-[10px] text-ink-faint">one per line · # comments</span>
          </div>
          {filterable && (
            <div className="border-b border-edge px-3 py-2">
              <SearchInput
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter commands…"
                iconSize={13}
                inputClassName="!py-1.5 !text-[11px]"
              />
            </div>
          )}
        </>
      )}

      {open && docFor && (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {extra === 'loading' && <p className="pt-3 text-[10px] text-ink-faint">Reading the server’s reference…</p>}
          <CommandDocView doc={doc} onRun={onRun} />
        </div>
      )}

      {/* Hidden rather than unmounted while a doc is open, so Back lands where the list was scrolled to. */}
      <div className={`min-h-0 flex-1 overflow-y-auto px-4 pb-4 ${open ? 'hidden' : ''}`}>
        {shown.map((g, i) => (
          <div key={g.label ?? i}>
            {g.label && <p className="pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{g.label}</p>}
            {g.commands.map((c) => (
              <div
                key={c.name}
                className={`group/row flex items-center border-b border-edge/60 hover:bg-elevated/50 ${c.unavailable ? 'opacity-55' : ''}`}
              >
                <button type="button" onClick={() => onInsert(`${c.name} `)} className="min-w-0 flex-1 py-1.5 text-left">
                  <span className="block font-mono text-[11px]">
                    <span className="text-[#c49bff]">{c.name}</span> <span className="text-ink-dim">{c.args}</span>
                  </span>
                  {c.desc && <span className="mt-0.5 block text-[11px] text-ink-faint">{c.desc}</span>}
                </button>
                {c.tag && (
                  <Tooltip label={c.unavailable || `Available since ${c.tag}`} placement="left">
                    <span className={`ml-1 shrink-0 font-mono text-[10px] ${c.unavailable ? 'text-amber' : 'text-ink-faint'}`}>{c.tag}</span>
                  </Tooltip>
                )}
                {docFor && (
                  <Tooltip label="Show details" placement="left">
                    <button
                      type="button"
                      onClick={() => setOpen(c.name)}
                      aria-label={`Show ${c.name} details`}
                      className="ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-faint hover:bg-elevated hover:text-ink group-hover/row:text-ink-dim"
                    >
                      <ChevronRight width={13} height={13} />
                    </button>
                  </Tooltip>
                )}
              </div>
            ))}
          </div>
        ))}
        {!shown.length && <p className="py-6 text-center text-[11px] text-ink-faint">No command matches.</p>}
        {footer && (
          <div className="mt-3 rounded-soft border border-edge bg-elevated px-3 py-2.5 text-[11px] leading-relaxed text-ink-dim">{footer}</div>
        )}
      </div>
    </aside>
  )
}
