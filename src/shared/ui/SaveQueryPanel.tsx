import { useEffect, useRef, useState } from 'react'
import Button from '@/shared/ui/buttons/Button'
import SlideOverPanel from '@/shared/ui/overlay/SlideOverPanel'
import { useSlideOver } from '@/shared/hooks/useSlideOver'
import { CodeIcon } from '@/shared/ui/icons'
import { Input } from '@/shared/ui/form/Input'

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

  // ⌘S / Ctrl+S to save (Esc to close is handled by the panel).
  const saveRef = useRef(handleSave)
  saveRef.current = handleSave
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        saveRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <SlideOverPanel
      show={show}
      close={close}
      title={title}
      error={error}
      footer={
        <>
          <Button variant="subtle" onClick={() => close()}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave}>
            Save
            <kbd className="rounded bg-black/20 px-1.5 py-px text-[10px] font-semibold">⌘S</kbd>
          </Button>
        </>
      }
    >
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
    </SlideOverPanel>
  )
}
