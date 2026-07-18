import { useState } from 'react'
import Button from '@/shared/ui/buttons/Button'
import { CloseIcon, CloudIcon } from '@/shared/ui/icons'
import { useUpdate } from '../stores/UpdateContext'
import UpdateWizard from './UpdateWizard'

// Non-blocking, dismissible banner shown atop the home shell when a newer
// release exists. "Update" opens the guided wizard; "Dismiss" hides it until a
// newer version ships (remembered per-version).
export default function UpdateBanner() {
  const { info, dismissed, dismiss } = useUpdate()
  const [wizardOpen, setWizardOpen] = useState(false)

  if (!info?.updateAvailable || dismissed) return null

  const shortSha = (s?: string | null) => (s ? s.slice(0, 7) : '')

  return (
    <>
      <div className="mb-5 flex items-center gap-3 rounded-[12px] border border-green/30 bg-green/10 px-4 py-3">
        <CloudIcon width={18} height={18} className="shrink-0 text-green-bright" />
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-semibold text-ink">
            {info.rebuild
              ? `A newer build of Tabletsgo v${info.latest?.version} is available`
              : `Tabletsgo v${info.latest?.version} is available`}
          </div>
          <div className="truncate text-[11px] text-ink-dim">
            {info.rebuild
              ? `You're on ${shortSha(info.current.sha) || `v${info.current.version}`} · rebuild ${shortSha(info.latest?.sha)}`
              : `You're on v${info.current.version}`}
            {info.breaking && ' · contains breaking changes'}
            {info.migrations && ' · includes migrations'}
          </div>
        </div>
        <Button variant="primary" size="sm" onClick={() => setWizardOpen(true)}>
          Update
        </Button>
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="shrink-0 text-ink-faint transition-colors hover:text-ink"
        >
          <CloseIcon width={15} height={15} />
        </button>
      </div>

      {wizardOpen && <UpdateWizard onClose={() => setWizardOpen(false)} />}
    </>
  )
}
