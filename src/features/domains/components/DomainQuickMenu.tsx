import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Button from '@/shared/ui/buttons/Button'
import MenuItem from '@/shared/ui/navigation/MenuItem'
import EmptyState from '@/shared/ui/feedback/EmptyState'
import { MENU_PANEL_CLASS } from '@/shared/ui/overlay/Popover'
import { useToast } from '@/shared/ui/feedback/Toast'
import { CheckIcon, ChevronRight, SettingsIcon, TagIcon } from '@/shared/ui/icons'
import { setTableDomain } from '../lib/api'
import { withTableAssignment } from '../lib/assign'
import type { Domain } from '../types'
import DomainDot from './DomainDot'

const WIDTH = 200
const GAP = 4
const MARGIN = 8

/**
 * The "Set domain" row inside a table's context menu. Hovering it opens a flyout
 * of the connection's domains for one-click assignment (the fast path), so most
 * reassignments never need the full slide-over. Mirrors ContextMenuSub: the
 * flyout is a `fixed`, JS-positioned panel (opened on hover with a small close
 * delay so a cursor that cuts a corner is forgiven) — not a CSS opacity fade,
 * which flickers see-through while scrolling a long list. It flips to whichever
 * side has room and caps its height so many domains scroll in place. When none
 * exist yet, it points the user at the "Configure domains…" panel instead.
 *
 * Self-contained like the picker panel: it performs the assign call itself and
 * hands the parent the recomputed list via `onChange`. `onConfigure` opens the
 * full slide-over; `onAssigned` closes the surrounding context menu.
 */
export default function DomainQuickMenu({
  connectionId,
  table,
  domains,
  onChange,
  onConfigure,
  onAssigned,
}: {
  connectionId: string
  table: string
  domains: Domain[]
  onChange: (next: Domain[]) => void
  onConfigure: () => void
  onAssigned: () => void
}) {
  const toast = useToast()
  const rowRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ left: 0, top: 0, maxHeight: 0 })

  useEffect(() => () => clearTimeout(closeTimer.current), [])

  // Position the fixed flyout on open: prefer the right of the row, flip left
  // when it can't fit; clamp the top and cap the height to the viewport so a
  // long list scrolls within the panel instead of running off-screen.
  useLayoutEffect(() => {
    if (!open) return
    const r = rowRef.current?.getBoundingClientRect()
    if (!r) return
    const roomRight = window.innerWidth - r.right
    const left = roomRight >= WIDTH + GAP || roomRight >= r.left ? r.right + GAP : r.left - WIDTH - GAP
    const maxHeight = window.innerHeight - MARGIN * 2
    const panelH = Math.min(panelRef.current?.offsetHeight ?? 0, maxHeight)
    const top = Math.max(MARGIN, Math.min(r.top, window.innerHeight - MARGIN - panelH))
    setPos({ left, top, maxHeight })
  }, [open, domains.length])

  const cancelClose = () => clearTimeout(closeTimer.current)
  const scheduleClose = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 150)
  }

  const currentId = domains.find((d) => d.tables.includes(table))?.id ?? null
  const current = domains.find((d) => d.id === currentId) ?? null

  const assign = async (domainId: string | null) => {
    onAssigned()
    if (domainId === currentId) return
    const prev = domains
    onChange(withTableAssignment(domains, table, domainId))
    try {
      await setTableDomain(connectionId, table, domainId)
    } catch (e: any) {
      toast.error(`Couldn't set domain: ${e.message}`)
      onChange(prev)
    }
  }

  const item = 'flex w-full items-center gap-2.5 rounded px-2.5 py-1.5 text-left text-[12px] transition-colors'

  return (
    <div ref={rowRef} onMouseEnter={() => (cancelClose(), setOpen(true))} onMouseLeave={scheduleClose}>
      <MenuItem className="justify-between" onClick={onConfigure}>
        <span className="flex items-center gap-2.5">
          <TagIcon width={14} height={14} /> Set domain
        </span>
        <span className="flex items-center gap-2">
          {current && <DomainDot color={current.color} size={7} />}
          <ChevronRight width={13} height={13} className="text-ink-faint" />
        </span>
      </MenuItem>

      {open && (
        <div
          ref={panelRef}
          className={`fixed z-[110] flex flex-col overflow-y-auto p-1 shadow-2xl ${MENU_PANEL_CLASS}`}
          style={{ left: pos.left, top: pos.top, width: WIDTH, maxHeight: pos.maxHeight || undefined }}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          {domains.length === 0 ? (
            <div className="px-1.5 py-2">
              <EmptyState className="mb-2 py-1">No domains yet.</EmptyState>
              <Button variant="subtle" size="sm" icon={SettingsIcon} onClick={onConfigure} className="w-full">
                Configure domains…
              </Button>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => assign(null)}
                className={`${item} ${currentId === null ? 'bg-card-hover text-ink' : 'text-ink-dim hover:bg-card-hover hover:text-ink'}`}
              >
                <DomainDot color={null} />
                <span className="flex-1 truncate">No domain</span>
                {currentId === null && <CheckIcon width={13} height={13} className="text-green" />}
              </button>

              {domains.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => assign(d.id)}
                  className={`${item} ${d.id === currentId ? 'bg-card-hover text-ink' : 'text-ink-dim hover:bg-card-hover hover:text-ink'}`}
                >
                  <DomainDot color={d.color} />
                  <span className="flex-1 truncate">{d.name}</span>
                  <span className="text-[10px] text-ink-faint">{d.tables.length}</span>
                  {d.id === currentId && <CheckIcon width={13} height={13} className="text-green" />}
                </button>
              ))}

              <div className="my-1 h-px shrink-0 bg-edge" />
              <MenuItem onClick={onConfigure}>
                <SettingsIcon width={14} height={14} /> Manage domains…
              </MenuItem>
            </>
          )}
        </div>
      )}
    </div>
  )
}
