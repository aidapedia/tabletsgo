import { useEffect, useState } from 'react'
import SmtpForm from './SmtpForm'
import type { SmtpValue } from './SmtpForm'
import Button from '@/shared/ui/buttons/Button'
import ConfirmDialog from '@/shared/ui/feedback/ConfirmDialog'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import { useToast } from '@/shared/ui/feedback/Toast'
import { useAuth } from '@/features/auth'
import { clearGlobalSmtp, getGlobalSmtp, testGlobalSmtp, updateGlobalSmtp } from '../api'
import type { GlobalSmtpInfo } from '../api'

/**
 * Admin → Email: the instance's mail server.
 *
 * There is exactly one, and this is the only place it can be set — invites,
 * password resets and notifications all send through it, for every workspace.
 * The SMTP_* env vars still apply underneath, so an instance configured through
 * docker-compose keeps sending mail: the form pre-fills from them, and saving
 * takes over (without a redeploy).
 */
export default function AdminSmtpPanel() {
  const toast = useToast()
  const { user } = useAuth()
  const [info, setInfo] = useState<GlobalSmtpInfo | null>(null)
  const [initial, setInitial] = useState<SmtpValue | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)

  const load = (data: GlobalSmtpInfo) => {
    setInfo(data)
    const s = data.smtp
    const env = data.env
    // Seed from the env layer when nothing is saved yet — the form then shows
    // what's actually sending mail rather than an empty shell.
    setInitial({
      host: s.host || env?.host || '',
      port: s.port ? String(s.port) : env?.port ? String(env.port) : '',
      secure: s.host ? !!s.secure : !!env?.secure,
      user: s.user || env?.user || '',
      from: s.from || env?.from || '',
      pass: '',
    })
  }

  useEffect(() => {
    getGlobalSmtp().then(load)
  }, [])

  const save = async (smtp: SmtpValue) => {
    setSaving(true)
    try {
      const { smtp: saved } = await updateGlobalSmtp({
        host: smtp.host,
        port: smtp.port ? Number(smtp.port) : undefined,
        secure: smtp.secure,
        user: smtp.user,
        from: smtp.from,
        ...(smtp.pass ? { pass: smtp.pass } : {}), // omit → keep the stored password
      })
      setInfo((i) => (i ? { ...i, smtp: saved } : i))
      // Saving a new host changes the form's key (below) and remounts it, so
      // the seed has to move with it — otherwise the fields would snap back to
      // whatever was loaded on mount.
      setInitial({ ...smtp, pass: '' })
      toast.success(smtp.host ? 'Global SMTP settings saved.' : 'Global SMTP host cleared.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const sendTest = async (to: string, smtp: SmtpValue) => {
    if (!to) return
    setTesting(true)
    try {
      const overrides: any = smtp.host
        ? { host: smtp.host, port: smtp.port ? Number(smtp.port) : undefined, secure: smtp.secure, user: smtp.user, from: smtp.from, pass: smtp.pass || undefined }
        : undefined
      await testGlobalSmtp({ to, smtp: overrides })
      toast.success(`Test email sent to ${to}.`)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setTesting(false)
    }
  }

  const removeConfig = async () => {
    setConfirmClear(false)
    try {
      await clearGlobalSmtp()
      const fresh = await getGlobalSmtp()
      load(fresh)
      toast.success(fresh.env ? 'Removed — the instance falls back to its SMTP_* env vars.' : 'Global SMTP settings removed.')
    } catch (err) {
      toast.error(err.message)
    }
  }

  if (!initial || !info) return <LoadingState className="" />

  const configured = !!info.smtp.host

  return (
    <>
      <SmtpForm
        // Remount on a reset so the fields re-seed from the reloaded config.
        key={`${configured}-${info.smtp.host}`}
        initial={initial}
        hasPassword={info.smtp.hasPassword}
        placeholders={info.env}
        defaultTestTo={user?.email || ''}
        saving={saving}
        testing={testing}
        onSave={save}
        onTest={sendTest}
        note={
          <>
            Sends member invites, password resets and notifications for every workspace on this instance.{' '}
            {info.env
              ? `The SMTP_* environment variables (${info.env.host}${info.env.port ? `:${info.env.port}` : ''}) are pre-filled below — saving stores them here, where they can be changed without a redeploy.`
              : 'Leave the host empty to send no email at all — invite links can still be copied by hand.'}
          </>
        }
        actions={
          configured ? (
            <Button variant="subtle" size="sm" onClick={() => setConfirmClear(true)}>
              Remove
            </Button>
          ) : null
        }
      />

      {confirmClear && (
        <ConfirmDialog
          title="Remove global SMTP settings?"
          message={
            info.env
              ? 'The instance falls back to the SMTP_* environment variables.'
              : 'No email will be sent until a mail server is configured again — invites can still be shared as copyable links.'
          }
          confirmLabel="Remove"
          danger
          onConfirm={removeConfig}
          onCancel={() => setConfirmClear(false)}
        />
      )}
    </>
  )
}
