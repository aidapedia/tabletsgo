import { useEffect, useState } from 'react'
import Avatar from '@/shared/ui/Avatar'
import Button from '@/shared/ui/buttons/Button'
import { useToast } from '@/shared/ui/feedback/Toast'
import { FormField } from '@/shared/ui/form/Form'
import { Input } from '@/shared/ui/form/Input'
import { useAuth } from '../stores/AuthContext'
import { updateProfile } from '../api'

/**
 * The signed-in user's own profile (no section chrome — the page supplies it).
 *
 * Name is the only editable field: the email is the sign-in identity, and the
 * system role is an instance-admin decision, so both are shown read-only here
 * and changed from Administration → Users.
 */
export default function ProfileSetting() {
  const { user, updateAccount } = useAuth()
  const toast = useToast()
  const [name, setName] = useState(user?.name || '')
  const [saving, setSaving] = useState(false)

  // Re-sync if the cached account changes underneath us (e.g. a password
  // change refreshes it, or another tab signs in as someone else).
  useEffect(() => setName(user?.name || ''), [user?.id, user?.name])

  if (!user) return null

  const trimmed = name.trim()
  const dirty = !!trimmed && trimmed !== user.name

  const save = async (e) => {
    e.preventDefault()
    if (!dirty || saving) return
    setSaving(true)
    try {
      const { user: updated } = await updateProfile({ name: trimmed })
      updateAccount(updated)
      toast.success('Profile updated.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="max-w-[420px]">
      <div className="mb-5 flex items-center gap-3">
        <Avatar label={user.name || user.email} size="md" className="!h-11 !w-11 !text-[15px]" />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold">{user.name}</div>
          <div className="truncate text-[11px] text-ink-dim">
            {user.role === 'admin' ? 'Instance admin' : 'Member'}
          </div>
        </div>
      </div>

      <FormField label="Name" htmlFor="profile-name">
        <Input
          id="profile-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          autoComplete="name"
        />
      </FormField>

      <FormField
        label="Email"
        htmlFor="profile-email"
        className="!mb-5"
        hint="Your email is how you sign in and can't be changed here — ask an instance admin."
      >
        <Input id="profile-email" value={user.email} readOnly disabled className="cursor-not-allowed opacity-60" />
      </FormField>

      <Button type="submit" variant="primary" size="sm" disabled={!dirty || saving}>
        {saving ? 'Saving…' : 'Save changes'}
      </Button>
    </form>
  )
}
