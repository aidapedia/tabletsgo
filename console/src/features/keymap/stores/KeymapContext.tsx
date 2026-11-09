import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { ACTIONS } from '../lib/actions'
import { eventToCombo } from '../lib/combo'

const KeymapContext = createContext(null)
const KEY = 'tabletsgo:keymap'

const DEFAULTS = Object.fromEntries(ACTIONS.map((a) => [a.id, a.defaultBinding]))
const VALID_IDS = new Set(ACTIONS.map((a) => a.id))

// Only user overrides are persisted (action id -> combo, '' meaning unbound);
// unknown/stale ids from an older ACTIONS list are dropped on load.
function loadOverrides() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}')
    const overrides = {}
    for (const [id, combo] of Object.entries(raw)) {
      if (VALID_IDS.has(id) && typeof combo === 'string') overrides[id] = combo
    }
    return overrides
  } catch {
    return {}
  }
}

type ShortcutEntry = { fn: () => void; enabled: boolean }

export function KeymapProvider({ children }) {
  const [overrides, setOverrides] = useState(loadOverrides)
  const [isRecording, setIsRecording] = useState(false)
  const registryRef = useRef(new Map<string, ShortcutEntry[]>())

  const bindings = useMemo(() => ({ ...DEFAULTS, ...overrides }), [overrides])

  const persist = (next) => {
    setOverrides(next)
    localStorage.setItem(KEY, JSON.stringify(next))
  }

  const findConflictId = (id, combo) => {
    if (!combo) return null
    const hit = ACTIONS.find((a) => a.id !== id && bindings[a.id] === combo)
    return hit ? hit.id : null
  }

  const setBinding = (id, combo) => persist({ ...overrides, [id]: combo })

  // Assigns `combo` to `id`, unbinding whichever other action currently holds it.
  const reassignBinding = (id, combo) => {
    const conflictId = findConflictId(id, combo)
    const next = { ...overrides, [id]: combo }
    if (conflictId) next[conflictId] = ''
    persist(next)
  }

  const resetBinding = (id) => {
    const next = { ...overrides }
    delete next[id]
    persist(next)
  }

  const resetAll = () => persist({})

  const subscribe = (actionId: string, entry: ShortcutEntry) => {
    const list = registryRef.current.get(actionId) || []
    registryRef.current.set(actionId, [...list, entry])
    return () => {
      const cur = registryRef.current.get(actionId) || []
      registryRef.current.set(actionId, cur.filter((e) => e !== entry))
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isRecording) return
      const combo = eventToCombo(e)
      if (!combo) return
      const actionId = ACTIONS.find((a) => bindings[a.id] === combo)?.id
      if (!actionId) return
      const list = registryRef.current.get(actionId)
      if (!list?.length) return
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].enabled) {
          e.preventDefault()
          list[i].fn()
          return
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [bindings, isRecording])

  const value = {
    actions: ACTIONS,
    bindings,
    setBinding,
    reassignBinding,
    resetBinding,
    resetAll,
    findConflictId,
    isRecording,
    setIsRecording,
    subscribe,
  }

  return <KeymapContext.Provider value={value}>{children}</KeymapContext.Provider>
}

export const useKeymap = () => useContext(KeymapContext)

// Registers `handler` to fire whenever `actionId`'s current binding is pressed.
// Multiple mounted components may register the same actionId (e.g. "Save" used
// by several panels) — only the most-recently-registered one with enabled=true
// fires, so callers gate `enabled` on whether they're the active context.
export function useShortcut(actionId: string, handler: () => void, enabled = true) {
  const ctx = useContext(KeymapContext)
  const entryRef = useRef<ShortcutEntry>({ fn: handler, enabled })
  entryRef.current.fn = handler
  entryRef.current.enabled = enabled

  useEffect(() => {
    if (!ctx) return
    return ctx.subscribe(actionId, entryRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, actionId])
}
