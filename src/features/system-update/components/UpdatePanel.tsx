import { useState } from 'react'
import Button from '@/shared/ui/buttons/Button'
import Badge from '@/shared/ui/Badge'
import { RefreshIcon } from '@/shared/ui/icons'
import { MarkdownText } from '@/features/dashboard'
import { useWorkspaces } from '@/features/workspaces'
import { useUpdate } from '../stores/UpdateContext'
import UpdateWizard from './UpdateWizard'

// Settings > Updates: current vs latest, manual re-check, changelog, and the
// entry point into the guided update wizard.
export default function UpdatePanel() {
  const { info, loading, lastChecked, check } = useUpdate()
  const { current } = useWorkspaces()
  const isAdmin = current?.role === 'admin'
  const [wizardOpen, setWizardOpen] = useState(false)

  const upToDate = info && !info.updateAvailable && !info.unreachable
  const shortSha = (s?: string | null) => (s ? s.slice(0, 7) : '')

  return (
    <div className="max-w-[640px] space-y-5">
      <div className="flex items-start justify-between gap-4 rounded-[12px] border border-edge bg-elevated px-4 py-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-ink">Current version</span>
            <span className="rounded bg-edge px-1.5 py-0.5 font-mono text-[11px] text-ink-dim">
              v{info?.current.version ?? '…'}
            </span>
            {upToDate && <Badge tone="green">Up to date</Badge>}
            {info?.updateAvailable && (
              <Badge tone="amber">{info.rebuild ? 'Rebuild available' : 'Update available'}</Badge>
            )}
          </div>
          <div className="mt-1 text-[11px] text-ink-faint">
            {info?.unreachable
              ? 'Could not reach the update server — check your connection.'
              : info?.updateAvailable
                ? info.rebuild
                  ? `A newer build of v${info.latest?.version} is available (${shortSha(info.latest?.sha)})`
                  : `v${info.latest?.version} is available`
                : lastChecked
                  ? `Last checked ${new Date(lastChecked).toLocaleTimeString()}`
                  : 'Checking…'}
          </div>
        </div>
        <Button variant="ghost" size="sm" icon={RefreshIcon} onClick={() => check(true)} disabled={loading}>
          {loading ? 'Checking…' : 'Check for updates'}
        </Button>
      </div>

      {info?.updateAvailable && (
        <div className="rounded-[12px] border border-green/30 bg-green/10 px-4 py-3.5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                {info.rebuild ? `Rebuild v${info.latest?.version}` : `Update to v${info.latest?.version}`}
                {info.breaking && <Badge tone="red">Breaking</Badge>}
                {info.migrations && <Badge tone="amber">Migrations</Badge>}
              </div>
              <div className="text-[11px] text-ink-dim">
                {isAdmin ? 'Backup, validate and apply in a guided flow.' : 'Only workspace admins can apply updates.'}
              </div>
            </div>
            <Button variant="primary" size="sm" onClick={() => setWizardOpen(true)}>
              {isAdmin ? 'Update now' : 'View details'}
            </Button>
          </div>
        </div>
      )}

      {!!info?.releases.length && (
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Changelog</div>
          <div className="space-y-4">
            {info.releases.map((r) => (
              <div key={r.version} className="rounded-[12px] border border-edge bg-panel px-4 py-3">
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-[12px] font-bold text-ink">{r.name || `v${r.version}`}</span>
                  <a href={r.url} target="_blank" rel="noreferrer" className="text-[11px] text-green underline underline-offset-2">
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
