import { ExternalLink, Layers, UserRound } from 'lucide-react'
import { DEFAULTS, useTheme } from '@/app/providers/ThemeContext'
import { PRESETS, paletteOf, type Look } from '@/shared/lib/appearance'
import { Button } from '@/shared/ui/button'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import AppearanceEditor from './AppearanceEditor'

/**
 * Setting → Appearance. A theme is the account's, one for every app the person
 * signs in to. Where the account lives decides where it is edited: a solo
 * instance keeps its owner here, so the editor is here; in enterprise mode the
 * account is Hayat's, so this shows the theme in use and links to Hayat's
 * console. The server says which (`editable`), so this never asks the mode.
 */
export default function AppearanceSetting() {
  const theme = useTheme()
  if (!theme.loaded) return <LoadingState />
  if (theme.error) {
    return (
      <div className="flex max-w-[860px] flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-5">
        <p className="text-[13px] text-muted-foreground">Couldn’t load your theme: {theme.error}</p>
        <Button variant="outline" onClick={theme.retry}>
          Try again
        </Button>
      </div>
    )
  }

  if (theme.editable) {
    return (
      <AppearanceEditor
        saved={theme.saved}
        defaults={DEFAULTS}
        systemDark={theme.systemDark}
        onPreview={theme.preview}
        onSave={theme.save}
        savedNote="Saved with your account on this instance."
        intro={
          <Intro icon={<UserRound className="size-4" />} title="Your theme, on every device">
            Saved with your account on this instance, so every browser you sign in from looks the same. If this instance
            later joins a team on Hayat, your theme moves with your account.
          </Intro>
        }
      />
    )
  }
  return <InUse look={theme.saved} resolved={theme.resolved} editUrl={theme.editUrl} />
}

function Intro({ icon, title, children, action }: { icon: React.ReactNode; title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-border bg-card p-5">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">{icon}</span>
      <div className="min-w-0 flex-[1_1_18rem]">
        <h3 className="text-[14px] font-semibold">{title}</h3>
        <p className="mt-0.5 text-[12px] text-muted-foreground">{children}</p>
      </div>
      {action}
    </section>
  )
}

/** Enterprise: the theme the account carries, read-only, and the way to Hayat. */
function InUse({ look, resolved, editUrl }: { look: Look | null; resolved: 'light' | 'dark'; editUrl: string | null }) {
  const c = paletteOf(look, DEFAULTS, resolved)
  const preset = PRESETS.find((p) => p.id === look?.preset)
  const name = !look ? 'tabletsgo default' : preset?.name ?? 'Custom'
  const swatches: [string, string][] = [
    ['Accent', c.accent],
    ['Background', c.background],
    ['Surface', c.surface],
    ['Text', c.text],
    ['Sidebar', c.sidebarBackground],
    ['Sidebar text', c.sidebarText],
  ]
  const sizes: [string, string][] = [
    ['Font', { system: 'System', inter: 'Inter', plex: 'IBM Plex' }[look?.font ?? 'system']],
    ['Text size', `${look?.textSize ?? DEFAULTS.textSize} px`],
    ['Density', (look?.density ?? 'comfortable').replace(/^./, (s) => s.toUpperCase())],
    ['Corners', `${look?.radius ?? DEFAULTS.radius} px`],
    ['Sidebar', `${look?.sidebarWidth ?? DEFAULTS.sidebarWidth} px`],
  ]

  return (
    <div className="flex max-w-[860px] flex-col gap-5">
      <Intro
        icon={<Layers className="size-4" />}
        title="Your theme lives in your Hayat account"
        action={
          editUrl ? (
            <Button asChild size="lg">
              <a href={editUrl} target="_blank" rel="noreferrer">
                Change in Hayat <ExternalLink />
              </a>
            </Button>
          ) : undefined
        }
      >
        One theme for every app you sign in to. Change it once in Hayat and tabletsgo follows on the next page load.
        {!editUrl && ' Ask your administrator for the address of the Hayat console.'}
      </Intro>

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-[14px] font-semibold">In use now</h3>
            <p className="mt-0.5 text-[12px] text-muted-foreground">Read from your account, so you know what you have.</p>
          </div>
          <span className="rounded-full bg-muted px-3 py-1 text-[12px] font-semibold">
            {name} · {resolved === 'dark' ? 'Dark' : 'Light'}
          </span>
        </div>
        <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3 border-t border-border pt-4">
          {swatches.map(([label, hex]) => (
            <div key={label} className="flex items-center gap-2.5">
              <span className="size-8 shrink-0 rounded-md border border-input" style={{ background: hex }} />
              <span className="min-w-0">
                <span className="block text-[12px] font-medium">{label}</span>
                <span className="block font-mono text-[11px] text-muted-foreground">{hex.toUpperCase()}</span>
              </span>
            </div>
          ))}
        </div>
        <dl className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3 border-t border-border pt-4">
          {sizes.map(([label, value]) => (
            <div key={label}>
              <dt className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{label}</dt>
              <dd className="text-[13px] font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  )
}
