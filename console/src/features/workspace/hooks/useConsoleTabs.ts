import { useRef, useState } from 'react'

export type ConsoleTab = {
  key: string
  kind: string
  title: string
  /** 0 = first editor pane, 1 = the split one. Assigned when the tab opens. */
  pane?: number
  [extra: string]: any
}

export type SplitDir = 'vertical' | 'horizontal' | null

/**
 * The console's tab + split-pane engine.
 *
 * Tabs live in one flat list; each carries the editor pane it is shown in, so
 * splitting is only ever "move this tab to the other pane" and the split folds
 * away as soon as pane 1 runs empty. `activeByPane` is each pane's focused tab,
 * `focusedPane` the one new tabs open in and shortcuts act on.
 *
 * Per-tab editor state (SQL + result) is held here too, keyed by tab key, so it
 * survives tab switches and is dropped with the tab.
 *
 * `onOpen` fires whenever a tab is opened or focused — the console uses it to
 * close the mobile sidebar drawer.
 */
export default function useConsoleTabs({ onOpen }: { onOpen?: () => void } = {}) {
  const [tabs, setTabs] = useState<ConsoleTab[]>([])
  const [activeByPane, setActiveByPane] = useState<(string | null)[]>([null, null])
  const [focusedPane, setFocusedPane] = useState(0)
  const [splitDir, setSplitDir] = useState<SplitDir>(null)
  const [splitRatio, setSplitRatio] = useState(0.5) // pane 0's share of the editor area
  const [queryState, setQueryState] = useState<Record<string, any>>({}) // key -> { sql, result, error, elapsedMs }
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; key: string } | null>(null)
  const paneWrapRef = useRef<HTMLDivElement>(null) // the editor area, measured while dragging the divider

  // Set one pane's focused tab, leaving the other pane's alone.
  const setPaneActive = (pane: number, key: string | null) =>
    setActiveByPane((prev) => (prev[pane] === key ? prev : prev.map((k, i) => (i === pane ? key : k))))

  // Every "open X" funnels through here. A tab that's already open is focused
  // where it lives — in either pane — and optionally patched (`patch`); a new
  // one opens in the focused pane.
  const openTab = (tab: ConsoleTab, patch?: Partial<ConsoleTab>) => {
    const pane = tabs.find((t) => t.key === tab.key)?.pane ?? focusedPane
    setTabs((prev) =>
      prev.some((t) => t.key === tab.key)
        ? patch
          ? prev.map((t) => (t.key === tab.key ? { ...t, ...patch } : t))
          : prev
        : [...prev, { ...tab, pane }]
    )
    setFocusedPane(pane)
    setPaneActive(pane, tab.key)
    onOpen?.()
  }

  // Table filters live on the tab, not inside TableView — only the active tab is
  // mounted, so tab-local state would be lost on every tab switch.
  const setTabFilters = (key: string, filters: any) =>
    setTabs((prev) => prev.map((t) => (t.key === key ? { ...t, filters } : t)))

  // Keep an open tab's title in sync with the resource it was opened from.
  const retitleTab = (key: string, title: string) =>
    setTabs((prev) => prev.map((t) => (t.key === key ? { ...t, title } : t)))

  const hasTabOfKind = (kind: string) => tabs.some((t) => t.kind === kind)

  // Persist a query tab's editor state (SQL + result) so it survives tab
  // switches; held until the tab is closed.
  const persistQueryState = (key: string, snapshot: any) =>
    setQueryState((p) => ({ ...p, [key]: snapshot }))

  // Re-point each pane's active tab at something that still exists in it (an
  // explicit `want` wins), and fold the split away once its pane runs empty.
  const settlePanes = (list: ConsoleTab[], want: Record<number, string> = {}) => {
    setActiveByPane((cur) =>
      cur.map((k, p) => {
        const own = list.filter((t) => t.pane === p)
        const target = want[p] ?? k
        if (target && own.some((t) => t.key === target)) return target
        return own.length ? own[own.length - 1].key : null
      })
    )
    if (!list.some((t) => t.pane === 1)) {
      setSplitDir(null)
      setFocusedPane(0)
    }
  }

  // Actually drop a tab (and its query state).
  const dropTab = (key: string) => {
    if (queryState[key]) setQueryState((p) => { const n = { ...p }; delete n[key]; return n })
    const next = tabs.filter((t) => t.key !== key)
    setTabs(next)
    settlePanes(next)
  }

  const removeTab = (key: string) => dropTab(key)

  const closeTab = (e: any, key: string) => {
    e.stopPropagation()
    removeTab(key)
  }

  // The "close …" menu entries act inside the tab's own pane; the other pane's
  // tabs are a separate group and are never touched.
  const paneOf = (key: string) => tabs.find((t) => t.key === key)?.pane ?? 0

  const closeTabsToRight = (key: string) => {
    const p = paneOf(key)
    const idx = tabs.filter((t) => t.pane === p).findIndex((t) => t.key === key)
    if (idx === -1) return
    const doomed = new Set(tabs.filter((t) => t.pane === p).slice(idx + 1).map((t) => t.key))
    const next = tabs.filter((t) => !doomed.has(t.key))
    setTabs(next)
    settlePanes(next, { [p]: key })
  }

  const closeOtherTabs = (key: string) => {
    const p = paneOf(key)
    const next = tabs.filter((t) => t.pane !== p || t.key === key)
    setTabs(next)
    settlePanes(next, { [p]: key })
  }

  const closeAllTabs = (pane = focusedPane) => {
    const next = tabs.filter((t) => t.pane !== pane)
    setTabs(next)
    settlePanes(next)
  }

  // ---- Split view ----
  // A tab belongs to exactly one pane; moving it there is what creates the
  // split, and the split folds away as soon as the second pane runs empty.
  const moveTabToPane = (key: string, pane: number, dir: SplitDir = splitDir || 'vertical') => {
    const next = tabs.map((t) => (t.key === key ? { ...t, pane } : t))
    setTabs(next)
    if (pane === 1) setSplitDir(dir)
    settlePanes(next, { [pane]: key })
    setFocusedPane(pane)
  }

  // Fold the split away without losing work: the second pane's tabs join the first.
  const unsplit = () => {
    const keep = activeByPane[focusedPane] ?? activeByPane[0] ?? activeByPane[1]
    const next = tabs.map((t) => (t.pane === 1 ? { ...t, pane: 0 } : t))
    setTabs(next)
    setSplitDir(null)
    setFocusedPane(0)
    settlePanes(next, { 0: keep })
  }

  // Tab-bar / shortcut toggle: split the focused tab off into the second pane,
  // or (when already split) merge everything back into the first one.
  const toggleSplit = (dir: SplitDir = 'vertical') => {
    if (splitDir) {
      if (splitDir !== dir) {
        setSplitDir(dir)
        return
      }
      unsplit()
      return
    }
    const key = activeByPane[0]
    if (key) moveTabToPane(key, 1, dir)
  }

  // Dropping a tab onto the other pane's strip: move it there, positioned
  // before `anchorKey` (or at the end when the drop landed past the last tab).
  const adoptTab = (pane: number, key: string, anchorKey?: string | null) => {
    const tab = tabs.find((t) => t.key === key)
    if (!tab || tab.pane === pane) return
    const rest = tabs.filter((t) => t.key !== key)
    const at = anchorKey ? rest.findIndex((t) => t.key === anchorKey) : -1
    const next = [...rest]
    next.splice(at === -1 ? next.length : at, 0, { ...tab, pane })
    setTabs(next)
    settlePanes(next, { [pane]: key })
    setFocusedPane(pane)
  }

  // Drag-reorder within one pane's strip: move `fromKey` next to `toKey` (before
  // or after it); `toKey === null` moves it to the end. Both keys belong to the
  // same pane, so reordering the flat list keeps every pane's own order intact.
  const moveTab = (fromKey: string, toKey: string | null, before: boolean) => {
    setTabs((prev) => {
      const from = prev.findIndex((t) => t.key === fromKey)
      if (from === -1) return prev
      const next = prev.filter((t) => t.key !== fromKey)
      const at = toKey == null ? next.length : next.findIndex((t) => t.key === toKey)
      next.splice(at === -1 ? next.length : at + (before ? 0 : 1), 0, prev[from])
      return next
    })
  }

  const openTabMenu = (e: any, key: string) => {
    e.preventDefault()
    e.stopPropagation()
    setTabMenu({ x: e.clientX, y: e.clientY, key })
  }

  // Drag the divider to re-balance the two panes (20–80%). The ratio is a flex
  // grow factor, so the same handler works split left/right or top/bottom.
  const startResize = (e: any) => {
    e.preventDefault()
    const box = paneWrapRef.current?.getBoundingClientRect()
    if (!box) return
    const vertical = splitDir !== 'horizontal'
    const move = (ev: MouseEvent) => {
      const r = vertical ? (ev.clientX - box.left) / box.width : (ev.clientY - box.top) / box.height
      setSplitRatio(Math.min(0.8, Math.max(0.2, r)))
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = vertical ? 'col-resize' : 'row-resize'
  }

  // Switching connections is destructive: tabs and per-tab editor state are all
  // scoped to the connection they were opened on.
  const resetTabs = () => {
    setTabs([])
    setActiveByPane([null, null])
    setFocusedPane(0)
    setSplitDir(null)
    setQueryState({})
  }

  // The tab on screen in each pane. `current` is the focused pane's — what
  // tab-scoped actions (save, stage, the sidebar's active row) apply to;
  // `onScreen` is both, since a split shows two tabs at once.
  const tabInPane = (p: number) => tabs.find((t) => t.key === activeByPane[p])
  const current = tabInPane(focusedPane)
  const onScreen = [tabInPane(0), tabInPane(1)].filter(Boolean) as ConsoleTab[]

  return {
    tabs,
    activeByPane,
    focusedPane,
    setFocusedPane,
    splitDir,
    splitRatio,
    queryState,
    tabMenu,
    setTabMenu,
    paneWrapRef,
    current,
    onScreen,
    tabInPane,
    setPaneActive,
    openTab,
    setTabFilters,
    retitleTab,
    hasTabOfKind,
    persistQueryState,
    dropTab,
    removeTab,
    closeTab,
    paneOf,
    closeTabsToRight,
    closeOtherTabs,
    closeAllTabs,
    moveTabToPane,
    toggleSplit,
    unsplit,
    adoptTab,
    moveTab,
    openTabMenu,
    startResize,
    resetTabs,
  }
}
