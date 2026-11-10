import { useState } from 'react'
import { useAuth } from '@/features/auth'
import { CloseIcon, CloudIcon } from '@/shared/ui/icons'
import { useUpdate } from '../stores/UpdateContext'
import UpdateWizard from './UpdateWizard'
import { Button } from '@/shared/ui/button'

// Non-blocking, dismissible banner shown atop the home shell when a newer
// release exists. "Update" opens the guided wizard; "Dismiss" hides it until a
// newer version ships (remembered per-version).
//
// Instance admins only — updating is an instance-wide call they alone can make,
// which is also why Updates lives under /admin.
export default function UpdateBanner() {
  const { user } = useAuth()
  const { info, dismissed, dismiss } = useUpdate()
  const [wizardOpen, setWizardOpen] = useState(false)

  if (user?.role !== 'admin') return null
  if (!info?.updateAvailable || dismissed) return null

  return (
    <>
      <div className="mb-5 flex items-center gap-3 rounded-[12px] border border-primary/30 bg-primary/10 px-4 py-3">
        <CloudIcon width={18} height={18} className="shrink-0 text-primary-bright" />
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-semibold text-foreground">
            Tabletsgo v{info.latest?.version} is available
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            You're on v{info.current.version}
            {info.breaking && ' · contains breaking changes'}
            {info.migrations && ' · includes migrations'}
          </div>
        </div>
        <Button variant="default" size="sm" onClick={() => setWizardOpen(true)}>
          Update
        </Button>
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="shrink-0 text-faint transition-colors hover:text-foreground"
        >
          <CloseIcon width={15} height={15} />
        </button>
      </div>

      {wizardOpen && <UpdateWizard onClose={() => setWizardOpen(false)} />}
    </>
  )
}
