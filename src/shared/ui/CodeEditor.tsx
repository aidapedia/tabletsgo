import { useRef } from 'react'
import type { KeyboardEvent } from 'react'
import { highlight, type CodeLanguage } from './highlight'

type CodeEditorProps = {
  id?: string
  /** How the text is coloured; JSON unless told otherwise. */
  language?: CodeLanguage
  value: string
  onChange: (value: string) => void
  placeholder?: string
  autoFocus?: boolean
  disabled?: boolean
  /** Border/background/height on the outer box. */
  wrapperClassName?: string
  /** Font/padding shared by the colored backdrop and the transparent textarea. */
  className?: string
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void
}

// Colors code as it's typed: a transparent textarea layered over a scroll-synced
// <pre> that renders the same text tokenized by color. Keeps native textarea
// editing (caret, selection, undo, resize-free scrolling) — no editor dependency
// needed just to color a single JSON blob or schema.
export default function CodeEditor({
  id,
  language = 'json',
  value,
  onChange,
  placeholder,
  autoFocus,
  disabled,
  wrapperClassName = '',
  className = 'font-mono text-[12px] leading-relaxed px-4 py-3',
  onKeyDown,
}: CodeEditorProps) {
  const preRef = useRef<HTMLPreElement>(null)

  const syncScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (!preRef.current) return
    preRef.current.scrollTop = e.currentTarget.scrollTop
    preRef.current.scrollLeft = e.currentTarget.scrollLeft
  }

  const sharedCls = `whitespace-pre-wrap break-words ${className}`

  return (
    <div className={`relative ${disabled ? 'opacity-50' : ''} ${wrapperClassName}`}>
      <pre ref={preRef} aria-hidden className={`${sharedCls} pointer-events-none absolute inset-0 m-0 overflow-auto text-ink`}>
        {value
          ? highlight(value, language)
          : <span className="text-ink-faint">{placeholder}</span>}
      </pre>
      <textarea
        id={id}
        autoFocus={autoFocus}
        disabled={disabled}
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
