import { useEffect, useState } from 'react'
import Button from '@/shared/ui/buttons/Button'
import Checkbox from '@/shared/ui/form/Checkbox'
import { Input } from '@/shared/ui/form/Input'
import { FormField } from '@/shared/ui/form/Form'
import { useToast } from '@/shared/ui/feedback/Toast'
import { useAuth } from '@/features/auth'
import { getWorkspace, updateWorkspace, testSmtp } from '@/features/workspaces/api'

type EnvDefaults = { host: string; port: string; secure: boolean; user: string; from: string }

// SMTP config for sending member-invite emails. Stored per workspace; Docker
// env (SMTP_*) acts as a fallback. Password is write-only (blank = unchanged).
export default function SmtpSettings({ workspaceId }: { workspaceId: string }) {
  const toast = useToast()
  const { user } = useAuth()
  const [smtp, setSmtp] = useState({ host: '', port: '', secure: false, user: '', from: '', pass: '' })
  const [hasPassword, setHasPassword] = useState(false)
  const [envDefaults, setEnvDefaults] = useState<EnvDefaults | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testTo, setTestTo] = useState('')
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    getWorkspace(workspaceId).then((w) => {
      const s = w.smtp || {}
      setSmtp({ host: s.host || '', port: s.port ? String(s.port) : '', secure: !!s.secure, user: s.user || '', from: s.from || '', pass: '' })
      setHasPassword(!!s.hasPassword)
      setEnvDefaults(w.smtpEnvFallback ? w.smtpEnvDefaults : null)
      setLoading(false)
    })
  }, [workspaceId])

  useEffect(() => {
    if (user?.email) setTestTo(user.email)
  }, [user?.email])

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

  const sendTest = async () => {
    if (!testTo.trim()) return
    setTesting(true)
    try {
      // Test whatever is currently on the form (even if unsaved); the server
      // falls back to the saved/env config for any field left blank.
      const overrides: any = smtp.host
        ? { host: smtp.host, port: smtp.port ? Number(smtp.port) : undefined, secure: smtp.secure, user: smtp.user, from: smtp.from, pass: smtp.pass || undefined }
        : undefined
      await testSmtp(workspaceId, { to: testTo.trim(), smtp: overrides })
      toast.success(`Test email sent to ${testTo.trim()}.`)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setTesting(false)
    }
  }

  if (loading) return <div className="text-xs text-ink-faint">Loading…</div>

  return (
    <div>
      <p className="mb-3 text-[11px] text-ink-dim">
        Used to email member invites.{' '}
        {envDefaults
          ? `A Docker env SMTP server is configured as a fallback (${envDefaults.host}${envDefaults.port ? `:${envDefaults.port}` : ''}). `
          : ''}
        Leave empty to rely on env or to send invite links manually.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Host">
          <Input value={smtp.host} onChange={set('host')} placeholder={envDefaults?.host || 'smtp.example.com'} />
        </FormField>
        <FormField label="Port">
          <Input type="number" value={smtp.port} onChange={set('port')} placeholder={envDefaults?.port || '587'} />
        </FormField>
        <FormField label="Username">
          <Input value={smtp.user} onChange={set('user')} placeholder={envDefaults?.user || 'apikey / user'} />
        </FormField>
        <FormField label="Password">
          <Input type="password" value={smtp.pass} onChange={set('pass')} placeholder={hasPassword ? '•••••••• (unchanged)' : envDefaults ? '(from env)' : ''} />
        </FormField>
        <FormField label="From address" className="col-span-2">
          <Input value={smtp.from} onChange={set('from')} placeholder={envDefaults?.from || 'Tabletsgo <no-reply@example.com>'} />
        </FormField>
      </div>
      <div className="mt-3 flex items-center gap-2 text-[11px] text-ink-dim">
        <Checkbox checked={smtp.secure} onChange={(v) => setSmtp((s) => ({ ...s, secure: v }))} ariaLabel="Use implicit TLS" />
        Use implicit TLS (port 465)
      </div>
      <Button variant="primary" size="sm" className="mt-4" onClick={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save SMTP settings'}
      </Button>

      <div className="mt-6 border-t border-line pt-4">
        <p className="mb-2 text-[11px] font-medium text-ink">Send a test email</p>
        <p className="mb-3 text-[11px] text-ink-dim">
          {smtp.host ? 'Tests the values above, even if unsaved.' : 'Tests the saved/env configuration.'}
        </p>
        <div className="flex items-center gap-2">
          <Input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@example.com" className="max-w-xs" />
          <Button variant="subtle" size="sm" onClick={sendTest} disabled={testing || !testTo.trim()}>
            {testing ? 'Sending…' : 'Send test email'}
          </Button>
        </div>
      </div>
    </div>
  )
}
