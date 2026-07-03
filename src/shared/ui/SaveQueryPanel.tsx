import { useEffect, useRef, useState } from 'react'
import Button from '@/shared/ui/Button'
import { useSlideOver } from '@/shared/hooks/useSlideOver'
import { ChevronRight, CodeIcon } from '@/shared/ui/icons'
import { Input } from '@/shared/ui/Input'

export default function SaveQueryPanel({ sql, defaultName = '', title = 'Save Query', onClose, onSave }) {
  const { show, close } = useSlideOver(onClose)
  const [name, setName] = useState(defaultName)
  const [error, setError] = useState(null)
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSave = () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Give the query a name.')
      return
    }
    close(() => onSave(trimmed))
  }

  // ⌘S / Ctrl+S to save, Esc to close
  const saveRef = useRef(handleSave)
  saveRef.current = handleSave
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        saveRef.current()
      } else if (e.key === 'Escape') {
        close()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  return (
    <div
      className={`fixed inset-0 z-50 flex justify-end bg-black/50 transition-opacity duration-200 ${
        show ? 'opacity-100' : 'opacity-0'
      }`}
      onMouseDown={() => close()}
    >
      <div
        className={`flex h-full w-full max-w-[460px] flex-col border-l border-edge-strong bg-panel shadow-[-20px_0_60px_-20px_rgba(0,0,0,0.8)] transition-transform duration-200 ease-out ${
          show ? 'translate-x-0' : 'translate-x-full'
        }`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-edge px-5 py-4">
          <h3 className="text-base font-bold">{title}</h3>
          <button
            className="flex h-8 w-8 items-center justify-center rounded-soft text-ink-dim hover:bg-elevated hover:text-ink"
            onClick={() => close()}
            aria-label="Close"
          >
            <ChevronRight />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-5">
            <label htmlFor="save-query-name" className="mb-2 block text-sm text-ink">
              Name
            </label>
            <Input
              id="save-query-name"
              ref={inputRef}
              placeholder="e.g. Recent signups"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                if (error) setError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleSave()
                }
              }}
            />
          </div>

          <div>
            <div className="mb-2 flex items-center gap-2 text-sm text-ink">
              <CodeIcon width={15} height={15} className="text-ink-faint" />
              SQL
            </div>
            <pre className="max-h-[320px] overflow-auto rounded-soft border border-edge bg-elevated px-3.5 py-3 font-mono text-[11px] leading-relaxed text-ink-dim whitespace-pre-wrap">
              {sql.trim()}
            </pre>
          </div>
        </div>

        {/* Error + footer */}
        {error && (
          <div className="border-t border-edge bg-red/10 px-5 py-2.5 font-mono text-[11px] text-[#ff9b9b]">{error}</div>
        )}
        <div className="flex items-center justify-end gap-3 border-t border-edge px-5 py-4">
          <Button variant="subtle" onClick={() => close()}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave}>
            Save
            <kbd className="rounded bg-black/20 px-1.5 py-px text-[10px] font-semibold">⌘S</kbd>
          </Button>
        </div>
      </div>
    </div>
  )
}
