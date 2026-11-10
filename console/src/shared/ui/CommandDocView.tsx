import { useState } from 'react'
import { toast } from 'sonner'
import { CopyIcon, ExternalLinkIcon, PlayIcon } from '@/shared/ui/icons'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'

/**
 * One console command's documentation, engine-agnostic. Each command-language
 * feature (Redis, Kafka, …) builds these from its own catalog — and may merge in
 * what the live server reports — this view only renders them. Prose fields may
 * mark code with `backticks`.
 */
export type CommandDoc = {
  name: string
  /** Argument template, e.g. `key value [EX seconds]`. */
  syntax: string
  summary: string
  /** Which console it belongs to — "Redis", "Kafka". */
  engine: string
  category?: string
  /** True when running it changes data, false when it never does; unset when it depends on the arguments. */
  writes?: boolean
  /** Shown above everything else, e.g. a deprecation. */
  warning?: string
  /** Short labelled facts: time complexity, the version it arrived in, ACL categories. */
  facts?: { label: string; value: string }[]
  /** Longer explanation, one paragraph per entry. */
  details?: string[]
  options?: { name: string; desc: string }[]
  subcommands?: { name: string; summary: string }[]
  /** What comes back — the result's columns or reply type. */
  returns?: string
  examples?: { command: string; note?: string; response?: string }[]
  notes?: string[]
  history?: { version: string; change: string }[]
  /** Where the reference came from, when it isn't the built-in text. */
  source?: string
  link?: { href: string; label: string }
}

const Heading = ({ children }: { children: string }) => (
  <p className="mt-5 text-[10px] font-semibold uppercase tracking-wider text-faint">{children}</p>
)

// Prose with `backtick` spans rendered as code.
const Prose = ({ text }: { text: string }) => (
  <>
    {text.split(/(`[^`]+`)/).map((part, i) =>
      part.startsWith('`') && part.endsWith('`') && part.length > 1 ? (
        <code key={i} className="rounded bg-muted px-1 font-mono text-[10.5px] text-foreground">
          {part.slice(1, -1)}
        </code>
      ) : (
        part
      )
    )}
  </>
)

/**
 * One command's docs, sized for the command reference side panel. Each example
 * can be copied, or run through `onRun` — after a confirmation when the
 * command writes, since examples name keys and topics that may be real.
 */
export default function CommandDocView({ doc, onRun }: { doc: CommandDoc | null; onRun?: (command: string) => void }) {
  const [confirming, setConfirming] = useState<string | null>(null)

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Command copied')
    } catch {
      toast.error('Could not copy to clipboard')
    }
  }
  const run = (text: string) => (doc?.writes === false ? onRun?.(text) : setConfirming(text))

  if (!doc) return <p className="py-6 text-center text-[11px] text-faint">No documentation for this command.</p>

  return (
    <div className="text-[11px] leading-relaxed">
      <div className="flex flex-wrap gap-1 pt-3">
        {doc.category && <Badge variant="faint">{doc.category}</Badge>}
        {doc.writes !== undefined && <Badge variant={doc.writes ? 'warning' : 'default'}>{doc.writes ? 'Writes' : 'Read-only'}</Badge>}
      </div>
      {doc.warning && (
        <p className="mt-2 rounded-lg border border-warning/30 bg-warning/10 px-2.5 py-1.5 text-warning">
          <Prose text={doc.warning} />
        </p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        <Prose text={doc.summary} />
      </p>

      {!!doc.facts?.length && (
        <dl className="mt-3 space-y-1.5">
          {doc.facts.map((f) => (
            <div key={f.label}>
              <dt className="text-[10px] text-faint">{f.label}</dt>
              <dd className="text-foreground">
                <Prose text={f.value} />
              </dd>
            </div>
          ))}
        </dl>
      )}

      <Heading>Syntax</Heading>
      <pre className="mt-1.5 whitespace-pre-wrap break-words rounded-lg border border-border bg-muted px-2.5 py-2 font-mono text-[11px]">
        <span className="text-[#c49bff]">{doc.name}</span> <span className="text-muted-foreground">{doc.syntax}</span>
      </pre>

      {doc.details?.map((p) => (
        <p key={p} className="mt-2 text-muted-foreground">
          <Prose text={p} />
        </p>
      ))}

      {!!doc.options?.length && (
        <>
          <Heading>Arguments</Heading>
          <div className="mt-1.5 divide-y divide-border/60">
            {doc.options.map((o) => (
              <div key={o.name} className="py-1.5">
                <span className="block break-words font-mono text-foreground">{o.name}</span>
                <span className="block text-faint">
                  <Prose text={o.desc} />
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {!!doc.subcommands?.length && (
        <>
          <Heading>Subcommands</Heading>
          <div className="mt-1.5 divide-y divide-border/60">
            {doc.subcommands.map((s) => (
              <div key={s.name} className="py-1.5">
                <span className="block font-mono text-foreground">{s.name}</span>
                {s.summary && (
                  <span className="block text-faint">
                    <Prose text={s.summary} />
                  </span>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {doc.returns && (
        <>
          <Heading>Returns</Heading>
          <p className="mt-1.5 text-muted-foreground">
            <Prose text={doc.returns} />
          </p>
        </>
      )}

      {!!doc.examples?.length && (
        <>
          <Heading>Examples</Heading>
          <div className="mt-1.5 flex flex-col gap-1.5">
            {doc.examples.map((ex) => (
              <div key={ex.command} className="overflow-hidden rounded-lg border border-border bg-muted">
                <div className="flex items-start gap-1 py-2 pl-2.5 pr-1">
                  <div className="min-w-0 flex-1">
                    <code className="block break-all font-mono">{ex.command}</code>
                    {ex.note && <span className="mt-0.5 block text-faint">{ex.note}</span>}
                  </div>
                  <div className="-mt-1 flex shrink-0">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon-xs" aria-label={`Copy ${ex.command}`} onClick={() => copy(ex.command)}>
                          <CopyIcon width={12} height={12} />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top">Copy</TooltipContent>
                    </Tooltip>
                    {onRun && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon-xs" aria-label={`Run ${ex.command}`} className="hover:!text-primary-bright" onClick={() => run(ex.command)}>
                            <PlayIcon width={12} height={12} />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top">Run</TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                </div>
                {ex.response && (
                  <div className="border-t border-border bg-background/60 px-2.5 py-1.5">
                    <span className="block text-[9px] font-semibold uppercase tracking-wider text-faint">Response</span>
                    <pre className="mt-0.5 overflow-x-auto whitespace-pre font-mono text-[10.5px] text-primary-bright">{ex.response}</pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {!!doc.notes?.length && (
        <>
          <Heading>Notes</Heading>
          <ul className="mt-1.5 list-disc space-y-1 pl-4 text-muted-foreground">
            {doc.notes.map((n) => (
              <li key={n}>
                <Prose text={n} />
              </li>
            ))}
          </ul>
        </>
      )}

      {!!doc.history?.length && (
        <>
          <Heading>History</Heading>
          <ul className="mt-1.5 space-y-1 text-muted-foreground">
            {doc.history.map((h) => (
              <li key={`${h.version}:${h.change}`} className="flex gap-2">
                <span className="w-[46px] shrink-0 font-mono text-faint">{h.version}</span>
                <span className="min-w-0">
                  <Prose text={h.change} />
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {doc.source && <p className="mt-5 text-[10px] text-faint">{doc.source}</p>}

      {doc.link && (
        <a href={doc.link.href} target="_blank" rel="noreferrer" className={`${doc.source ? 'mt-1.5' : 'mt-5'} inline-flex items-center gap-1.5 text-primary-bright hover:underline`}>
          {doc.link.label}
          <ExternalLinkIcon width={11} height={11} />
        </a>
      )}

      {confirming && (
        <ConfirmDialog
          title={doc.writes ? 'Run a command that writes?' : 'Run this command?'}
          description={`${confirming} — it runs against this connection as written, so check the names in it are ones you mean.`}
          confirmLabel="Run"
          destructive={!!doc.writes}
          onConfirm={() => {
            onRun?.(confirming)
            setConfirming(null)
          }}
          onCancel={() => setConfirming(null)}
        />
      )}
    </div>
  )
}
