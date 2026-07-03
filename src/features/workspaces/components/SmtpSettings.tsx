import { useEffect, useState } from 'react'
import Button from '@/shared/ui/Button'
import Checkbox from '@/shared/ui/Checkbox'
import { Input } from '@/shared/ui/Input'
import { FormField } from '@/shared/ui/Form'
import { useToast } from '@/shared/ui/Toast'
import { getWorkspace, updateWorkspace } from '@/features/workspaces/api'

// SMTP config for sending member-invite emails. Stored per workspace; Docker
// env (SMTP_*) acts as a fallback. Password is write-only (blank = unchanged).
export default function SmtpSettings({ workspaceId }: { workspaceId: string }) {
  const toast = useToast()
  const [smtp, setSmtp] = useState({ host: '', port: '', secure: false, user: '', from: '', pass: '' })
  const [hasPassword, setHasPassword] = useState(false)
  const [envFallback, setEnvFallback] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getWorkspace(workspaceId).then((w) => {
      const s = w.smtp || {}
      setSmtp({ host: s.host || '', port: s.port ? String(s.port) : '', secure: !!s.secure, user: s.user || '', from: s.from || '', pass: '' })
      setHasPassword(!!s.hasPassword)
      setEnvFallback(!!w.smtpEnvFallback)
      setLoading(false)
    })
  }, [workspaceId])

  const set = (k) => (e) => setSmtp((s) => ({ ...s, [k]: e.target.value }))

  const save = async () => {
    setSaving(true)
    try {
      const payload: any = { host: smtp.host, port: smtp.port ? Number(smtp.port) : undefined, secure: smtp.secure, user: smtp.user, from: smtp.from }
      if (smtp.pass) payload.pass = smtp.pass // omit → keep the stored password
      await updateWorkspace(workspaceId, { smtp: payload })
      if (smtp.pass) setHasPassword(true)
      setSmtp((s) => ({ ...s, pass: '' }))
      toast.success('SMTP settings saved.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="text-xs text-ink-faint">Loading…</div>

  return (
    <div>
      <p className="mb-3 text-[11px] text-ink-dim">
        Used to email member invites. {envFallback ? 'A Docker env SMTP server is configured as a fallback. ' : ''}
        Leave empty to rely on env or to send invite links manually.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Host">
          <Input value={smtp.host} onChange={set('host')} placeholder="smtp.example.com" />
        </FormField>
        <FormField label="Port">
          <Input type="number" value={smtp.port} onChange={set('port')} placeholder="587" />
        </FormField>
        <FormField label="Username">
          <Input value={smtp.user} onChange={set('user')} placeholder="apikey / user" />
        </FormField>
        <FormField label="Password">
          <Input type="password" value={smtp.pass} onChange={set('pass')} placeholder={hasPassword ? '•••••••• (unchanged)' : ''} />
        </FormField>
        <FormField label="From address" className="col-span-2">
          <Input value={smtp.from} onChange={set('from')} placeholder="Tabletsgo <no-reply@example.com>" />
        </FormField>
      </div>
      <div className="mt-3 flex items-center gap-2 text-[11px] text-ink-dim">
        <Checkbox checked={smtp.secure} onChange={(v) => setSmtp((s) => ({ ...s, secure: v }))} ariaLabel="Use implicit TLS" />
        Use implicit TLS (port 465)
      </div>
      <Button variant="primary" size="sm" className="mt-4" onClick={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save SMTP settings'}
      </Button>
    </div>
  )
}
