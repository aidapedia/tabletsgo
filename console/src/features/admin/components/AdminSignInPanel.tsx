import { useEffect, useState } from 'react'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import { toast } from 'sonner'
import PasswordInput from '@/shared/ui/form/PasswordInput'
import { CopyIcon } from '@/shared/ui/icons'
import { PROVIDER_ICONS } from '@/features/auth'
import { getIdentityProviders, saveIdentityProvider, type AdminIdentityProvider } from '../api'
import { Button } from '@/shared/ui/button'
import { Switch } from '@/shared/ui/switch'
import { FormField } from '@/shared/ui/form/FormField'
import { Input } from '@/shared/ui/input'

/**
 * Admin → Authentication: one app per provider, for the whole instance. The secret is
 * write-only, like the SMTP password: leaving it blank keeps the saved one. A card's
 * switch is its only action: turning it on saves what's in the fields, and the fields
 * lock while it's on, so what they show is what people are signing in through.
 */
export default function AdminSignInPanel() {
  const [providers, setProviders] = useState<AdminIdentityProvider[] | null>(null)
  const [callbackUrl, setCallbackUrl] = useState('')

  useEffect(() => {
    getIdentityProviders().then((data) => {
      setProviders(data.providers)
      setCallbackUrl(data.callbackUrl)
    })
  }, [])

  if (!providers) return <LoadingState />

  return (
    <div className="flex flex-col gap-5">
      <FormField label="Callback URL" hint="Paste this into your Google and GitHub app settings.">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted px-2.5 py-2">
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">{callbackUrl}</span>
          <Button variant="link" size="inline" type="button"
            className="text-muted-foreground hover:text-foreground shrink-0"
            aria-label="Copy callback URL"
            onClick={() => {
              navigator.clipboard?.writeText(callbackUrl)
              toast.success('Callback URL copied.')
            }}
          >
            <CopyIcon width={15} height={15} />
          </Button>
        </div>
      </FormField>

      {providers.map((p) => (
        <ProviderCard key={p.kind} provider={p} onChange={setProviders} />
      ))}
    </div>
  )
}

function ProviderCard({ provider, onChange }: { provider: AdminIdentityProvider; onChange: (next: AdminIdentityProvider[]) => void }) {
  const [clientId, setClientId] = useState(provider.clientId)
  const [clientSecret, setClientSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const Icon = PROVIDER_ICONS[provider.kind]
  const on = provider.enabled
  const complete = !!clientId.trim() && (provider.hasSecret || !!clientSecret.trim())

  const toggle = async (next: boolean) => {
    setBusy(true)
    try {
      const body = next ? { clientId, clientSecret: clientSecret || undefined, enabled: true } : { enabled: false }
      const { providers } = await saveIdentityProvider(provider.kind, body)
      onChange(providers)
      setClientSecret('')
      toast.success(`${provider.label} sign-in ${next ? 'enabled' : 'disabled'}.`)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-4 flex items-center gap-2.5">
        <Icon width={18} height={18} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-semibold">{provider.label}</h3>
          <p className="text-[11px] text-faint">
            {provider.linked} {provider.linked === 1 ? 'person' : 'people'} linked
          </p>
        </div>
        <span className="text-[12px] text-muted-foreground">{on ? 'Enabled' : 'Disabled'}</span>
        <Switch checked={on} onCheckedChange={(checked) => toggle(checked === true)} disabled={busy || (!on && !complete)} aria-label={`Enable ${provider.label} sign-in`} />
      </div>

      <FormField label="Client ID">
        <Input value={clientId} onChange={(e) => setClientId(e.target.value)} disabled={on} autoComplete="off" className="disabled:opacity-50" />
      </FormField>
      <FormField label="Client secret" hint={provider.hasSecret && !on ? 'Saved. Leave blank to keep it.' : undefined}>
        <PasswordInput
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          disabled={on}
          autoComplete="new-password"
          placeholder={provider.hasSecret ? '••••••••' : ''}
          className="disabled:opacity-50"
        />
      </FormField>

      <p className="text-[11px] text-faint">
        {on ? 'Disable to change these.' : complete ? 'Enabling saves these.' : 'Enter both to enable.'}
      </p>
    </div>
  )
}
