import { useState } from 'react'
import { GitHubIcon, GoogleIcon } from '@/shared/ui/icons'
import { startSignIn, type SignInProvider, type SignInProviderKind } from '../api'
import { Button } from '@/shared/ui/button'

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
        <Button variant="outline" key={p.kind} type="button" size="lg" className="w-full" disabled={leaving} onClick={() => go(p.kind)}>
          {(() => {
            const Icon = PROVIDER_ICONS[p.kind]
            return Icon && <Icon width={15} height={15} />
          })()}
          Continue with {p.label}
        </Button>
      ))}
    </div>
  )
}

/** The line between the provider buttons and a form. */
export function OrDivider({ label }: { label: string }) {
  return (
    <div className="my-5 flex items-center gap-3 text-[10.5px] text-faint">
      <span className="h-px flex-1 bg-border" />
      {label}
      <span className="h-px flex-1 bg-border" />
    </div>
  )
}
