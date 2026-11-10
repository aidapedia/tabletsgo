import { useEffect, useState } from 'react'
import PersonAvatar from '@/shared/ui/PersonAvatar'
import { toast } from 'sonner'
import { useAuth } from '../stores/AuthContext'
import { updateProfile } from '../api'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form/FormField'
import { Input } from '@/shared/ui/input'

/**
 * The signed-in user's own profile (no section chrome — the page supplies it).
 *
 * Name is the only editable field: the email is the sign-in identity, and the
 * system role is an instance-admin decision, so both are shown read-only here
 * and changed from Administration → Users.
 */
export default function ProfileSetting() {
  const { user, updateAccount } = useAuth()
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
        <PersonAvatar seed={user.name || user.email} className="!h-11 !w-11" />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold">{user.name}</div>
          <div className="truncate text-[11px] text-muted-foreground">
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

      <Button type="submit" variant="default" size="sm" disabled={!dirty || saving}>
        {saving ? 'Saving…' : 'Save changes'}
      </Button>
    </form>
  )
}
