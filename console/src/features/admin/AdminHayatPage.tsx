import { useCallback, useEffect, useState } from 'react'
import { getHayatStatus, type HayatStatus } from '@/features/admin'
import { HayatEnrollment } from '@/features/auth'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import { formatDateTime } from '@/shared/lib/datetime'
import Narrow from '@/shared/ui/page/Narrow'
import { Section } from '@/shared/ui/page/Section'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate">{children || <span className="text-faint">—</span>}</dd>
    </>
  )
}

/**
 * `/admin/hayat` — how this instance is connected to Hayat, and re-enrolling
 * it with a new code: a new API secret, made in Hayat's console (Services →
 * Tabletsgo → Enrollment), without anyone copying it.
 */
export default function AdminHayatPage() {
  const [status, setStatus] = useState<HayatStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reenrolling, setReenrolling] = useState(false)

  const load = useCallback(async () => {
    try {
      setStatus(await getHayatStatus())
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  return (
    <Section title="Hayat" desc="Where people sign in, and who may do what. This instance asks Hayat with its own credentials.">
      <Narrow>
        {error ? (
          <p className="text-[13px] text-destructive">{error}</p>
        ) : !status ? (
          <LoadingState />
        ) : (
          <div className="flex flex-col gap-6">
            <div className="rounded-[12px] border border-border p-4">
              <div className="mb-3 flex items-center gap-2">
                <span className="text-[13px] font-semibold">Connection</span>
                {status.rejected ? (
                  <Badge variant="destructive">Credentials refused</Badge>
                ) : status.enrolled ? (
                  <Badge variant="default">Connected</Badge>
                ) : (
                  <Badge variant="warning">Not enrolled</Badge>
                )}
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12px]">
                <Row label="Sign-in (issuer)">
                  <span className="font-mono">{status.issuer}</span>
                </Row>
                <Row label="Service API">
                  <span className="font-mono">{status.apiUrl}</span>
                </Row>
                <Row label="Console">
                  {status.consoleUrl && (
                    <a className="text-primary underline-offset-2 hover:underline" href={`${status.consoleUrl}/services/${status.namespace}`} target="_blank" rel="noreferrer">
                      {status.consoleUrl}
                    </a>
                  )}
                </Row>
                <Row label="Namespace">
                  <span className="font-mono">{status.namespace}</span>
                </Row>
                <Row label="Enrolled">{status.enrolledAt ? formatDateTime(new Date(status.enrolledAt)) : null}</Row>
                <Row label="Address">
                  <span className="font-mono">{status.publicUrl || status.address}</span>
                </Row>
                <Row label="Sign-in client">
                  <span className="font-mono">{status.webClientId}</span>
                </Row>
              </dl>
            </div>

            {reenrolling ? (
              <div className="rounded-[12px] border border-border p-4">
                <HayatEnrollment
                  consoleUrl={status.consoleUrl}
                  reason="reenroll"
                  doneLabel="Done"
                  onDone={() => {
                    setReenrolling(false)
                    void load()
                  }}
                />
              </div>
            ) : (
              <div className="flex flex-col items-start gap-2">
                <p className="text-[12px] text-muted-foreground">
                  Re-enroll to rotate this instance’s secret — after a leak, or when Hayat refuses the one it has. Make a code in Hayat’s console under Services →
                  Tabletsgo → Enrollment. The old secret stops working as soon as the new one is issued.
                </p>
                <Button variant="outline" onClick={() => setReenrolling(true)}>
                  Re-enroll with a new code
                </Button>
              </div>
            )}
          </div>
        )}
      </Narrow>
    </Section>
  )
}
