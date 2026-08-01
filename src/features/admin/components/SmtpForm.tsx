import { useState } from 'react'
import type { ReactNode } from 'react'
import Button from '@/shared/ui/buttons/Button'
import { Input, controlClass } from '@/shared/ui/form/Input'
import PasswordInput from '@/shared/ui/form/PasswordInput'
import { FormField } from '@/shared/ui/form/Form'
import Select from '@/shared/ui/form/Select'

/**
 * The mail-server form — host/port/encryption/credentials plus a "send a test
 * email" box. Purely presentational: it owns the field state and hands the
 * caller a payload, which keeps AdminSmtpPanel about loading and saving.
 *
 * Mount it with `initial` already loaded (the panel shows a LoadingState
 * first) — the fields seed from it once, the way an uncontrolled form does.
 */
export type SmtpValue = { host: string; port: string; secure: boolean; user: string; from: string; pass: string }

// The non-secret config that applies when these fields are left blank; used as
// placeholder text so the form shows what's actually in effect.
export type SmtpPlaceholders = { host?: string; port?: string | number; user?: string; from?: string } | null

// Two ports need two different negotiations — mixing them up is the #1 cause
// of "wrong version number" SSL errors, so make the encryption mode an
// explicit choice (same pattern as the connections' SSL Mode select) instead
// of a bare checkbox.
const ENCRYPTION_MODES = [
  { value: 'starttls', label: 'STARTTLS (port 587)' },
  { value: 'tls', label: 'Implicit TLS/SSL (port 465)' },
]

type Props = {
  initial: SmtpValue
  hasPassword: boolean
  placeholders?: SmtpPlaceholders
  note?: ReactNode
  testNote?: ReactNode
  defaultTestTo?: string
  saving?: boolean
  testing?: boolean
  onSave: (value: SmtpValue) => void | Promise<void>
  onTest: (to: string, value: SmtpValue) => void | Promise<void>
  actions?: ReactNode // extra buttons beside Save (e.g. "Remove")
}

export default function SmtpForm({
  initial,
  hasPassword,
  placeholders = null,
  note,
  testNote,
  defaultTestTo = '',
  saving = false,
  testing = false,
  onSave,
  onTest,
  actions,
}: Props) {
  const [smtp, setSmtp] = useState<SmtpValue>(initial)
  const [testTo, setTestTo] = useState(defaultTestTo)

  const set = (k: keyof SmtpValue) => (e: any) => setSmtp((s) => ({ ...s, [k]: e.target.value }))

  // Switching mode also nudges the port to that mode's default, but only when
  // the port is still blank or at the *other* mode's default — a custom port
  // (e.g. a provider on 2525) is left alone.
  const setEncryption = (mode: string) => {
    setSmtp((s) => {
      const secure = mode === 'tls'
      const otherDefault = secure ? '587' : '465'
      const nextDefault = secure ? '465' : '587'
      const port = !s.port || s.port === otherDefault ? nextDefault : s.port
      return { ...s, secure, port }
    })
  }

  const save = async () => {
    await onSave(smtp)
    setSmtp((s) => ({ ...s, pass: '' })) // the password is write-only
  }

  return (
    <div>
      {note && <div className="mb-3 text-[11px] leading-relaxed text-ink-dim">{note}</div>}
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Host">
          <Input value={smtp.host} onChange={set('host')} placeholder={placeholders?.host || 'smtp.example.com'} />
        </FormField>
        <FormField label="Port">
          <Input type="number" value={smtp.port} onChange={set('port')} placeholder={String(placeholders?.port || '587')} />
        </FormField>
        <FormField label="Encryption">
          <Select className={controlClass} value={smtp.secure ? 'tls' : 'starttls'} onChange={setEncryption} options={ENCRYPTION_MODES} />
        </FormField>
        <FormField label="Username">
          <Input value={smtp.user} onChange={set('user')} placeholder={placeholders?.user || 'apikey / user'} />
        </FormField>
        <FormField label="Password">
          <PasswordInput
            value={smtp.pass}
            onChange={set('pass')}
            placeholder={hasPassword ? '•••••••• (unchanged)' : placeholders ? '(inherited)' : ''}
          />
        </FormField>
        <FormField label="From address" className="col-span-2">
          <Input value={smtp.from} onChange={set('from')} placeholder={placeholders?.from || 'Tabletsgo <no-reply@example.com>'} />
        </FormField>
      </div>
      <div className="mt-4 flex items-center gap-2">
        <Button variant="primary" size="sm" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        {actions}
      </div>

      <div className="mt-6 border-t border-line pt-4">
        <p className="mb-2 text-[11px] font-medium text-ink">Send a test email</p>
        <p className="mb-3 text-[11px] text-ink-dim">
          {testNote || (smtp.host ? 'Tests the values above, even if unsaved.' : 'Tests the saved configuration.')}
        </p>
        <div className="flex items-center gap-2">
          <Input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@example.com" className="max-w-xs" />
          <Button variant="subtle" size="sm" onClick={() => onTest(testTo.trim(), smtp)} disabled={testing || !testTo.trim()}>
            {testing ? 'Sending…' : 'Send test email'}
          </Button>
        </div>
      </div>
    </div>
  )
}
