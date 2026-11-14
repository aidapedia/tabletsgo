import { useState, type FormEvent } from 'react'
import { ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { FormField } from '@/shared/ui/form/FormField'
import PasswordInput from '@/shared/ui/form/PasswordInput'
import PersonAvatar from '@/shared/ui/PersonAvatar'
import { changeSoloPassword, soloLogout, updateSoloAccount } from '../api'
import { useAuth, useIdentity } from '../stores/AuthContext'

/**
 * Your account. Enterprise: read-only — it lives in Hayat, shared by every
 * application that signs in there, and this links to Hayat's account page.
 * Solo: the owner's own, edited here.
 */
export default function AccountSetting() {
  const { user, accountUrl } = useAuth()
  const { solo } = useIdentity()
  if (!user) return null
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 rounded-[12px] border border-border p-4">
        <PersonAvatar seed={user.name || user.email} className="!h-10 !w-10" />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold">{user.name || user.email}</div>
          <div className="truncate text-xs text-muted-foreground">{user.email}</div>
        </div>
      </div>
      {solo ? <SoloAccount /> : <HayatAccount accountUrl={accountUrl} />}
    </div>
  )
}

function HayatAccount({ accountUrl }: { accountUrl: string | null }) {
  const { user } = useAuth()
  return (
    <>
      <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-[13px]">
        <dt className="text-muted-foreground">Time zone</dt>
        <dd>{user?.timezone || 'Your browser’s'}</dd>
        <dt className="text-muted-foreground">Instance role</dt>
        <dd>{user?.role === 'admin' ? 'Tabletsgo admin' : 'Member'}</dd>
      </dl>
      <p className="text-xs text-muted-foreground">
        Your name, password, time zone and sign-in methods are managed in your Hayat account, and apply to every app you sign in to with it.
      </p>
      {accountUrl ? (
        <Button asChild variant="outline" size="sm">
          <a href={accountUrl} target="_blank" rel="noreferrer">
            Manage your account <ExternalLink />
          </a>
        </Button>
      ) : (
        <p className="text-xs text-faint">Ask your administrator for the address of the Hayat console.</p>
      )}
    </>
  )
}

// IANA zones the browser knows, for the time zone field's suggestions.
const ZONES: string[] = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone')
  } catch {
    return []
  }
})()

function SoloAccount() {
  const { user, reloadMe, applyTokens, logout } = useAuth()
  const [name, setName] = useState(user?.name ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [timezone, setTimezone] = useState(user?.timezone ?? '')
  const [saving, setSaving] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [changing, setChanging] = useState(false)

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await updateSoloAccount({ name, email, timezone: timezone.trim() || null })
      await reloadMe()
      toast.success('Saved your account.')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const savePassword = async (e: FormEvent) => {
    e.preventDefault()
    setChanging(true)
    try {
      applyTokens(await changeSoloPassword(current, next))
      setCurrent('')
      setNext('')
      toast.success('Changed your password. Other devices are signed out.')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setChanging(false)
    }
  }

  const signOutEverywhere = async () => {
    try {
      await soloLogout(true)
    } finally {
      await logout()
    }
  }

  return (
    <>
      <form onSubmit={saveProfile} className="max-w-[420px]" noValidate>
        <FormField label="Name" htmlFor="account-name">
          <Input id="account-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        </FormField>
        <FormField label="Email" htmlFor="account-email" hint="You sign in with it.">
          <Input id="account-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        </FormField>
        <FormField label="Time zone" htmlFor="account-timezone" hint="Times in the app are shown in it. Leave empty to follow your browser.">
          <Input id="account-timezone" list="account-timezones" placeholder="Asia/Jakarta" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
          <datalist id="account-timezones">
            {ZONES.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
        </FormField>
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </form>

      <form onSubmit={savePassword} className="max-w-[420px] border-t border-border pt-5" noValidate>
        <div className="mb-3 text-[13px] font-semibold">Password</div>
        <FormField label="Current password" htmlFor="account-current">
          <PasswordInput id="account-current" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </FormField>
        <FormField label="New password" htmlFor="account-next" hint="At least 8 characters. Changing it signs out your other devices.">
          <PasswordInput id="account-next" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </FormField>
        <Button type="submit" size="sm" disabled={changing || !current || next.length < 8}>
          {changing ? 'Changing…' : 'Change password'}
        </Button>
      </form>

      <div className="max-w-[420px] border-t border-border pt-5">
        <div className="text-[13px] font-semibold">Sessions</div>
        <p className="mt-1 mb-3 text-xs text-muted-foreground">Sign out of this instance on every browser and device, including this one.</p>
        <Button variant="outline" size="sm" onClick={signOutEverywhere}>
          Sign out everywhere
        </Button>
      </div>
    </>
  )
}
