import { useEffect, useState } from 'react'
import Wizard from '@/shared/ui/feedback/Wizard'
import Button from '@/shared/ui/buttons/Button'
import Badge from '@/shared/ui/Badge'
import { useToast } from '@/shared/ui/feedback/Toast'
import { CheckIcon, DownloadIcon, RefreshIcon } from '@/shared/ui/icons'
import { MarkdownText } from '@/features/dashboard'
import { useAuth } from '@/features/auth'
import { useUpdate } from '../stores/UpdateContext'
import { applyUpdate, downloadBackup, pollUntilVersion, runBackup, runPreflight } from '../lib/api'
import type { ApplyResult, BackupResult, PreflightCheck, PreflightStatus } from '../lib/types'

const STEPS = [
  { id: 'review', title: 'Review' },
  { id: 'backup', title: 'Backup' },
  { id: 'preflight', title: 'Pre-flight' },
  { id: 'apply', title: 'Apply' },
  { id: 'verify', title: 'Verify' },
]

const STATUS_TONE: Record<PreflightStatus, 'green' | 'amber' | 'red'> = { pass: 'green', warn: 'amber', fail: 'red' }

// Guided update flow. Owns the step machine and all async work; renders inside
// the generic <Wizard/> shell. Only instance admins can run mutating steps.
export default function UpdateWizard({ onClose }: { onClose: () => void }) {
  const { info } = useUpdate()
  const toast = useToast()
  // Updating is instance-wide, so it's the *system* admin's call — not a
  // workspace owner's. (An admin holds no workspace, so the old workspace-role
  // check would have locked the only person allowed to do it out of it.)
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [backup, setBackup] = useState<BackupResult | null>(null)
  const [checks, setChecks] = useState<PreflightCheck[] | null>(null)
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null)
  const [verify, setVerify] = useState<'polling' | 'done' | 'timeout'>('polling')
  const [verifyNonce, setVerifyNonce] = useState(0)
  const [preflightNonce, setPreflightNonce] = useState(0)

  const latestVersion = info?.latest?.version || ''
  const upgradeBlocked = !!info?.upgradeBlocked

  const doBackup = async () => {
    setBusy(true)
    try {
      setBackup(await runBackup())
      toast?.success('Snapshot created')
    } catch (e: any) {
      toast?.error(e?.message || 'Backup failed')
    } finally {
      setBusy(false)
    }
  }

  const doApply = async () => {
    setBusy(true)
    try {
      const r = await applyUpdate(latestVersion)
      setApplyResult(r)
      // docker self-update kicks off a real restart → go verify. manual stays so
      // the admin can copy the command first.
      if (r.ok && r.method !== 'manual') setStep(4)
    } catch (e: any) {
      toast?.error(e?.message || 'Failed to trigger update')
    } finally {
      setBusy(false)
    }
  }

  // Snapshot is always taken automatically on entering the Backup step — every
  // update is protected by a rollback point, no manual click required.
  useEffect(() => {
    // Guarded one-shot per step entry — the backup/busy checks keep it from
    // re-firing even though doBackup is recreated each render.
    if (step !== 1 || backup || busy || !isAdmin) return
    doBackup()
  }, [step, backup, busy, isAdmin])

  // Auto-run pre-flight when entering that step (idempotent read).
  useEffect(() => {
    if (step !== 2) return
    let cancelled = false
    setChecks(null)
    runPreflight().then((c) => !cancelled && setChecks(c))
    return () => {
      cancelled = true
    }
  }, [step, preflightNonce])

  // Poll for the new container once on the Verify step.
  useEffect(() => {
    if (step !== 4 || !latestVersion) return
    let cancelled = false
    setVerify('polling')
    pollUntilVersion(latestVersion).then((ok) => !cancelled && setVerify(ok ? 'done' : 'timeout'))
    return () => {
      cancelled = true
    }
  }, [step, latestVersion, verifyNonce])

  if (!info) return null

  const hasFail = (checks || []).some((c) => c.status === 'fail')

  // Footer wiring per step.
  let onNext: (() => void) | undefined
  let nextLabel = 'Next'
  let nextDisabled = false
  const onBack = step > 0 && step < 4 ? () => setStep((s) => s - 1) : undefined

  if (step === 0) {
    onNext = isAdmin ? () => setStep(1) : undefined
    nextLabel = 'Start update'
    nextDisabled = upgradeBlocked
  } else if (step === 1) {
    onNext = () => setStep(2)
    nextLabel = busy ? 'Creating snapshot…' : 'Continue'
    // Snapshot is mandatory — can't proceed until it's captured.
    nextDisabled = !backup || busy
  } else if (step === 2) {
    onNext = () => setStep(3)
    nextDisabled = !checks || hasFail
  } else if (step === 3) {
    if (applyResult && applyResult.method === 'manual') {
      onNext = () => setStep(4)
      nextLabel = 'I ran it — verify'
    } else {
      onNext = doApply
      nextLabel = 'Apply update'
    }
  } else if (step === 4) {
    if (verify === 'done') {
      onNext = () => window.location.reload()
      nextLabel = 'Reload now'
    }
  }

  return (
    <Wizard
      title="Update Tabletsgo"
      steps={STEPS}
      activeIndex={step}
      onClose={onClose}
      onBack={onBack}
      onNext={onNext}
      nextLabel={nextLabel}
      nextDisabled={nextDisabled}
      busy={busy}
      hideCancel={step === 4 && verify === 'done'}
    >
      {step === 0 && (
        <ReviewStep info={info} isAdmin={isAdmin} />
      )}

      {step === 1 && <BackupStep backup={backup} busy={busy} onRetry={doBackup} />}

      {step === 2 && <PreflightStep checks={checks} onRerun={() => setPreflightNonce((n) => n + 1)} />}

      {step === 3 && <ApplyStep info={info} applyResult={applyResult} />}

      {step === 4 && (
        <VerifyStep version={latestVersion} state={verify} onRetry={() => setVerifyNonce((n) => n + 1)} />
      )}
    </Wizard>
  )
}

// ---- Steps ----

function ReviewStep({ info, isAdmin }: { info: NonNullable<ReturnType<typeof useUpdate>['info']>; isAdmin: boolean }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-[13px]">
        <span className="rounded bg-edge px-2 py-1 font-mono text-ink-dim">v{info.current.version}</span>
        <span className="text-ink-faint">→</span>
        <span className="rounded bg-green/15 px-2 py-1 font-mono font-semibold text-green-bright">v{info.latest?.version}</span>
        <div className="ml-1 flex gap-1">
          {info.breaking && <Badge tone="red">Breaking</Badge>}
          {info.migrations && <Badge tone="amber">Migrations</Badge>}
        </div>
      </div>

      {info.upgradeBlocked && (
        <div className="rounded-[10px] border border-red/30 bg-red/10 px-3 py-2 text-[11px] text-red">
          This version requires upgrading from v{info.minUpgradeFrom} or newer first. Update to an
          intermediate version before jumping to v{info.latest?.version}.
        </div>
      )}

      {!isAdmin && (
        <div className="rounded-[10px] border border-edge bg-elevated px-3 py-2 text-[11px] text-ink-dim">
          Only workspace admins can apply updates. You can review what's new below.
        </div>
      )}

      <div>
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">What's new</div>
        {info.releases.length ? (
          <div className="space-y-4">
            {info.releases.map((r) => (
              <div key={r.version}>
                <div className="mb-1 text-[12px] font-bold text-ink">{r.name || `v${r.version}`}</div>
                <MarkdownText text={r.notes || '_No release notes._'} />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[12px] text-ink-dim">No changelog available.</p>
        )}
      </div>
    </div>
  )
}

function BackupStep({
  backup,
  busy,
  onRetry,
}: {
  backup: BackupResult | null
  busy: boolean
  onRetry: () => void
}) {
  return (
    <div className="space-y-4">
      <p className="text-[12px] leading-relaxed text-ink-dim">
        A snapshot of the app's metadata database (users, workspaces, connections, dashboards, saved
        queries) is created automatically before every update, so you can always roll back if the
        new version misbehaves. Your connected databases are not affected by an app update.
      </p>

      {backup ? (
        <div className="flex items-center gap-3 rounded-[10px] border border-green/30 bg-green/10 px-3 py-2.5">
          <CheckIcon width={16} height={16} className="shrink-0 text-green-bright" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-[11px] text-ink">{backup.file}</div>
            <div className="text-[10px] text-ink-faint">{Math.max(1, Math.round(backup.sizeBytes / 1024))} KB</div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            icon={DownloadIcon}
            onClick={() => downloadBackup(backup.file).catch(() => {})}
          >
            Download
          </Button>
        </div>
      ) : busy ? (
        <div className="flex items-center gap-2 text-[12px] text-ink-dim">
          <RefreshIcon width={16} height={16} className="animate-spin text-green-bright" />
          Creating snapshot…
        </div>
      ) : (
        <Button variant="primary" size="sm" onClick={onRetry}>
          Retry snapshot
        </Button>
      )}
    </div>
  )
}

function PreflightStep({ checks, onRerun }: { checks: PreflightCheck[] | null; onRerun: () => void }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Pre-flight checks</div>
        <Button variant="subtle" size="sm" icon={RefreshIcon} onClick={onRerun} disabled={!checks}>
          Re-run
        </Button>
      </div>
      {!checks ? (
        <p className="text-[12px] text-ink-dim">Running checks…</p>
      ) : (
        <div className="space-y-2">
          {checks.map((c) => (
            <div key={c.id} className="flex items-start gap-2.5 rounded-[10px] border border-edge bg-elevated px-3 py-2.5">
              <Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge>
              <div className="min-w-0">
                <div className="text-[12px] font-medium text-ink">{c.label}</div>
                <div className="text-[11px] text-ink-dim">{c.detail}</div>
              </div>
            </div>
          ))}
          {checks.some((c) => c.status === 'fail') && (
            <p className="text-[11px] text-red">Resolve the failing check(s) before continuing.</p>
          )}
        </div>
      )}
    </div>
  )
}

function ApplyStep({
  info,
  applyResult,
}: {
  info: NonNullable<ReturnType<typeof useUpdate>['info']>
  applyResult: ApplyResult | null
}) {
  const toast = useToast()
  const command = applyResult?.command || 'docker compose pull && docker compose up -d'

  if (applyResult && applyResult.method === 'manual') {
    return (
      <div className="space-y-3">
        <p className="text-[12px] leading-relaxed text-ink-dim">
          No automatic updater is configured. Run this on the host to pull v{info.latest?.version} and
          recreate the container, then continue to verify:
        </p>
        <div className="flex items-center gap-2 rounded-[10px] border border-edge bg-elevated px-3 py-2.5">
          <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[11px] text-ink">{command}</code>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              navigator.clipboard?.writeText(command)
              toast?.info('Copied')
            }}
          >
            Copy
          </Button>
        </div>
      </div>
    )
  }

  const applyBlurb =
    info.applyMethod === 'docker'
      ? ' Tabletsgo will pull the new image and recreate its own container via the Docker socket, then come back up automatically.'
      : ' The Docker socket isn’t mounted — you’ll get the manual command to run.'

  return (
    <div className="space-y-3">
      <p className="text-[12px] leading-relaxed text-ink-dim">
        Ready to update to <span className="font-semibold text-ink">v{info.latest?.version}</span>.
        {applyBlurb}
      </p>
      <div className="rounded-[10px] border border-edge bg-elevated px-3 py-2 font-mono text-[11px] text-ink-dim">
        {info.image}
      </div>
    </div>
  )
}

function VerifyStep({
  version,
  state,
  onRetry,
}: {
  version: string
  state: 'polling' | 'done' | 'timeout'
  onRetry: () => void
}) {
  if (state === 'done') {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green/15">
          <CheckIcon width={24} height={24} className="text-green-bright" />
        </div>
        <div className="text-[13px] font-semibold text-ink">Updated to v{version}</div>
        <p className="text-[12px] text-ink-dim">Reload to load the new version.</p>
      </div>
    )
  }
  if (state === 'timeout') {
    return (
      <div className="space-y-3 py-4 text-center">
        <p className="text-[12px] text-ink-dim">
          Still waiting for v{version} to come online. The restart may take a little longer, or the
          updater may need attention.
        </p>
        <Button variant="ghost" size="sm" icon={RefreshIcon} onClick={onRetry}>
          Keep waiting
        </Button>
      </div>
    )
  }
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <RefreshIcon width={22} height={22} className="animate-spin text-green-bright" />
      <div className="text-[12px] text-ink-dim">Waiting for v{version} to come online…</div>
    </div>
  )
}
