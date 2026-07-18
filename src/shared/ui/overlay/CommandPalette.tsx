import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { SearchIcon } from '@/shared/ui/icons'

export interface Command {
  id: string
  label: string
  /** Section header this command sits under (e.g. "Create", "Navigate"). */
  group?: string
  /** Extra text to match against beyond the label (synonyms, e.g. "erd diagram"). */
  keywords?: string
  /** Small right-aligned hint, typically a formatted shortcut like ⌘N. */
  hint?: string
  icon?: ReactNode
  run: () => void
}

// A generic command palette / search overlay: fuzzy-ish substring match over a
// flat command list, grouped by `group`, with full keyboard navigation
// (↑/↓ to move, Enter to run, Esc to close). Feature-agnostic — callers pass
// whatever commands make sense for their screen.
export default function CommandPalette({
  open,
  onClose,
  commands,
  placeholder = 'Search or run a command…',
}: {
  open: boolean
  onClose: () => void
  commands: Command[]
  placeholder?: string
}) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Reset each time the palette opens.
  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands
    return commands.filter((c) =>
      `${c.label} ${c.group ?? ''} ${c.keywords ?? ''}`.toLowerCase().includes(q)
    )
  }, [commands, query])

  // Clamp the active index whenever the result set shrinks.
  useEffect(() => {
    setActive((i) => Math.min(i, Math.max(0, results.length - 1)))
  }, [results.length])

  // Keep the highlighted row scrolled into view.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) return null

  const runAt = (i: number) => {
    const cmd = results[i]
    if (!cmd) return
    onClose()
    cmd.run()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (results.length ? (i + 1) % results.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (results.length ? (i - 1 + results.length) % results.length : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      runAt(active)
    }
  }

  // Group headers are emitted inline as the group value changes down the list.
  let lastGroup: string | undefined

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade items-start justify-center bg-black/50 p-6 pt-[12vh] backdrop-blur-[3px]"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-[560px] animate-pop overflow-hidden rounded-[14px] border border-edge-strong bg-panel shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-edge px-4">
          <SearchIcon width={16} height={16} className="shrink-0 text-ink-faint" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            className="w-full bg-transparent py-3.5 text-[13px] text-ink outline-none placeholder:text-ink-faint"
          />
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-1.5">
          {results.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-ink-faint">No matching commands</div>
          ) : (
            results.map((cmd, i) => {
              const showHeader = cmd.group && cmd.group !== lastGroup
              lastGroup = cmd.group
              const isActive = i === active
              return (
                <div key={cmd.id}>
                  {showHeader && (
                    <div className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                      {cmd.group}
                    </div>
                  )}
                  <button
                    type="button"
                    data-active={isActive}
                    onMouseMove={() => setActive(i)}
                    onClick={() => runAt(i)}
                    className={`flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left text-[13px] transition-colors ${
                      isActive ? 'bg-elevated text-ink' : 'text-ink-dim hover:bg-elevated/60'
                    }`}
                  >
                    {cmd.icon && <span className="flex w-4 shrink-0 justify-center text-ink-faint">{cmd.icon}</span>}
                    <span className="min-w-0 flex-1 truncate">{cmd.label}</span>
                    {cmd.hint && (
                      <kbd className="shrink-0 rounded-[5px] border border-edge bg-card px-1.5 py-px text-[11px] text-ink-faint">
                        {cmd.hint}
                      </kbd>
                    )}
                  </button>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
