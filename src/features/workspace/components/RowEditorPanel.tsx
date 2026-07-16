import { useState } from 'react'
import { cellText } from '@/features/workspace/components/DataGrid'
import { formatCombo, useKeymap, useShortcut } from '@/features/keymap'
import Button from '@/shared/ui/buttons/Button'
import Segmented from '@/shared/ui/navigation/Segmented'
import SlideOverPanel from '@/shared/ui/overlay/SlideOverPanel'
import { useSlideOver } from '@/shared/hooks/useSlideOver'
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
  row ? Object.fromEntries(columns.map((c) => [c.name, row[c.name] == null ? '' : cellText(row[c.name])])) : {}

/**
 * The Fields/JSON row editor behind both the inspector (editing an existing
 * row) and the insert panel (composing a new one).
 *
 * Pass `row` to edit it: saving stages only the columns that changed. Omit it
 * to insert: saving stages every column that was given a value.
 */
export default function RowEditorPanel({
  title,
  submitLabel,
  columns,
  row = null,
  loading = false,
  onClose,
  onStage,
}) {
  const isEdit = row != null
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

  // Editing stages a diff against the original row; inserting stages whatever
  // was filled in.
  const keep = (name, next) => (isEdit ? String(row[name] ?? '') !== String(next ?? '') : next !== null && next !== '')

  const collectFields = () => {
    const out = {}
    columns.forEach((c) => {
      const v = values[c.name]
      const next = v !== undefined && v !== '' ? coerce(c, v) : null
      if (keep(c.name, next)) out[c.name] = next
    })
    return out
  }

  const collectJson = () => {
    let parsed
    try {
      parsed = JSON.parse(jsonText)
    } catch {
      setError('Invalid JSON')
      return null
    }
    const out = {}
    Object.entries(parsed).forEach(([k, v]) => {
      if (keep(k, v)) out[k] = v
    })
    return out
  }

  const handleSave = () => {
    setError(null)
    const data = tab === 'json' ? collectJson() : collectFields()
    if (!data) return
    if (Object.keys(data).length === 0) {
      setError(isEdit ? 'No changes to save.' : 'Set at least one value before saving.')
      return
    }
    close(() => onStage(data))
  }

  useShortcut('general.save', handleSave)

  return (
    <SlideOverPanel
      show={show}
      close={close}
      title={title}
      error={error}
      subheader={
        <Segmented
          value={tab}
          onChange={switchTab}
          options={[
            { value: 'fields', label: 'Fields' },
            { value: 'json', label: 'JSON' },
          ]}
        />
      }
      footer={
        <>
          <Button variant="subtle" onClick={() => close()}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={loading}>
            {submitLabel}
            <kbd className="rounded bg-black/20 px-1.5 py-px text-[10px] font-semibold">
              {formatCombo(bindings['general.save'])}
            </kbd>
          </Button>
        </>
      }
    >
      {loading ? (
        <div className="py-10 text-center text-xs text-ink-faint">Loading schema…</div>
      ) : tab === 'json' ? (
        <JsonEditor
          wrapperClassName="min-h-[420px] bg-elevated border border-edge rounded-soft focus-within:border-green-dim focus-within:shadow-[0_0_0_3px_rgba(111,207,106,0.22)]"
          className="font-mono text-[11px] leading-relaxed px-3 py-2"
          value={jsonText}
          onChange={setJsonText}
        />
      ) : (
        columns.map((col) => {
          const fid = `row-f-${col.name}`
          const val = values[col.name] ?? ''
          const typeLabel = (col.type || 'ANY').toUpperCase()
          const required = col.notnull && !(col.pk && col.default != null)
          const placeholder = required ? undefined : 'NULL'
          return (
            <div key={col.name} className="mb-5">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <label htmlFor={fid} className="font-mono text-sm text-ink">
                    {col.name}
                  </label>
                  <span className="text-[10px] font-semibold tracking-wide text-ink-faint">{typeLabel}</span>
                  {col.pk && (
                    <span className="rounded bg-green/15 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-green-bright">
                      PK
                    </span>
                  )}
                  {required && (
                    <span className="rounded bg-amber/15 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-amber">
                      Required
                    </span>
                  )}
                </div>
              </div>
              {isJsonType(col.type) ? (
                <JsonEditor
                  id={fid}
                  wrapperClassName="min-h-[90px] bg-elevated border border-edge rounded-soft focus-within:border-green-dim focus-within:shadow-[0_0_0_3px_rgba(111,207,106,0.22)]"
                  className="font-mono text-[11px] leading-relaxed px-3 py-2"
                  placeholder={placeholder}
                  value={val}
                  onChange={(v) => setVal(col.name, v)}
                />
              ) : isTextArea(col.type) ? (
                <Textarea
                  id={fid}
                  className="min-h-[90px] resize-y"
                  placeholder={placeholder}
                  value={val}
                  onChange={(e) => setVal(col.name, e.target.value)}
                />
              ) : NUMERIC.test(col.type) ? (
                <NumberStepper
                  id={fid}
                  allowNull={!required}
                  value={val === '' ? null : Number(val)}
                  onChange={(n) => setVal(col.name, n === null ? '' : String(n))}
                  min={-Infinity}
                  max={Infinity}
                  ariaLabel={col.name}
                  placeholder={placeholder}
                  className="w-full"
                />
              ) : (
                <Input
                  id={fid}
                  placeholder={placeholder}
                  value={val}
                  onChange={(e) => setVal(col.name, e.target.value)}
                />
              )}
            </div>
          )
        })
      )}
    </SlideOverPanel>
  )
}
