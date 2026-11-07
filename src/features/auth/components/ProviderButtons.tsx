import { useState } from 'react'
import { GitHubIcon, GoogleIcon } from '@/shared/ui/icons'
import Button from '@/shared/ui/buttons/Button'
import { startSignIn, type SignInProvider, type SignInProviderKind } from '../api'

export const PROVIDER_ICONS: Record<SignInProviderKind, typeof GoogleIcon> = { google: GoogleIcon, github: GitHubIcon }

/** "Continue with …" for each provider that's on. `invite` makes it accept that invite. */
export default function ProviderButtons({
  providers,
  invite,
  onError,
}: {
  providers: SignInProvider[]
  invite?: string
  onError: (message: string) => void
}) {
  const [leaving, setLeaving] = useState(false)

  const go = async (kind: SignInProviderKind) => {
    setLeaving(true)
    try {
      const { url } = await startSignIn(kind, invite)
      window.location.assign(url)
    } catch (err) {
      onError(err.message)
      setLeaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      {providers.map((p) => (
        <Button key={p.kind} type="button" size="lg" className="w-full" icon={PROVIDER_ICONS[p.kind]} disabled={leaving} onClick={() => go(p.kind)}>
          Continue with {p.label}
        </Button>
      ))}
    </div>
  )
}

/** The line between the provider buttons and a form. */
export function OrDivider({ label }: { label: string }) {
  return (
    <div className="my-5 flex items-center gap-3 text-[10.5px] text-ink-faint">
      <span className="h-px flex-1 bg-edge" />
      {label}
      <span className="h-px flex-1 bg-edge" />
    </div>
  )
}
