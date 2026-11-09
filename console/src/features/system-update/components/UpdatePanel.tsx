import { useState } from 'react'
import { RefreshIcon } from '@/shared/ui/icons'
import { MarkdownText } from '@/features/dashboard'
import { useAuth } from '@/features/auth'
import { useUpdate } from '../stores/UpdateContext'
import UpdateWizard from './UpdateWizard'
import { formatTime } from '@/shared/lib/datetime'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { Switch } from '@/shared/ui/switch'

// Settings > Updates: current vs latest, manual re-check, changelog, and the
// entry point into the guided update wizard.
export default function UpdatePanel() {
  const { info, identity, loading, lastChecked, check, autoCheck, setAutoCheck } = useUpdate()
  // Updating is instance-wide, so it's the *system* admin's call — not a
  // workspace owner's. (An admin holds no workspace, so the old workspace-role
  // check would have locked the only person allowed to do it out of it.)
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [wizardOpen, setWizardOpen] = useState(false)

  const upToDate = info && !info.updateAvailable && !info.unreachable
  // The running version is known from /system/version even before (or without)
  // an update check — only fall back to a placeholder while that's in flight.
  const version = info?.current.version ?? identity?.version

  return (
    <div className="max-w-[640px] space-y-5">
      <div className="flex items-center justify-between gap-4 rounded-[12px] border border-border bg-muted px-4 py-3.5">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-foreground">Automatically check for updates</div>
          <div className="mt-1 text-[11px] text-faint">
            Check for a newer release on sign-in. Turn this off if updates are managed elsewhere (e.g. Coolify);
            you can still check manually below.
          </div>
        </div>
        <Switch
          checked={autoCheck}
          onCheckedChange={(checked) => setAutoCheck(checked === true)}
          aria-label="Automatically check for updates"
        />
      </div>

      <div className="flex items-start justify-between gap-4 rounded-[12px] border border-border bg-muted px-4 py-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-foreground">Current version</span>
            <span className="rounded bg-border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
              {version ? `v${version}` : '…'}
            </span>
            {upToDate && <Badge variant="default">Up to date</Badge>}
            {info?.updateAvailable && <Badge variant="warning">Update available</Badge>}
          </div>
          <div className="mt-1 text-[11px] text-faint">
            {loading
              ? 'Checking…'
              : info?.unreachable
                ? 'Could not reach the update server — check your connection.'
                : info?.updateAvailable
                  ? `v${info.latest?.version} is available`
                  : lastChecked
                    ? `Last checked ${formatTime(lastChecked)}`
                    : 'Not checked for updates yet.'}
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => check(true)} disabled={loading}>
          <RefreshIcon width={15} height={15} />
          {loading ? 'Checking…' : 'Check for updates'}
        </Button>
      </div>

      {info?.updateAvailable && (
        <div className="rounded-[12px] border border-primary/30 bg-primary/10 px-4 py-3.5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
                Update to v{info.latest?.version}
                {info.breaking && <Badge variant="destructive">Breaking</Badge>}
                {info.migrations && <Badge variant="warning">Migrations</Badge>}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {isAdmin ? 'Backup, validate and apply in a guided flow.' : 'Only workspace admins can apply updates.'}
              </div>
            </div>
            <Button variant="default" size="sm" onClick={() => setWizardOpen(true)}>
              {isAdmin ? 'Update now' : 'View details'}
            </Button>
          </div>
        </div>
      )}

      {!!info?.releases.length && (
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-faint">Changelog</div>
          <div className="space-y-4">
            {info.releases.map((r) => (
              <div key={r.version} className="rounded-[12px] border border-border bg-sidebar px-4 py-3">
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-[12px] font-bold text-foreground">{r.name || `v${r.version}`}</span>
                  <a href={r.url} target="_blank" rel="noreferrer" className="text-[11px] text-primary underline underline-offset-2">
                    View on GitHub
                  </a>
                </div>
                <MarkdownText text={r.notes || '_No release notes._'} />
              </div>
            ))}
          </div>
        </div>
      )}

      {wizardOpen && <UpdateWizard onClose={() => setWizardOpen(false)} />}
    </div>
  )
}
