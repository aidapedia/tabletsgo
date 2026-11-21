import { useState, type FormEvent } from 'react'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { FormField } from '@/shared/ui/form/FormField'
import { RadioGroup, RadioGroupItem } from '@/shared/ui/radio-group'
import { formatDateTime } from '@/shared/lib/datetime'
import { enroll, inspectEnrollment, type EnrollmentPreview, type EnrollmentResult } from '../api'

const NAMESPACE = 'tabletsgo'

type Props = {
  // Hayat's console, for the "make a code there" link; null without HAYAT_CONSOLE_URL.
  consoleUrl: string | null
  // Why it's shown: a new instance, Hayat refusing the stored credentials, or an
  // admin re-enrolling from Admin → Hayat.
  reason: 'new' | 'rejected' | 'reenroll'
  // After the last step's button: sign in (setup page) or reload (admin page).
  onDone: () => void
  doneLabel?: string
}

/**
 * Enrolling with Hayat, in three steps: paste a code made in Hayat's console,
 * check what it does and who becomes the admin, then sign in. Nobody copies a
 * secret: Hayat hands tabletsgo its credentials in exchange for the code.
 */
export default function HayatEnrollment({ consoleUrl, reason, onDone, doneLabel = 'Sign in with Hayat' }: Props) {
  const [code, setCode] = useState('')
  const [preview, setPreview] = useState<EnrollmentPreview | null>(null)
  const [adminChoice, setAdminChoice] = useState<'maker' | 'other'>('maker')
  const [adminEmail, setAdminEmail] = useState('')
  const [result, setResult] = useState<EnrollmentResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const check = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      setPreview(await inspectEnrollment(code.trim()))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const finish = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      setResult(await enroll({ code: code.trim(), adminEmail: preview?.registers && adminChoice === 'other' ? adminEmail.trim() : '' }))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    return (
      <div>
        <h1 className="mb-1 text-[16px] font-semibold">Connected to Hayat</h1>
        <p className="mb-4 text-[13px] text-muted-foreground">
          {result.registered
            ? 'Tabletsgo is registered in Hayat and has its credentials. People sign in there and come back to '
            : 'Tabletsgo has a new secret from Hayat; the old one no longer works. People sign in there and come back to '}
          <span className="font-mono">{result.address}</span>.
        </p>
        {result.warnings.length > 0 && (
          <ul className="mb-4 flex list-disc flex-col gap-1 rounded-[10px] border border-warning/30 bg-warning/10 py-2 pr-3 pl-7 text-[12px] text-warning">
            {result.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
        {result.registered && (
          <p className="mb-5 text-[12px] text-muted-foreground">
            Next, in Hayat’s console: create a workspace and grant <strong>Workspace owner (tabletsgo)</strong> to whoever runs it.
          </p>
        )}
        <Button size="lg" className="w-full" onClick={onDone}>
          {doneLabel}
        </Button>
      </div>
    )
  }

  if (preview) {
    const maker = preview.madeBy.name ? `${preview.madeBy.name} (${preview.madeBy.email})` : preview.madeBy.email
    const otherInvalid = adminChoice === 'other' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail.trim())
    return (
      <form onSubmit={finish} noValidate>
        <h1 className="mb-1 text-[16px] font-semibold">{preview.registers ? 'Register Tabletsgo in Hayat' : 'Give Tabletsgo a new secret'}</h1>
        <p className="mb-4 text-[13px] text-muted-foreground">
          {preview.registers
            ? 'This code registers Tabletsgo with the Hayat below and publishes its permissions there.'
            : 'Hayat already knows Tabletsgo. This code gives it a new API secret; the old one stops working at once, and admins stay as they are.'}
        </p>
        <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 rounded-[10px] border border-border bg-background/50 p-3 text-[12px]">
          <dt className="text-muted-foreground">Hayat</dt>
          <dd className="truncate font-mono">{preview.issuer}</dd>
          <dt className="text-muted-foreground">Made by</dt>
          <dd className="truncate">{maker}</dd>
          {preview.expiresAt && (
            <>
              <dt className="text-muted-foreground">Valid until</dt>
              <dd>{formatDateTime(new Date(preview.expiresAt))}</dd>
            </>
          )}
          <dt className="text-muted-foreground">Address</dt>
          <dd className="truncate font-mono">{preview.address ?? window.location.origin}</dd>
        </dl>
        {!preview.issuerMatches && (
          <p className="mb-4 rounded-[10px] border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] text-warning">
            Hayat calls itself {preview.issuer}, which isn’t this instance’s HAYAT_ISSUER. Sign-in won’t work until they match.
          </p>
        )}
        {preview.registers && (
          <FormField label="Tabletsgo admin" hint="Manages Modules, Email and Updates here. Someone without a Hayat account gets an invitation.">
            <RadioGroup value={adminChoice} onValueChange={(v) => setAdminChoice(v as 'maker' | 'other')} className="gap-2.5">
              <label className="flex cursor-pointer items-start gap-2.5 text-[13px]">
                <RadioGroupItem value="maker" className="mt-0.5" />
                <span>
                  The Hayat admin who made this code
                  <span className="block text-[12px] text-muted-foreground">{maker}</span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2.5 text-[13px]">
                <RadioGroupItem value="other" className="mt-0.5" />
                <span>Someone else</span>
              </label>
            </RadioGroup>
            {adminChoice === 'other' && (
              <Input
                className="mt-2.5"
                type="email"
                autoFocus
                placeholder="name@example.com"
                aria-label="Admin's email"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
              />
            )}
          </FormField>
        )}
        {error && <p className="mb-3 text-[12px] text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="lg" onClick={() => setPreview(null)} disabled={busy}>
            Back
          </Button>
          <Button type="submit" size="lg" className="flex-1" disabled={busy || otherInvalid}>
            {busy ? 'Connecting…' : preview.registers ? 'Register and connect' : 'Rotate the secret'}
          </Button>
        </div>
      </form>
    )
  }

  const servicesLink = consoleUrl ? `${consoleUrl}/services` : null
  return (
    <form onSubmit={check} noValidate>
      <h1 className="mb-1 text-[16px] font-semibold">{reason === 'rejected' ? 'Reconnect to Hayat' : reason === 'reenroll' ? 'Re-enroll with Hayat' : 'Connect Tabletsgo to Hayat'}</h1>
      <p className="mb-4 text-[13px] text-muted-foreground">
        {reason === 'rejected'
          ? 'Hayat no longer accepts this instance’s credentials — its secret was rotated or revoked. A new enrollment code fixes it.'
          : reason === 'reenroll'
            ? 'A new enrollment code gives Tabletsgo a new API secret, without anyone copying it.'
            : 'People sign in to Tabletsgo with Hayat. Connect it once with an enrollment code — no secret to copy.'}
      </p>
      <ol className="mb-5 flex list-decimal flex-col gap-1 pl-5 text-[12px] text-muted-foreground">
        <li>
          In Hayat’s console, open{' '}
          {servicesLink ? (
            <a className="text-primary underline-offset-2 hover:underline" href={servicesLink} target="_blank" rel="noreferrer">
              Services
            </a>
          ) : (
            'Services'
          )}{' '}
          {reason === 'new' ? (
            <>
              → <strong>Enroll service</strong>, namespace <code className="font-mono">{NAMESPACE}</code> (an instance admin).
            </>
          ) : (
            <>
              → Tabletsgo → <strong>Enrollment</strong> → New enrollment code.
            </>
          )}
        </li>
        <li>Copy the code and paste it here.</li>
      </ol>
      <FormField label="Enrollment code" htmlFor="enroll-code" error={error}>
        <Input
          id="enroll-code"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          placeholder="hye_…"
          className="font-mono"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      </FormField>
      <Button type="submit" size="lg" className="mt-1 w-full" disabled={busy || !code.trim()}>
        {busy ? 'Checking…' : 'Continue'}
      </Button>
    </form>
  )
}
