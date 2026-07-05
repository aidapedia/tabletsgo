import { useEffect, useState } from 'react'
import { getColumns } from '@/shared/api/database'
import { formatCombo, useKeymap, useShortcut } from '@/features/keymap'
import Button from '@/shared/ui/buttons/Button'
import IconButton from '@/shared/ui/buttons/IconButton'
import TextButton from '@/shared/ui/buttons/TextButton'
import Segmented from '@/shared/ui/navigation/Segmented'
import { useSlideOver } from '@/shared/hooks/useSlideOver'
import { ChevronRight } from '@/shared/ui/icons'
import { Input, Textarea } from '@/shared/ui/form/Input'

const NUMERIC = /int|real|numeric|decimal|float|double|serial/i
const isTextArea = (t) => /text|clob|json/i.test(t || '')

const prettify = (name) =>
  name
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')

const coerce = (col, v) => {
  if (NUMERIC.test(col.type)) {
    const n = Number(v)
    return v.trim() !== '' && !Number.isNaN(n) ? n : v
  }
  return v
}

export default function InsertRowPanel({ conn, table, onClose, onStage }) {
  const { show, close } = useSlideOver(onClose)
  const { bindings } = useKeymap()
  const [columns, setColumns] = useState([])
  const [loading, setLoading] = useState(true)
  const [values, setValues] = useState({})
  const [tab, setTab] = useState('fields')
  const [jsonText, setJsonText] = useState('')
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    getColumns(conn, table).then((cols) => {
      if (!alive) return
      setColumns(cols)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [conn, table])

  const setVal = (name, v) => setValues((s) => ({ ...s, [name]: v }))

  const buildFull = () =>
    columns.reduce((o, c) => {
      const v = values[c.name]
      o[c.name] = v !== undefined && v !== '' ? v : null
      return o
    }, {})

  const switchTab = (next) => {
    if (next === tab) return
    if (next === 'json') {
      setJsonText(JSON.stringify(buildFull(), null, 2))
    } else {
      try {
        const parsed = JSON.parse(jsonText)
        const merged = {}
        Object.entries(parsed).forEach(([k, v]) => {
          merged[k] = v == null ? '' : String(v)
        })
        setValues(merged)
        setError(null)
      } catch {
        setError('Invalid JSON — fix it before switching back to Fields.')
        return
      }
    }
    setTab(next)
  }

  const collect = () => {
    if (tab === 'json') {
      let parsed
      try {
        parsed = JSON.parse(jsonText)
      } catch {
        setError('Invalid JSON')
        return null
      }
      const out = {}
      Object.entries(parsed).forEach(([k, v]) => {
        if (v !== null && v !== '') out[k] = v
      })
      return out
    }
    const out = {}
    columns.forEach((c) => {
      const v = values[c.name]
      if (v !== undefined && v !== '') out[c.name] = coerce(c, v)
    })
    return out
  }

  const handleSave = () => {
    setError(null)
    const data = collect()
    if (!data) return
    if (Object.keys(data).length === 0) {
      setError('Set at least one value before saving.')
      return
    }
    close(() => onStage(data))
  }

  useShortcut('general.save', handleSave)

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && close()
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
          <h3 className="text-base font-bold">Insert New Row</h3>
          <IconButton size="lg" onClick={() => close()} aria-label="Close">
            <ChevronRight />
          </IconButton>
        </div>

        {/* Fields / JSON toggle */}
        <div className="border-b border-edge px-5 py-3">
          <Segmented
            value={tab}
            onChange={switchTab}
            options={[
              { value: 'fields', label: 'Fields' },
              { value: 'json', label: 'JSON' },
            ]}
          />
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="py-10 text-center text-xs text-ink-faint">Loading schema…</div>
          ) : tab === 'json' ? (
            <Textarea
              className="min-h-[420px] resize-y font-mono leading-relaxed"
              spellCheck={false}
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
            />
          ) : (
            columns.map((col) => {
              const fid = `insert-f-${col.name}`
              const val = values[col.name] ?? ''
              const typeLabel = (col.type || 'ANY').toUpperCase()
              return (
                <div key={col.name} className="mb-5">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <label htmlFor={fid} className="text-sm text-ink">{prettify(col.name)}</label>
                      <span className="text-[10px] font-semibold tracking-wide text-ink-faint">{typeLabel}</span>
                      {col.pk && (
                        <span className="rounded bg-green/15 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-green-bright">PK</span>
                      )}
                    </div>
                    <TextButton className="!text-[11px]" onClick={() => document.getElementById(fid)?.focus()}>
                      Set value
                    </TextButton>
                  </div>
                  {isTextArea(col.type) ? (
                    <Textarea
                      id={fid}
                      className="min-h-[90px] resize-y"
                      placeholder="NULL"
                      value={val}
                      onChange={(e) => setVal(col.name, e.target.value)}
                    />
                  ) : (
                    <Input
                      id={fid}
                      placeholder="NULL"
                      value={val}
                      onChange={(e) => setVal(col.name, e.target.value)}
                    />
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* Error + footer */}
        {error && (
          <div className="border-t border-edge bg-red/10 px-5 py-2.5 font-mono text-[11px] text-[#ff9b9b]">{error}</div>
        )}
        <div className="flex items-center justify-end gap-3 border-t border-edge px-5 py-4">
          <Button variant="subtle" onClick={() => close()}>Cancel</Button>
          <Button variant="primary" onClick={handleSave} disabled={loading}>
            Add to changes
            <kbd className="rounded bg-black/20 px-1.5 py-px text-[10px] font-semibold">
              {formatCombo(bindings['general.save'])}
            </kbd>
          </Button>
        </div>
      </div>
    </div>
  )
}
