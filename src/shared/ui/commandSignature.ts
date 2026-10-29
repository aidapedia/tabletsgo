import { Decoration, EditorView, WidgetType } from '@codemirror/view'
import type { DecorationSet } from '@codemirror/view'
import { StateEffect, StateField } from '@codemirror/state'
import type { EditorState, Extension } from '@codemirror/state'

/**
 * Inline syntax hints for the line-oriented command consoles (Redis, Kafka),
 * like VSCode's ghost-text suggestions. While the cursor is at the end of a
 * command's arguments, the rest of its argument template is drawn faded after
 * the cursor — `SET k ` shows `value [EX seconds|PX ms] [NX|XX] …` — so the
 * user sees what goes next without looking it up.
 *
 * Engine-agnostic: each console passes a lookup over its own catalog.
 */
export type CommandSignature = { name: string; args: string }
type Lookup = (name: string) => CommandSignature | null | undefined

const isKeyword = (w: string) => /^[A-Z][A-Z0-9_-]*$/.test(w)
const isEllipsis = (s: string) => /\.\.\.|…/.test(s)
const words = (s: string) => s.split(/[\s|[\]{}]+/).filter(Boolean)
const hasKeyword = (part: string, kw: string) => words(part).some((w) => isKeyword(w) && w === kw)
// `[MATCH pattern]` — an optional clause that only starts with its keyword, so a
// bare value never lands in it positionally.
const keywordHeaded = (part: string) => part.startsWith('[') && isKeyword(words(part)[0] || '')

/** The option/clause keywords of an argument template: `key [EX s|PX ms] [NX]` → EX, PX, NX. */
export const templateKeywords = (args: string) => [...new Set(words(args).filter(isKeyword))]

/** Split a template at top-level spaces: `key [EX s|PX ms] [NX]` → key, [EX s|PX ms], [NX]. */
function templateParts(args: string) {
  const parts: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of args) {
    if (ch === '[' || ch === '{') depth++
    else if ((ch === ']' || ch === '}') && depth) depth--
    if (ch === ' ' && !depth) {
      if (cur) parts.push(cur)
      cur = ''
    } else cur += ch
  }
  if (cur) parts.push(cur)
  return parts
}

// Split the line up to the cursor into arguments — whitespace-separated, with
// quoted strings and {…} JSON kept whole. `typing` is the token under the cursor.
function splitArgs(text: string) {
  const done: string[] = []
  let cur = ''
  let quote = ''
  let escaped = false
  let depth = 0
  for (const ch of text) {
    if (quote) {
      cur += ch
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === '{' || ch === '[') depth++
    else if ((ch === '}' || ch === ']') && depth) depth--
    if (/\s/.test(ch) && !depth && !quote) {
      if (cur) done.push(cur)
      cur = ''
    } else cur += ch
  }
  return { done, typing: cur }
}

// How many values still follow `kw` inside its alternative: `EX seconds` → 1.
function argsAfter(part: string, kw: string) {
  const alt = part.replace(/^\[|\]$/g, '').split('|').find((a) => hasKeyword(a, kw)) || ''
  const ws = alt.trim().split(/\s+/)
  const at = ws.findIndex((w) => words(w).includes(kw))
  return ws.slice(at + 1).filter((w) => {
    const bare = w.replace(/[[\]]/g, '')
    return !w.startsWith('[') && bare && !/^(\.\.\.|…)$/.test(bare) && !isKeyword(bare)
  }).length
}

/**
 * Which template part the token under the cursor fills — best effort, since a
 * template is a hint, not a grammar. Walks the typed arguments: a keyword jumps
 * to its clause, a value fills the clause's slots or the next positional part,
 * and a repeating part (`[key ...]`) absorbs the rest. -1 means past the end.
 */
export function activePart(parts: string[], args: string[], typing: string) {
  const kwPart = (arg: string) => parts.findIndex((p) => hasKeyword(p, arg.toUpperCase()))
  let cur = -1
  let left = 0
  for (const arg of args) {
    const next = cur + 1
    if (left > 0) {
      left--
      continue
    }
    // A required plain slot (`key`, `value`) takes the value even if it looks like a keyword.
    if (parts[next] && !parts[next].startsWith('[') && !words(parts[next]).some(isKeyword)) {
      cur = next
      continue
    }
    const q = kwPart(arg)
    if (q >= 0) {
      cur = q
      left = argsAfter(parts[q], arg.toUpperCase())
      continue
    }
    if (cur >= 0 && isEllipsis(parts[cur] || '')) continue
    let n = next
    while (parts[n] && keywordHeaded(parts[n])) n++
    cur = parts[n] ? n : parts.length
  }
  if (left > 0) return cur
  const typed = typing ? kwPart(typing) : -1
  if (typed >= 0) return typed
  if (cur + 1 < parts.length) return cur + 1
  return cur >= 0 && cur < parts.length && isEllipsis(parts[cur]) ? cur : -1
}

// The rest of the template from the part being typed, drawn after the cursor.
class GhostWidget extends WidgetType {
  constructor(readonly parts: string[], readonly active: number) {
    super()
  }
  eq(other: GhostWidget) {
    return other.active === this.active && other.parts.join(' ') === this.parts.join(' ')
  }
  toDOM() {
    const dom = document.createElement('span')
    dom.className = 'cm-signature-ghost'
    dom.setAttribute('aria-hidden', 'true')
    this.parts.forEach((p, i) => {
      const el = dom.appendChild(document.createElement('span'))
      if (i === this.active) el.className = 'cm-signature-ghost-active'
      el.textContent = p
      if (i < this.parts.length - 1) dom.append(' ')
    })
    return dom
  }
  ignoreEvent() {
    return true
  }
}

function ghostFor(state: EditorState, lookup: Lookup): DecorationSet {
  const sel = state.selection.main
  const line = state.doc.lineAt(sel.head)
  // Only at the end of a line — ghost text between real tokens reads as a mess.
  if (!sel.empty || line.text.slice(sel.head - line.from).trim()) return Decoration.none
  const { done, typing } = splitArgs(line.text.slice(0, sel.head - line.from))
  // Still on the command name — that's the completion popup's job.
  if (!done.length) return Decoration.none
  const spec = lookup(done[0])
  if (!spec || !spec.args) return Decoration.none

  const parts = templateParts(spec.args)
  const active = activePart(parts, done.slice(1), typing)
  if (active < 0) return Decoration.none
  // Mid-token, the part being typed is already on screen — hint what follows it.
  const shown = typing ? parts.slice(active + 1) : parts.slice(active)
  if (!shown.length) return Decoration.none
  const lead = typing || !/\s$/.test(line.text) ? [''] : []
  const widget = new GhostWidget([...lead, ...shown], typing ? -1 : lead.length)
  return Decoration.set([Decoration.widget({ widget, side: 1 }).range(sel.head)])
}

const setFocused = StateEffect.define<boolean>()

const theme = EditorView.baseTheme({
  '.cm-signature-ghost': { color: 'var(--color-ink-faint)', opacity: '0.7', pointerEvents: 'none' },
  '.cm-signature-ghost-active': { color: 'var(--color-ink-dim)' },
})

/** The inline syntax hint; shown only while the editor has focus. */
export function commandSignature(lookup: Lookup): Extension {
  const focused = StateField.define<boolean>({
    create: () => false,
    update: (v, tr) => tr.effects.reduce((acc, e) => (e.is(setFocused) ? e.value : acc), v),
  })
  const ghost = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(value, tr) {
      if (!tr.docChanged && !tr.selection && !tr.effects.some((e) => e.is(setFocused))) return value
      return tr.state.field(focused) ? ghostFor(tr.state, lookup) : Decoration.none
    },
    provide: (f) => EditorView.decorations.from(f),
  })
  return [focused, ghost, theme, EditorView.focusChangeEffect.of((_state, focusing) => setFocused.of(focusing))]
}
