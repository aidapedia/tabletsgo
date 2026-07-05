// Canonical shortcut representation: tokens joined by '+', e.g. "mod+shift+enter".
// "mod" collapses Cmd (Mac) / Ctrl (other platforms) into one cross-platform token.
export const isMac = () =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)

const KEY_NAMES: Record<string, string> = {
  ' ': 'space',
  Enter: 'enter',
  Backspace: 'backspace',
  Delete: 'delete',
  Escape: 'escape',
  Tab: 'tab',
}

const normalizeKey = (key: string) => KEY_NAMES[key] ?? key.toLowerCase()

// Builds a combo string from a keydown event, or null if the event doesn't
// represent a complete, bindable shortcut yet (e.g. a bare modifier key, or
// no mod key held — every binding in this app requires mod so shortcuts never
// collide with normal typing).
export function eventToCombo(e: KeyboardEvent): string | null {
  const mod = e.metaKey || e.ctrlKey
  if (!mod) return null
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return null
  const parts = ['mod']
  if (e.shiftKey) parts.push('shift')
  if (e.altKey) parts.push('alt')
  parts.push(normalizeKey(e.key))
  return parts.join('+')
}

const SYMBOLS_MAC: Record<string, string> = {
  mod: '⌘',
  shift: '⇧',
  alt: '⌥',
  enter: '↵',
  backspace: '⌫',
  delete: '⌦',
  escape: 'Esc',
  tab: '⇥',
  space: 'Space',
}

const LABELS: Record<string, string> = {
  shift: 'Shift',
  enter: 'Enter',
  backspace: 'Backspace',
  delete: 'Delete',
  escape: 'Esc',
  tab: 'Tab',
  space: 'Space',
}

// Renders a combo string for display, Mac-style (⌘⇧↵) or Ctrl+Shift+Enter elsewhere.
export function formatCombo(combo: string): string {
  if (!combo) return 'Unassigned'
  const mac = isMac()
  const parts = combo.split('+')
  if (mac) return parts.map((p) => SYMBOLS_MAC[p] ?? p.toUpperCase()).join('')
  return parts.map((p) => (p === 'mod' ? 'Ctrl' : LABELS[p] ?? p.toUpperCase())).join('+')
}
