import { useState } from 'react'
import { cellText } from '@/features/workspace/components/DataGrid'
import { formatCombo, useKeymap, useShortcut } from '@/features/keymap'
import Button from '@/shared/ui/buttons/Button'
import IconButton from '@/shared/ui/buttons/IconButton'
import Segmented from '@/shared/ui/navigation/Segmented'
import { useSlideOver } from '@/shared/hooks/useSlideOver'
import { ChevronRight } from '@/shared/ui/icons'
import { Input, Textarea } from '@/shared/ui/form/Input'
import NumberStepper from '@/shared/ui/form/NumberStepper'
import JsonEditor from '@/shared/ui/JsonEditor'

const NUMERIC = /int|real|numeric|decimal|float|double|serial/i
const isJsonType = (t) => /json/i.test(t || '')
const isTextArea = (t) => /text|clob/i.test(t || '')

const coerce = (col, v) => {
  if (NUMERIC.test(col.type)) {
    const n = Number(v)
    return v.trim() !== '' && !Number.isNaN(n) ? n : v
  }
  return v
}

// Row values arrive as native JS values (numbers, Dates, JSON objects); every
// field editor works on text, so seed from the same stringify DataGrid uses.
const initialValues = (row, columns) =>
  Object.fromEntries(columns.map((c) => [c.name, row[c.name] == null ? '' : cellText(row[c.name])]))

export default function InspectorPanel({ row, columns, onClose, onStage }) {
  const { show, close } = useSlideOver(onClose)
  const { bindings } = useKeymap()
  const [values, setValues] = useState(() => initialValues(row, columns))
  const [tab, setTab] = useState('fields')
  const [jsonText, setJsonText] = useState('')
  const [error, setError] = useState(null)

  const setVal = (name, v) => setValues((s) => ({ ...s, [name]: v }))

  const buildFull = () =>
    columns.reduce((o, c) => {
      const v = values[c.name]
      o[c.name] = v !== undefined && v !== '' ? coerce(c, v) : null
      return o
    }, {})

  const buildDiff = () => {
    const diff = {}
    columns.forEach((c) => {
      const v = values[c.name]
      const next = v !== undefined && v !== '' ? coerce(c, v) : null
      if (String(row[c.name] ?? '') !== String(next ?? '')) diff[c.name] = next
    })
    return diff
  }

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

  const collectJsonDiff = () => {
    let parsed
    try {
      parsed = JSON.parse(jsonText)
    } catch {
      setError('Invalid JSON')
      return null
    }
    const diff = {}
    Object.entries(parsed).forEach(([k, v]) => {
      if (String(row[k] ?? '') !== String(v ?? '')) diff[k] = v
    })
    return diff
  }

  const handleSave = () => {
    setError(null)
    const diff = tab === 'json' ? collectJsonDiff() : buildDiff()
    if (!diff) return
    if (Object.keys(diff).length === 0) {
      setError('No changes to save.')
      return
    }
    close(() => onStage(diff))
  }

  useShortcut('general.save', handleSave)

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
        onKeyDown={(e) => e.key === 'Escape' && close()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-edge px-5 py-4">
          <h3 className="text-base font-bold">Inspector</h3>
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
          {tab === 'json' ? (
            <JsonEditor
              wrapperClassName="min-h-[420px] bg-elevated border border-edge rounded-soft focus-within:border-green-dim focus-within:shadow-[0_0_0_3px_rgba(111,207,106,0.22)]"
              className="font-mono text-[11px] leading-relaxed px-3 py-2"
              value={jsonText}
              onChange={setJsonText}
            />
          ) : (
            columns.map((col) => {
              const fid = `inspect-f-${col.name}`
              const val = values[col.name] ?? ''
              const typeLabel = (col.type || 'ANY').toUpperCase()
              const required = col.notnull && !(col.pk && col.default != null)
              return (
                <div key={col.name} className="mb-5">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <label htmlFor={fid} className="font-mono text-sm text-ink">{col.name}</label>
                      <span className="text-[10px] font-semibold tracking-wide text-ink-faint">{typeLabel}</span>
                      {col.pk && (
                        <span className="rounded bg-green/15 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-green-bright">PK</span>
                      )}
                      {required && (
                        <span className="rounded bg-amber/15 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-amber">Required</span>
                      )}
                    </div>
                  </div>
                  {isJsonType(col.type) ? (
                    <JsonEditor
                      id={fid}
                      wrapperClassName="min-h-[90px] bg-elevated border border-edge rounded-soft focus-within:border-green-dim focus-within:shadow-[0_0_0_3px_rgba(111,207,106,0.22)]"
                      className="font-mono text-[11px] leading-relaxed px-3 py-2"
                      placeholder="NULL"
                      value={val}
                      onChange={(v) => setVal(col.name, v)}
                    />
                  ) : isTextArea(col.type) ? (
                    <Textarea
                      id={fid}
                      className="min-h-[90px] resize-y"
                      placeholder="NULL"
                      value={val}
                      onChange={(e) => setVal(col.name, e.target.value)}
                    />
                  ) : NUMERIC.test(col.type) ? (
                    <NumberStepper
                      id={fid}
                      allowNull
                      value={val === '' ? null : Number(val)}
                      onChange={(n) => setVal(col.name, n === null ? '' : String(n))}
                      min={-Infinity}
                      max={Infinity}
                      ariaLabel={col.name}
                      placeholder="NULL"
                      className="w-full"
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
          <Button variant="primary" onClick={handleSave}>
            Save changes
            <kbd className="rounded bg-black/20 px-1.5 py-px text-[10px] font-semibold">
              {formatCombo(bindings['general.save'])}
            </kbd>
          </Button>
        </div>
      </div>
    </div>
  )
}
