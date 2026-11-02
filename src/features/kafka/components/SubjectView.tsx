import { useCallback, useEffect, useState } from 'react'
import Button from '@/shared/ui/buttons/Button'
import Popover from '@/shared/ui/overlay/Popover'
import MenuItem from '@/shared/ui/navigation/MenuItem'
import Select from '@/shared/ui/form/Select'
import Segmented from '@/shared/ui/form/Segmented'
import { controlClass, Input } from '@/shared/ui/form/Input'
import CodeEditor from '@/shared/ui/CodeEditor'
import { highlight } from '@/shared/ui/highlight'
import { FormField } from '@/shared/ui/form/Form'
import TypeToConfirmDialog from '@/shared/ui/feedback/TypeToConfirmDialog'
import { useToast } from '@/shared/ui/feedback/Toast'
import { MoreVerticalIcon } from '@/shared/ui/icons'
import { COMPATIBILITY_LEVELS, deleteSchema, describeSchema, registerSchema, setSchemaCompatibility, type SchemaDetail, type SchemaType } from '../lib/api'

// Starting points for a new subject, one per format.
const EXAMPLES: Record<SchemaType, string> = {
  AVRO: JSON.stringify(
    {
      type: 'record',
      name: 'Order',
      namespace: 'com.example',
      fields: [
        { name: 'id', type: 'string' },
        { name: 'amount', type: 'double' },
        { name: 'note', type: ['null', 'string'], default: null },
      ],
    },
    null,
    2
  ),
  PROTOBUF: 'syntax = "proto3";\npackage com.example;\n\nmessage Order {\n  string id = 1;\n  double amount = 2;\n  optional string note = 3;\n}\n',
  JSON: JSON.stringify(
    {
      $schema: 'http://json-schema.org/draft-07/schema#',
      title: 'Order',
      type: 'object',
      properties: { id: { type: 'string' }, amount: { type: 'number' } },
      required: ['id'],
    },
    null,
    2
  ),
}

const TYPE_OPTIONS = [
  { value: 'AVRO', label: 'Avro' },
  { value: 'PROTOBUF', label: 'Protobuf' },
  { value: 'JSON', label: 'JSON Schema' },
]

// Avro and JSON Schema are both written in JSON.
const languageOf = (type: SchemaType) => (type === 'PROTOBUF' ? 'protobuf' : 'json')

const pretty = (type: SchemaType, text: string) => {
  if (type === 'PROTOBUF') return text
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

type Draft = { subject: string; type: SchemaType; schema: string; isNew: boolean }
type Removal = { version?: number; permanent: boolean }

/**
 * One Schema Registry subject in a tab — its versions, references and
 * compatibility rule — or, with no subject, a new one being written. A new
 * version is checked against the rule before it's registered, so an
 * incompatible change is explained instead of refused. Deletes are soft unless
 * asked otherwise: a soft-deleted schema still resolves by id, so messages
 * written with it stay readable.
 */
export default function SubjectView({
  conn,
  subject,
  onOpenSubject,
  onChanged,
  onDeleted,
}: {
  conn: any
  subject: string | null
  /** After a new subject registers: its own tab. */
  onOpenSubject: (subject: string) => void
  /** The subject list changed — the sidebar re-reads it. */
  onChanged: () => void
  onDeleted: (subject: string) => void
}) {
  const toast = useToast()
  const [detail, setDetail] = useState<SchemaDetail | null>(null)
  const [version, setVersion] = useState<number | null>(null)
  const [draft, setDraft] = useState<Draft | null>(subject ? null : { subject: '', type: 'AVRO', schema: EXAMPLES.AVRO, isNew: true })
  const [check, setCheck] = useState<{ compatible: boolean; messages: string[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState<Removal | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    if (!subject) return
    return describeSchema(conn, subject)
      .then((d) => {
        setDetail(d)
        setVersion(d.versions[0]?.version ?? null)
        setError(null)
      })
      .catch((e) => setError(e.message))
  }, [conn, subject])
  useEffect(() => {
    load()
  }, [load])

  const current = detail?.versions.find((v) => v.version === version) || null

  const startVersion = () => {
    const latest = detail?.versions[0]
    if (!detail || !latest) return
    setCheck(null)
    setDraft({ subject: detail.subject, type: latest.type, schema: pretty(latest.type, latest.schema), isNew: false })
  }

  const runCheck = async () => {
    if (!draft?.subject.trim()) return
    setBusy(true)
    try {
      const r = await registerSchema(conn, draft.subject.trim(), { schema: draft.schema, type: draft.type, validateOnly: true })
      setCheck({ compatible: Boolean(r.compatible), messages: r.messages || [] })
    } catch (e: any) {
      setCheck({ compatible: false, messages: [e.message] })
    } finally {
      setBusy(false)
    }
  }

  const register = async () => {
    if (!draft?.subject.trim()) return
    setBusy(true)
    try {
      const name = draft.subject.trim()
      const r = await registerSchema(conn, name, { schema: draft.schema, type: draft.type })
      toast.success(`Registered ${name} v${r.version} (schema id ${r.id}).`)
      onChanged()
      if (draft.isNew) {
        onOpenSubject(name)
      } else {
        setDraft(null)
        setCheck(null)
        load()
      }
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  const changeCompatibility = async (level: string) => {
    if (!detail) return
    try {
      await setSchemaCompatibility(conn, detail.subject, level || null)
      toast.success(level ? `${detail.subject} now uses ${level}.` : `${detail.subject} follows the registry's rule again.`)
      load()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const remove = async () => {
    if (!removing || !detail) return
    const r = removing
    setRemoving(null)
    try {
      await deleteSchema(conn, detail.subject, { version: r.version, permanent: r.permanent })
      toast.success(`${r.permanent ? 'Permanently deleted' : 'Deleted'} ${detail.subject}${r.version != null ? ` v${r.version}` : ''}.`)
      onChanged()
      if (r.version != null && detail.versions.length > 1) load()
      else onDeleted(detail.subject)
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-[18px] py-4">
      {draft ? (
        <SchemaEditor
          draft={draft}
          setDraft={(d) => {
            setDraft(d)
            setCheck(null)
          }}
          check={check}
          busy={busy}
          onCheck={runCheck}
          onRegister={register}
          onCancel={
            draft.isNew
              ? undefined
              : () => {
                  setDraft(null)
                  setCheck(null)
                }
          }
        />
      ) : error && !detail ? (
        <div className="rounded-[9px] border border-red/25 bg-red/10 px-3.5 py-3 font-mono text-[11px] text-[#ff9b9b]">{error}</div>
      ) : !detail ? (
        <div className="p-[30px] text-center text-xs text-ink-faint">Reading {subject}…</div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-[14px] font-semibold" title={detail.subject}>
                {detail.subject}
              </div>
              <div className="text-[11px] text-ink-faint">
                {current ? `${current.type} · schema id ${current.id} · ` : ''}
                {detail.versions.length} version{detail.versions.length === 1 ? '' : 's'}
              </div>
            </div>
            <FormField label="Version" className="!mb-0 w-[120px]">
              <Select
                className={controlClass}
                value={String(version ?? '')}
                onChange={(v) => setVersion(Number(v))}
                options={detail.versions.map((v, i) => ({ value: String(v.version), label: `v${v.version}${i === 0 ? ' (latest)' : ''}` }))}
              />
            </FormField>
            <FormField label="Compatibility" className="!mb-0 w-[230px]">
              <Select
                className={controlClass}
                value={detail.compatibilityInherited ? '' : detail.compatibility}
                onChange={changeCompatibility}
                options={[{ value: '', label: `Registry's (${detail.registryCompatibility})` }, ...COMPATIBILITY_LEVELS.map((l) => ({ value: l, label: l }))]}
              />
            </FormField>
            <Button variant="primary" size="sm" onClick={startVersion}>
              New version
            </Button>
            <Popover
              align="right"
              width={230}
              portal
              trigger={({ open, toggle }) => (
                <Button variant="subtle" size="sm" className="!px-2" onClick={toggle} aria-expanded={open} aria-label="Subject actions">
                  <MoreVerticalIcon width={15} height={15} />
                </Button>
              )}
            >
              {({ close }) => (
                <div className="p-1">
                  {current && (
                    <MenuItem
                      danger
                      onClick={() => {
                        close()
                        setRemoving({ version: current.version, permanent: false })
                      }}
                    >
                      Delete v{current.version}…
                    </MenuItem>
                  )}
                  <MenuItem
                    danger
                    onClick={() => {
                      close()
                      setRemoving({ permanent: false })
                    }}
                  >
                    Delete subject…
                  </MenuItem>
                  <MenuItem
                    danger
                    onClick={() => {
                      close()
                      setRemoving({ permanent: true })
                    }}
                  >
                    Delete subject permanently…
                  </MenuItem>
                </div>
              )}
            </Popover>
          </div>

          {current && (
            <>
              {current.references.length > 0 && (
                <p className="mb-2 text-[11px] text-ink-faint">References: {current.references.map((r) => `${r.name} → ${r.subject} v${r.version}`).join(', ')}</p>
              )}
              <pre className="overflow-x-auto rounded-card border border-edge bg-panel p-4 font-mono text-[12px] leading-relaxed text-ink">
                {highlight(pretty(current.type, current.schema), languageOf(current.type))}
              </pre>
            </>
          )}
        </>
      )}

      {removing && detail && (
        <TypeToConfirmDialog
          title={`${removing.permanent ? 'Permanently delete' : 'Delete'} ${detail.subject}${removing.version != null ? ` v${removing.version}` : ''}?`}
          message={
            removing.permanent
              ? 'The schema is erased from the registry. Messages written with it can no longer be decoded by anyone. This cannot be undone.'
              : 'A soft delete: the subject stops taking new versions under this name, but the schema still resolves by id, so messages already written stay readable.'
          }
          confirmText={detail.subject}
          confirmLabel={removing.permanent ? 'Delete permanently' : 'Delete'}
          onConfirm={remove}
          onCancel={() => setRemoving(null)}
        />
      )}
    </div>
  )
}

// Writing a schema: a new subject, or the next version of one.
function SchemaEditor({
  draft,
  setDraft,
  check,
  busy,
  onCheck,
  onRegister,
  onCancel,
}: {
  draft: Draft
  setDraft: (d: Draft) => void
  check: { compatible: boolean; messages: string[] } | null
  busy: boolean
  onCheck: () => void
  onRegister: () => void
  /** Back to the subject; a new subject's tab has nothing to go back to. */
  onCancel?: () => void
}) {
  return (
    <>
      <div className="mb-4 text-[14px] font-semibold">{draft.isNew ? 'New subject' : `New version of ${draft.subject}`}</div>
      <div className="mb-4 grid grid-cols-[2fr_1fr] gap-3.5 max-[720px]:grid-cols-1">
        <FormField label="Subject" hint={draft.isNew ? 'By convention <topic>-value or <topic>-key, so serializers find it from the topic name.' : undefined}>
          <Input
            autoFocus={draft.isNew}
            disabled={!draft.isNew}
            className="font-mono"
            placeholder="orders-value"
            value={draft.subject}
            onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
          />
        </FormField>
        <FormField label="Format">
          <Segmented
            className="w-full [&>button]:flex-1"
            value={draft.type}
            onChange={(type: SchemaType) => setDraft({ ...draft, type, schema: draft.isNew ? EXAMPLES[type] : draft.schema })}
            options={draft.isNew ? TYPE_OPTIONS : TYPE_OPTIONS.filter((o) => o.value === draft.type)}
          />
        </FormField>
      </div>
      <CodeEditor
        language={languageOf(draft.type)}
        wrapperClassName="min-h-[340px] rounded-soft border border-edge bg-elevated focus-within:border-green-dim focus-within:shadow-[0_0_0_3px_rgba(111,207,106,0.22)]"
        className="font-mono text-[12px] leading-relaxed px-3 py-2"
        value={draft.schema}
        onChange={(schema) => setDraft({ ...draft, schema })}
      />
      {check && (
        <div className={`mt-3 rounded-[9px] border px-3.5 py-2.5 text-[11px] ${check.compatible ? 'border-green-dim bg-green/10 text-green-bright' : 'border-amber/30 bg-amber/10 text-amber'}`}>
          <div className="font-semibold">{check.compatible ? 'Compatible — it can be registered.' : 'Not compatible with the subject’s rule.'}</div>
          {check.messages
            .filter((m) => !/^\{(oldSchema|oldSchemaVersion|validateFields)/.test(m))
            .map((m, i) => (
              <div key={i} className="mt-1 font-mono">
                {m}
              </div>
            ))}
        </div>
      )}
      <div className="mt-4 flex justify-end gap-2">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button variant="subtle" onClick={onCheck} disabled={busy || !draft.subject.trim()}>
          Check compatibility
        </Button>
        <Button variant="primary" onClick={onRegister} disabled={busy || !draft.subject.trim() || !draft.schema.trim()}>
          {busy ? 'Working…' : 'Register'}
        </Button>
      </div>
    </>
  )
}
