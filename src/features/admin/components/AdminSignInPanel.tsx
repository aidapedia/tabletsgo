import { useEffect, useState } from 'react'
import Badge from '@/shared/ui/Badge'
import Button from '@/shared/ui/buttons/Button'
import TextButton from '@/shared/ui/buttons/TextButton'
import ConfirmDialog from '@/shared/ui/feedback/ConfirmDialog'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import { useToast } from '@/shared/ui/feedback/Toast'
import { FormField } from '@/shared/ui/form/Form'
import { Input } from '@/shared/ui/form/Input'
import PasswordInput from '@/shared/ui/form/PasswordInput'
import Toggle from '@/shared/ui/form/Toggle'
import { CopyIcon } from '@/shared/ui/icons'
import { PROVIDER_ICONS } from '@/features/auth'
import { clearIdentityProvider, getIdentityProviders, saveIdentityProvider, type AdminIdentityProvider } from '../api'

/**
 * Admin → Sign-in Methods: one app per provider, for the whole instance. The secret is
 * write-only, like the SMTP password: leaving it blank keeps the saved one.
 */
export default function AdminSignInPanel() {
  const toast = useToast()
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
        <div className="flex items-center gap-2 rounded-soft border border-edge bg-elevated px-2.5 py-2">
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-dim">{callbackUrl}</span>
          <TextButton
            className="shrink-0"
            aria-label="Copy callback URL"
            onClick={() => {
              navigator.clipboard?.writeText(callbackUrl)
              toast.success('Callback URL copied.')
            }}
          >
            <CopyIcon width={15} height={15} />
          </TextButton>
        </div>
      </FormField>

      {providers.map((p) => (
        <ProviderCard key={p.kind} provider={p} onChange={setProviders} />
      ))}
    </div>
  )
}

function ProviderCard({ provider, onChange }: { provider: AdminIdentityProvider; onChange: (next: AdminIdentityProvider[]) => void }) {
  const toast = useToast()
  const [clientId, setClientId] = useState(provider.clientId)
  const [clientSecret, setClientSecret] = useState('')
  const [enabled, setEnabled] = useState(provider.enabled)
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const Icon = PROVIDER_ICONS[provider.kind]
  const isSetUp = !!provider.clientId || provider.hasSecret

  const save = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const { providers } = await saveIdentityProvider(provider.kind, { clientId, clientSecret: clientSecret || undefined, enabled })
      onChange(providers)
      setClientSecret('')
      toast.success(`${provider.label} sign-in saved.`)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    setRemoving(false)
    try {
      const { providers } = await clearIdentityProvider(provider.kind)
      onChange(providers)
      setClientId('')
      setClientSecret('')
      setEnabled(false)
      toast.success(`${provider.label} setup removed.`)
    } catch (err) {
      toast.error(err.message)
    }
  }

  return (
    <form onSubmit={save} className="rounded-card border border-edge bg-card p-4">
      <div className="mb-4 flex items-center gap-2.5">
        <Icon width={18} height={18} className="shrink-0" />
        <h3 className="text-[13px] font-semibold">{provider.label}</h3>
        <Badge tone={provider.enabled ? 'green' : 'neutral'}>{provider.enabled ? 'on' : 'off'}</Badge>
        <span className="ml-auto text-[11px] text-ink-faint">
          {provider.linked} {provider.linked === 1 ? 'person' : 'people'} linked
        </span>
      </div>

      <FormField label="Client ID">
        <Input value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" />
      </FormField>
      <FormField label="Client secret" hint={provider.hasSecret ? 'Saved. Leave blank to keep it.' : undefined}>
        <PasswordInput value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} autoComplete="new-password" placeholder={provider.hasSecret ? '••••••••' : ''} />
      </FormField>

      <div className="flex items-center gap-2.5">
        <Toggle checked={enabled} onChange={setEnabled} ariaLabel={`Enable ${provider.label} sign-in`} />
        <span className="text-[12px] text-ink-dim">Enable</span>
        <div className="ml-auto flex items-center gap-2">
          {isSetUp && (
            <Button type="button" size="sm" variant="subtle" onClick={() => setRemoving(true)}>
              Remove
            </Button>
          )}
          <Button type="submit" size="sm" variant="primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>

      {removing && (
        <ConfirmDialog
          title={`Remove the ${provider.label} setup?`}
          message={`People can't sign in with ${provider.label} until it's set up again. ${provider.linked} linked ${
            provider.linked === 1 ? 'account stays' : 'accounts stay'
          } linked, so they work again when it is.`}
          confirmLabel="Remove"
          danger
          onConfirm={remove}
          onCancel={() => setRemoving(false)}
        />
      )}
    </form>
  )
}
