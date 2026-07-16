import { useState } from 'react'
import { cellText, editorKind } from '@/features/workspace/components/DataGrid'
import { formatCombo, useKeymap, useShortcut } from '@/features/keymap'
import Button from '@/shared/ui/buttons/Button'
import Segmented from '@/shared/ui/navigation/Segmented'
import SlideOverPanel from '@/shared/ui/overlay/SlideOverPanel'
import { useSlideOver } from '@/shared/hooks/useSlideOver'
import { Input, Textarea } from '@/shared/ui/form/Input'
import NumberStepper from '@/shared/ui/form/NumberStepper'
import DateTimeField from '@/shared/ui/form/DateTimeField'
import JsonEditor from '@/shared/ui/JsonEditor'

const NUMERIC = /int|real|numeric|decimal|float|double|serial/i
const isJsonType = (t) => /json/i.test(t || '')
const isTextArea = (t) => /text|clob/i.test(t || '')

// Date/time columns get the picker field; the grid's cell editor maps types the
// same way, so a column looks the same wherever it's edited.
const DATE_KINDS = ['date', 'time', 'datetime']
const dateKindOf = (col) => {
  const kind = editorKind(col.type)
  return DATE_KINDS.includes(kind) ? kind : null
}

// A value is only mandatory when the database has no way to supply one itself:
// NOT NULL, no default, and not auto-assigned (serial/identity/rowid alias).
// Anything the database can fill in stays blankable — a blank field is left out
// of the INSERT entirely, so the default or sequence applies.
const isRequired = (col) => col.notnull && col.default == null && !col.autoIncrement

// What a blank field falls back to. Editing can only ever write NULL back;
// inserting can also leave the column out and let the database fill it in.
const blankLabel = (col, isEdit) =>
  isEdit ? 'NULL' : col.autoIncrement ? 'AUTO' : col.default != null ? 'DEFAULT' : 'NULL'

// Whether a value may be cleared again. On insert that just drops the column
// from the statement, so anything the database can fill in qualifies; on edit
// it writes an actual NULL, which NOT NULL columns and keys won't take.
const canBlank = (col, isEdit) => (isEdit ? !col.notnull && !col.pk : !isRequired(col))

const coerce = (col, v) => {
  if (NUMERIC.test(col.type)) {
    const n = Number(v)
    return v.trim() !== '' && !Number.isNaN(n) ? n : v
  }
  return v
}

// A field holds `null` while blank and a string once it has a value, so an
// empty string is a value the user chose rather than "no value given".
const valueOf = (col, v) => {
  if (v == null) return null
  if (NUMERIC.test(col.type)) return v.trim() === '' ? null : coerce(col, v)
  return v
}

const sameValue = (a, b) => (a == null || b == null ? (a == null) === (b == null) : cellText(a) === cellText(b))

// Row values arrive as native JS values (numbers, Dates, JSON objects); every
// field editor works on text, so seed from the same stringify DataGrid uses.
// A new row starts blank apart from the columns the database won't fill in.
const seedValue = (row, col) =>
  row ? (row[col.name] == null ? null : cellText(row[col.name])) : isRequired(col) ? '' : null

const initialValues = (row, columns) => Object.fromEntries(columns.map((c) => [c.name, seedValue(row, c)]))

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
  // The field that was just given a value, so its editor can take focus.
  const [focus, setFocus] = useState(null)

  const setVal = (name, v) => setValues((s) => ({ ...s, [name]: v }))

  // Columns can land after mount (the schema is still loading), so fall back to
  // the seed rather than reading a missing key as blank.
  const valFor = (col) => (col.name in values ? values[col.name] : seedValue(row, col))

  const buildFull = () =>
    columns.reduce((o, c) => {
      o[c.name] = valueOf(c, valFor(c))
      return o
    }, {})

  const switchTab = (next) => {
    if (next === tab) return
    if (next === 'json') {
      setJsonText(JSON.stringify(buildFull(), null, 2))
    } else {
      try {
        const parsed = JSON.parse(jsonText)
        const merged = Object.fromEntries(columns.map((c) => [c.name, null]))
        Object.entries(parsed).forEach(([k, v]) => {
          merged[k] = v == null ? null : cellText(v)
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
  // was given a value, leaving blank columns out so their default applies.
  const keep = (name, next) => (isEdit ? !sameValue(row[name], next) : next !== null)

  const collectFields = () => {
    const out = {}
    columns.forEach((c) => {
      const next = valueOf(c, valFor(c))
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
          const val = valFor(col)
          const typeLabel = (col.type || 'ANY').toUpperCase()
          const required = isRequired(col)
          const blank = blankLabel(col, isEdit)
          const dateKind = dateKindOf(col)
          const setBlank = () => setVal(col.name, null)
          const setValue = () => {
            setVal(col.name, '')
            setFocus(col.name)
          }
          const autoFocus = focus === col.name
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
                {/* A value only goes back to blank on purpose — never by clearing the field. */}
                {val !== null && canBlank(col, isEdit) && (
                  <button
                    type="button"
                    onClick={setBlank}
                    className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-ink-faint transition-colors hover:bg-elevated hover:text-ink"
                  >
                    Set {blank}
                  </button>
                )}
              </div>
              {val === null ? (
                <button
                  type="button"
                  onClick={setValue}
                  className="flex w-full items-center justify-between gap-2 rounded-soft border border-dashed border-edge bg-elevated/40 px-3 py-2 text-left transition-colors hover:border-edge-strong hover:bg-card-hover"
                >
                  <span className="font-mono text-[11px] italic text-ink-faint">{blank}</span>
                  <span className="text-[10px] font-semibold text-ink-dim">Set value</span>
                </button>
              ) : isJsonType(col.type) ? (
                <JsonEditor
                  id={fid}
                  wrapperClassName="min-h-[90px] bg-elevated border border-edge rounded-soft focus-within:border-green-dim focus-within:shadow-[0_0_0_3px_rgba(111,207,106,0.22)]"
                  className="font-mono text-[11px] leading-relaxed px-3 py-2"
                  value={val}
                  onChange={(v) => setVal(col.name, v)}
                />
              ) : dateKind ? (
                <DateTimeField
                  id={fid}
                  kind={dateKind}
                  autoFocus={autoFocus}
                  value={val}
                  onChange={(v) => setVal(col.name, v)}
                />
              ) : isTextArea(col.type) ? (
                <Textarea
                  id={fid}
                  autoFocus={autoFocus}
                  className="min-h-[90px] resize-y"
                  value={val}
                  onChange={(e) => setVal(col.name, e.target.value)}
                />
              ) : NUMERIC.test(col.type) ? (
                <NumberStepper
                  id={fid}
                  autoFocus={autoFocus}
                  value={val === '' ? null : Number(val)}
                  onChange={(n) => setVal(col.name, n === null ? '' : String(n))}
                  min={-Infinity}
                  max={Infinity}
                  ariaLabel={col.name}
                  className="w-full"
                />
              ) : (
                <Input id={fid} autoFocus={autoFocus} value={val} onChange={(e) => setVal(col.name, e.target.value)} />
              )}
            </div>
          )
        })
      )}
    </SlideOverPanel>
  )
}
