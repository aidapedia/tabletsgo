import { useRef } from 'react'
import type { KeyboardEvent } from 'react'

// Tokenizes JSON text into { text, cls } runs so keys, strings, numbers,
// booleans/null and punctuation can each get their own color. Matches as text
// is typed, even mid-edit / invalid JSON — it's a highlighter, not a parser.
const TOKEN_RE =
  /("(?:\\u[0-9a-fA-F]{4}|\\[^u]|[^\\"])*"(\s*:)?)|\b(true|false)\b|\b(null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}[\],:])/g

function tokenize(text: string) {
  const parts: { text: string; cls?: string }[] = []
  let last = 0
  let m: RegExpExecArray | null
  TOKEN_RE.lastIndex = 0
  while ((m = TOKEN_RE.exec(text))) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index) })
    const [full, str, colon, bool, nul, num] = m
    const cls = str ? (colon ? 'key' : 'string') : bool ? 'bool' : nul ? 'null' : num ? 'number' : 'punct'
    parts.push({ text: full, cls })
    last = TOKEN_RE.lastIndex
  }
  if (last < text.length) parts.push({ text: text.slice(last) })
  return parts
}

const COLORS: Record<string, string> = {
  key: '#82aaff',
  string: '#8fe08a',
  number: '#d6a73a',
  bool: '#c792ea',
  null: '#c792ea',
  punct: '#9aa0aa',
}

type JsonEditorProps = {
  id?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  autoFocus?: boolean
  /** Border/background/height on the outer box. */
  wrapperClassName?: string
  /** Font/padding shared by the colored backdrop and the transparent textarea. */
  className?: string
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void
}

// Colors JSON as it's typed: a transparent textarea layered over a scroll-synced
// <pre> that renders the same text tokenized by color. Keeps native textarea
// editing (caret, selection, undo, resize-free scrolling) — no editor dependency
// needed just to color a single JSON blob.
export default function JsonEditor({
  id,
  value,
  onChange,
  placeholder,
  autoFocus,
  wrapperClassName = '',
  className = 'font-mono text-[12px] leading-relaxed px-4 py-3',
  onKeyDown,
}: JsonEditorProps) {
  const preRef = useRef<HTMLPreElement>(null)

  const syncScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (!preRef.current) return
    preRef.current.scrollTop = e.currentTarget.scrollTop
    preRef.current.scrollLeft = e.currentTarget.scrollLeft
  }

  const sharedCls = `whitespace-pre-wrap break-words ${className}`

  return (
    <div className={`relative ${wrapperClassName}`}>
      <pre ref={preRef} aria-hidden className={`${sharedCls} pointer-events-none absolute inset-0 m-0 overflow-auto text-ink`}>
        {value
          ? tokenize(value).map((t, i) => (t.cls ? <span key={i} style={{ color: COLORS[t.cls] }}>{t.text}</span> : t.text))
          : <span className="text-ink-faint">{placeholder}</span>}
      </pre>
      <textarea
        id={id}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncScroll}
        onKeyDown={onKeyDown}
        spellCheck={false}
        aria-label={placeholder}
        style={{ caretColor: 'var(--color-green)' }}
        className={`${sharedCls} absolute inset-0 resize-none overflow-auto bg-transparent text-transparent outline-none`}
      />
    </div>
  )
}
