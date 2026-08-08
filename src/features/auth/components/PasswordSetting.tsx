import { useState } from 'react'
import Button from '@/shared/ui/buttons/Button'
import { useToast } from '@/shared/ui/feedback/Toast'
import { FormField } from '@/shared/ui/form/Form'
import PasswordInput from '@/shared/ui/form/PasswordInput'
import { useAuth } from '../stores/AuthContext'
import { changePassword } from '../api'

/**
 * Self-service password change (no section chrome — the page supplies it).
 *
 * The current password is required, and the server re-checks it: a session
 * token alone must not be enough to lock its owner out. A successful change
 * invalidates every session, so the response's fresh token is persisted here —
 * otherwise the very next request would sign this browser out.
 */
export default function PasswordSetting() {
  const { updateAccount } = useAuth()
  const toast = useToast()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)

  // Shown under the confirmation field while the two don't match, so the
  // mismatch is visible before the user submits.
  const mismatch = !!confirm && next !== confirm
  const ready = !!current && !!next && next === confirm

  const submit = async (e) => {
    e.preventDefault()
    if (!ready || saving) return
    setSaving(true)
    try {
      const { user, token } = await changePassword({ currentPassword: current, newPassword: next })
      updateAccount(user, token)
      setCurrent('')
      setNext('')
      setConfirm('')
      toast.success('Password changed. Other devices have been signed out.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="max-w-[420px]">
      <FormField label="Current password" htmlFor="pw-current">
        <PasswordInput
          id="pw-current"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
        />
      </FormField>

      <FormField label="New password" htmlFor="pw-new">
        <PasswordInput id="pw-new" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
      </FormField>

      <FormField
        label="Confirm new password"
        htmlFor="pw-confirm"
        className="!mb-5"
        error={mismatch ? "These passwords don't match." : undefined}
      >
        <PasswordInput
          id="pw-confirm"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
        />
      </FormField>

      <Button type="submit" variant="primary" size="sm" disabled={!ready || saving}>
        {saving ? 'Changing…' : 'Change password'}
      </Button>
      <p className="mt-3 text-[11px] text-ink-faint">
        Changing your password signs you out everywhere else. You'll stay signed in here.
      </p>
    </form>
  )
}
