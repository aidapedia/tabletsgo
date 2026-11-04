import { useMemo, useState } from 'react'
import { useToast } from '@/shared/ui/feedback/Toast'
import { controlClass } from '@/shared/ui/form/Input'
import Select from '@/shared/ui/form/Select'
import { listTimeZones, timeZoneOffset } from '@/shared/lib/datetime'
import { useAuth } from '../stores/AuthContext'
import { updateProfile } from '../api'

/**
 * The zone every time in the app is shown in. Saved the moment it's picked, like
 * the theme and density beside it. It lives on the account, so it follows the
 * person to other devices; those two stay on this browser.
 */
export default function TimeZoneSetting() {
  const { user, updateAccount } = useAuth()
  const toast = useToast()
  const [saving, setSaving] = useState(false)

  // Built once: the list is a few hundred zones, each needing its own formatter.
  const options = useMemo(
    () => [
      { value: '', label: `Automatic (${Intl.DateTimeFormat().resolvedOptions().timeZone})`, hint: 'Follows this device' },
      ...listTimeZones().map((zone) => ({
        value: zone,
        label: zone.replace(/_/g, ' '),
        hint: timeZoneOffset(zone),
        keywords: zone,
      })),
    ],
    []
  )

  const change = async (zone: string) => {
    if (saving || zone === (user?.timezone || '')) return
    setSaving(true)
    try {
      const { user: updated } = await updateProfile({ timezone: zone || null })
      updateAccount(updated)
      toast.success('Time zone updated.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-[420px]">
      <Select
        className={controlClass}
        value={user?.timezone || ''}
        disabled={saving}
        searchable
        searchPlaceholder="City or region…"
        options={options}
        onChange={change}
      />
      <p className="mt-1.5 text-[11px] text-ink-faint">Values stored in your databases are always shown exactly as stored.</p>
    </div>
  )
}
