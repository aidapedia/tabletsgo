import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import Button from '@/shared/ui/buttons/Button'
import ConfirmDialog from '@/shared/ui/feedback/ConfirmDialog'
import { useToast } from '@/shared/ui/feedback/Toast'
import { getIdentities, startLink, unlinkIdentity, type LinkedIdentity, type SignInProvider, type SignInProviderKind } from '../api'
import { signInErrorMessage } from '../lib/signInErrors'
import { PROVIDER_ICONS } from './ProviderButtons'

type State = { identities: LinkedIdentity[]; hasPassword: boolean; providers: SignInProvider[] }

const LABELS: Record<SignInProviderKind, string> = { google: 'Google', github: 'GitHub' }

/**
 * Google and GitHub accounts linked to the caller's own account. A provider the
 * admin turned off still shows while it's linked, so it can be unlinked.
 */
export default function SignInMethods() {
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const [state, setState] = useState<State | null>(null)
  const [busy, setBusy] = useState(false)
  const [unlinking, setUnlinking] = useState<LinkedIdentity | null>(null)

  const load = () => getIdentities().then(setState)

  useEffect(() => {
    load()
  }, [])

  // The result of a link round trip arrives in the URL; say it once and clear it,
  // so a refresh doesn't repeat it.
  const linked = params.get('linked') as SignInProviderKind | null
  const error = params.get('error')
  useEffect(() => {
    if (!linked && !error) return
    if (linked) toast.success(`${LABELS[linked] || 'Account'} linked.`)
    else toast.error(signInErrorMessage(error))
    setParams({}, { replace: true })
  }, [linked, error])

  const link = async (kind: SignInProviderKind) => {
    setBusy(true)
    try {
      window.location.assign((await startLink(kind)).url)
    } catch (err) {
      toast.error(err.message)
      setBusy(false)
    }
  }

  const confirmUnlink = async () => {
    const identity = unlinking
    setUnlinking(null)
    if (!identity) return
    try {
      await unlinkIdentity(identity.id)
      toast.success(`${LABELS[identity.provider]} unlinked.`)
      load()
    } catch (err) {
      toast.error(err.message)
    }
  }

  if (!state) return null

  const linkedKinds = state.identities.map((i) => i.provider)
  const rows: { kind: SignInProviderKind; identity?: LinkedIdentity }[] = [
    ...state.identities.map((identity) => ({ kind: identity.provider, identity })),
    ...state.providers.filter((p) => !linkedKinds.includes(p.kind)).map((p) => ({ kind: p.kind })),
  ]

  if (!rows.length) return <p className="text-[12px] text-ink-faint">This instance has no Google or GitHub sign-in set up.</p>

  return (
    <div className="flex max-w-[420px] flex-col gap-3">
      <div className="flex flex-col divide-y divide-edge rounded-soft border border-edge">
        {rows.map(({ kind, identity }) => {
          const Icon = PROVIDER_ICONS[kind]
          return (
            <div key={kind} className="flex items-center gap-3 bg-elevated/30 px-3 py-2.5">
              <Icon width={16} height={16} className="shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-semibold">{LABELS[kind]}</div>
                <div className="truncate text-[11px] text-ink-faint">{identity ? identity.email || 'Linked' : 'Not linked'}</div>
              </div>
              {identity ? (
                <Button size="sm" onClick={() => setUnlinking(identity)}>
                  Unlink
                </Button>
              ) : (
                <Button size="sm" variant="primary" disabled={busy} onClick={() => link(kind)}>
                  Link
                </Button>
              )}
            </div>
          )
        })}
      </div>

      {!state.hasPassword && (
        <p className="text-[11px] leading-relaxed text-ink-faint">
          You have no password yet. To add one, sign out and use "Forgot password" on the sign-in page.
        </p>
      )}

      {unlinking && (
        <ConfirmDialog
          title={`Unlink ${LABELS[unlinking.provider]}?`}
          message={`You won't be able to sign in with ${unlinking.email || `this ${LABELS[unlinking.provider]} account`} any more.`}
          confirmLabel="Unlink"
          onConfirm={confirmUnlink}
          onCancel={() => setUnlinking(null)}
        />
      )}
    </div>
  )
}
