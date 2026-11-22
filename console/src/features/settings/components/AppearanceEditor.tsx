import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, CircleCheck, Download, Link2, Palette as PaletteIcon, RotateCcw, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Switch } from '@/shared/ui/switch'
import {
  CONTENT_COLORS,
  FONT_STACKS,
  PRESETS,
  RADII,
  SCALES,
  SIDEBAR_COLORS,
  SIDEBAR_WIDTHS,
  STATUS_COLORS,
  SWATCHES,
  fromPreset,
  isCustom,
  normalizeLook,
  paletteOf,
  plainMode,
  readability,
  resolveMode,
  scaleOf,
  sizesOf,
  withMode,
  type AppDefaults,
  type ColorKey,
  type ContentWidth,
  type Density,
  type Font,
  type Look,
  type Mode,
  type Palette,
} from '@/shared/lib/appearance'

/**
 * The theme editor: the color scheme (an app's own light or dark, or colors of
 * your own from a preset), then every size as a few named choices, and a theme
 * file. Custom colors come with a readability check. Every change shows on the
 * app itself at once (`onPreview`); nothing is stored until Save.
 *
 * Given `app`, it edits one app's theme, which may follow the account's
 * instead of having its own.
 *
 * Kept identical in tabletsgo (Setting → Appearance, solo mode) and Hayat
 * (Account → Appearance), apart from the import paths.
 */

const LABELS: Record<ColorKey, [string, string]> = {
  accent: ['Accent', 'Buttons, links, focus rings, the active tab'],
  accentText: ['Button text', 'Text and icons on the accent'],
  background: ['Background', 'The page behind everything'],
  surface: ['Surface', 'Cards, popovers, menus'],
  text: ['Text', 'Headings and body copy'],
  muted: ['Muted text', 'Hints, meta, table headers'],
  border: ['Border', 'Dividers and outlines'],
  sidebarBackground: ['Background', 'The navigation column'],
  sidebarText: ['Text', 'Item labels; muted tones derive from it'],
  sidebarActive: ['Active item', 'The page you are on'],
  sidebarBorder: ['Border', 'The edge against content'],
  success: ['Success', 'Connected, active, passed'],
  warning: ['Warning', 'Pending, needs attention'],
  destructive: ['Destructive', 'Delete, revoke, failed'],
}

const same = (a: Look | null, b: Look | null) => JSON.stringify(normalizeLook(a)) === JSON.stringify(normalizeLook(b))

function Section({ title, desc, action, children }: { title: string; desc?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[14px] font-semibold">{title}</h3>
          {desc && <p className="mt-0.5 text-[12px] text-muted-foreground">{desc}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

type Option<T extends string> = { id: T; name: string; desc: string; preview: ReactNode; bleed?: boolean }

/** One choice out of a few, each a card with a picture of what it does. */
function Choices<T extends string>({ label, value, options, onChange, min = '10rem' }: {
  label: string
  value: T
  options: Option<T>[]
  onChange: (v: T) => void
  min?: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(${min}, 100%), 1fr))` }}>
      {options.map((o) => {
        const on = o.id === value
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.id)}
            className={`flex flex-col overflow-hidden rounded-xl border text-left transition-colors ${
              on ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border bg-background hover:border-input'
            }`}
          >
            <span aria-hidden="true" className={`flex h-20 items-center justify-center overflow-hidden border-b border-border bg-muted/40 ${o.bleed ? '' : 'px-4'}`}>
              {o.preview}
            </span>
            <span className="flex items-start gap-2 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold">{o.name}</span>
                <span className="block text-[12px] text-muted-foreground">{o.desc}</span>
              </span>
              {on && <CircleCheck className="size-4 shrink-0 text-primary" />}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div role="group" aria-label={label} className="inline-flex flex-wrap gap-0.5 rounded-lg bg-muted p-0.5">
      {options.map(([id, text]) => (
        <button
          key={id}
          type="button"
          aria-pressed={id === value}
          onClick={() => onChange(id)}
          className={`h-7 rounded-md px-3 text-[12px] font-medium transition-colors ${
            id === value ? 'bg-background text-foreground shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  )
}

function Group({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="mt-5 first:mt-0">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h4 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{title}</h4>
        {action}
      </div>
      {children}
    </div>
  )
}

function ColorRow({ k, value, isSet, disabled, onChange, onReset }: {
  k: ColorKey
  value: string
  isSet: boolean
  disabled?: boolean
  onChange: (hex: string) => void
  onReset: () => void
}) {
  const [label, hint] = LABELS[k]
  const [text, setText] = useState(value.toUpperCase())
  useEffect(() => setText(value.toUpperCase()), [value])
  return (
    <div className={`flex items-center gap-3 border-t border-border py-2.5 first:border-t-0 ${disabled ? 'opacity-50' : ''}`}>
      <label className="relative size-8 shrink-0 cursor-pointer overflow-hidden rounded-md border border-input" style={{ background: value }}>
        <span className="sr-only">{label} color</span>
        <input
          type="color"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 size-full cursor-pointer opacity-0"
        />
      </label>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium">
          {label}
          {!isSet && <span className="ml-2 text-[11px] font-normal text-faint">Default</span>}
        </div>
        <div className="truncate text-[12px] text-muted-foreground">{hint}</div>
      </div>
      {isSet && !disabled && (
        <button
          type="button"
          onClick={onReset}
          aria-label={`Use the default ${label.toLowerCase()}`}
          title="Use the default"
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      )}
      <Input
        aria-label={`${label} hex`}
        value={text}
        disabled={disabled}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value)
          const raw = e.target.value.trim().toLowerCase()
          const hex = raw.startsWith('#') ? raw : `#${raw}`
          if (/^#[0-9a-f]{6}$/.test(hex)) onChange(hex)
        }}
        onBlur={() => setText(value.toUpperCase())}
        className="h-8 w-[6.75rem] shrink-0 font-mono text-[12px] uppercase"
      />
    </div>
  )
}

// ---- Pictures on the choice cards --------------------------------------------------------

/** A palette as a tiny window: its background, a card, a button in the accent. */
function Swatch({ c }: { c: Palette }) {
  return (
    <span className="flex size-full items-center justify-center" style={{ background: c.background }}>
      <span className="flex h-9 w-24 items-center gap-1.5 rounded-md border px-2" style={{ background: c.surface, borderColor: c.border }}>
        <span className="h-1.5 flex-1 rounded-full opacity-60" style={{ background: c.text }} />
        <span className="h-3.5 w-6 rounded-sm" style={{ background: c.accent }} />
      </span>
    </span>
  )
}

function Lines({ gap }: { gap: number }) {
  return (
    <span className="flex w-24 flex-col" style={{ gap }}>
      {[100, 72, 88, 60].map((w) => (
        <span key={w} className="h-1.5 rounded-full bg-foreground/25" style={{ width: `${w}%` }} />
      ))}
    </span>
  )
}

/** The page, with the sidebar `side` of 320px wide and the content `content` wide. */
function Layout({ side, content }: { side: number; content: 'narrow' | 'default' | 'full' }) {
  const inner = { narrow: '50%', default: '72%', full: '100%' }[content]
  return (
    <span className="flex h-10 w-full max-w-44 gap-1 rounded-md border border-border bg-background p-1">
      <span className="rounded-sm bg-foreground/20" style={{ width: `${(side / 320) * 30}%` }} />
      <span className="flex flex-1 justify-center">
        <span className="rounded-sm bg-foreground/12" style={{ width: inner }} />
      </span>
    </span>
  )
}

export type AppearanceEditorProps = {
  saved: Look | null
  defaults: AppDefaults
  systemDark: boolean
  /** Show a theme on the whole app; `undefined` goes back to the saved one. Left out, only the preview card shows it. */
  onPreview?: (look: Look | null | undefined) => void
  /** `own` is false when an app goes back to following the account's theme. */
  onSave: (look: Look | null, own: boolean) => Promise<void>
  /** The card that says where the theme lives. */
  intro?: ReactNode
  /** The line beside Save once everything is saved. */
  savedNote: string
  /** Editing one app's theme: it has its own (`own`) or follows the account's (`account`). */
  app?: { name: string; own: boolean; account: Look | null }
}

export default function AppearanceEditor({ saved, defaults, systemDark, onPreview, onSave, intro, savedNote, app }: AppearanceEditorProps) {
  const savedOwn = app ? app.own : true
  // An app turning to a theme of its own starts from the account's.
  const start = () => (app && !app.own ? app.account : saved)
  const [draft, setDraft] = useState<Look | null>(start)
  const [own, setOwn] = useState(savedOwn)
  const [advanced, setAdvanced] = useState(false)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // The saved theme arrived (or changed) while nothing was being edited.
  const savedKey = JSON.stringify([saved, savedOwn])
  const lastSaved = useRef(savedKey)
  useEffect(() => {
    if (lastSaved.current === savedKey) return
    const [prev, prevOwn] = JSON.parse(lastSaved.current) as [Look | null, boolean]
    if (same(draft, prev) && own === prevOwn) {
      setDraft(start())
      setOwn(savedOwn)
    }
    lastSaved.current = savedKey
  }, [savedKey]) // the rest is read as it was when the saved theme changed

  const showing = own ? draft : (app?.account ?? null)
  // Keyed by value: a caller handing a fresh copy of the same theme on each
  // render must not preview again (previewing re-renders the caller).
  const showingKey = JSON.stringify(showing)
  useEffect(() => onPreview?.(JSON.parse(showingKey) as Look | null), [showingKey, onPreview])
  useEffect(() => () => onPreview?.(undefined), [onPreview])

  const d: Look = draft ?? {}
  const resolved = resolveMode(showing, systemDark)
  const c = paletteOf(showing, defaults, resolved)
  const checks = useMemo(() => readability(c), [c])
  const low = checks.find((x) => x.ratio < x.min)
  const dirty = own !== savedOwn || (own && !same(draft, saved))
  const custom = isCustom(draft)

  const update = (patch: Partial<Look>, colors = true) =>
    setDraft((cur) => {
      const next: Look = { ...(cur ?? {}), ...patch }
      if (colors && next.preset !== 'custom' && Object.keys(patch).some((k) => k !== 'preset' && k !== 'mode')) next.preset = 'custom'
      for (const k of Object.keys(next) as (keyof Look)[]) if (next[k] === undefined) delete next[k]
      return normalizeLook(next)
    })

  // A neutral color picked while following the system pins the mode showing,
  // so the color lands on the palette it was chosen against.
  const setColor = (k: ColorKey, hex: string) =>
    update({ [k]: hex, ...(k !== 'accent' && k !== 'accentText' && (d.mode ?? 'system') === 'system' ? { mode: resolved } : {}) } as Partial<Look>)
  const resetColor = (k: ColorKey) => update({ [k]: undefined } as Partial<Look>)

  const colorRow = (k: ColorKey, disabled = false) => (
    <ColorRow key={k} k={k} value={c[k]} isSet={!!d[k]} disabled={disabled} onChange={(hex) => setColor(k, hex)} onReset={() => resetColor(k)} />
  )

  const exportFile = () => {
    const blob = new Blob([JSON.stringify(normalizeLook(draft) ?? {}, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'appearance.json'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const importFile = async (file: File | undefined) => {
    if (!file) return
    try {
      const look = normalizeLook(JSON.parse(await file.text()))
      if (!look) throw new Error('empty')
      setDraft(look)
      setOwn(true)
      toast.success('Theme loaded. Save it to keep it.')
    } catch {
      toast.error('That file isn’t a theme.')
    }
  }

  const save = async () => {
    setBusy(true)
    try {
      await onSave(own ? normalizeLook(draft) : null, own)
      toast.success(own ? 'Theme saved.' : `${app?.name ?? 'This app'} follows your account’s theme again.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Couldn’t save the theme.')
    } finally {
      setBusy(false)
    }
  }

  const discard = () => {
    setDraft(start())
    setOwn(savedOwn)
  }

  const matched = !!d.sidebarMatchContent
  const scheme = custom ? 'custom' : (d.mode ?? 'system')
  const sideOf = (w: number | undefined) => w ?? defaults.sidebarWidth

  return (
    <div className="relative">
      <div className="flex min-w-0 flex-col gap-5">
          {intro}

          {app && (
            <Section title="Theme source" desc={`Where ${app.name} takes its look from.`}>
              <Choices<'follow' | 'own'>
                label="Theme source"
                value={own ? 'own' : 'follow'}
                onChange={(v) => setOwn(v === 'own')}
                min="14rem"
                options={[
                  {
                    id: 'follow',
                    name: 'Follow your account',
                    desc: 'The theme every app shares. Change it once, and this app changes with it.',
                    preview: <Link2 className="size-6 text-muted-foreground" />,
                  },
                  {
                    id: 'own',
                    name: `A theme for ${app.name}`,
                    desc: 'Its own colors and sizes. Other apps keep following your account.',
                    preview: <PaletteIcon className="size-6 text-muted-foreground" />,
                  },
                ]}
              />
            </Section>
          )}

          {own && (
            <>
              <Section
                title="Color theme"
                desc="The app’s own light or dark palette, or colors of your own."
                action={custom && d.preset === 'custom' && <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold tracking-wide text-primary uppercase">Edited</span>}
              >
                <Choices<Mode | 'custom'>
                  label="Color theme"
                  value={scheme}
                  onChange={(v) => (v === 'custom' ? !custom && update({ preset: 'custom' }, false) : setDraft(normalizeLook(plainMode(d, v))))}
                  options={[
                    { id: 'light', name: 'Light', desc: 'Bright surfaces and dark text.', bleed: true, preview: <Swatch c={defaults.light} /> },
                    {
                      id: 'system',
                      name: 'System',
                      desc: 'Follow your operating system.',
                      bleed: true,
                      preview: (
                        <span className="flex size-full">
                          <span className="w-1/2 overflow-hidden"><Swatch c={defaults.light} /></span>
                          <span className="w-1/2 overflow-hidden"><Swatch c={defaults.dark} /></span>
                        </span>
                      ),
                    },
                    { id: 'dark', name: 'Dark', desc: 'Dark surfaces and soft contrast.', bleed: true, preview: <Swatch c={defaults.dark} /> },
                    {
                      id: 'custom',
                      name: 'Custom',
                      desc: 'Pick a preset or your own colors.',
                      bleed: true,
                      preview: custom ? <Swatch c={c} /> : (
                        <span className="flex size-full">
                          {PRESETS.slice(0, 6).map((p) => (
                            <span key={p.id} className="flex-1" style={{ background: `linear-gradient(${p.colors.background} 55%, ${p.colors.accent} 55%)` }} />
                          ))}
                        </span>
                      ),
                    },
                  ]}
                />

                {custom && (
                  <div className="mt-5 border-t border-border pt-5">
                    <h4 className="mb-3 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Presets</h4>
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3">
                      {PRESETS.map((p) => {
                        const on = d.preset === p.id
                        const pc = p.colors
                        return (
                          <button
                            key={p.id}
                            type="button"
                            aria-pressed={on}
                            onClick={() => setDraft(fromPreset(p, d))}
                            className={`overflow-hidden rounded-lg border bg-card text-left transition-shadow ${on ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-input'}`}
                          >
                            <span className="flex h-16" style={{ background: pc.background }}>
                              <span className="flex w-[30%] flex-col gap-1 p-1.5" style={{ background: pc.sidebarBackground, borderRight: `1px solid ${pc.sidebarBorder}` }}>
                                <span className="h-1.5 w-3/4 rounded-sm" style={{ background: pc.accent }} />
                                {[88, 62, 76].map((w) => (
                                  <span key={w} className="h-1 rounded-sm opacity-35" style={{ width: `${w}%`, background: pc.sidebarText }} />
                                ))}
                              </span>
                              <span className="flex flex-1 flex-col gap-1 p-1.5">
                                <span className="h-1.5 w-1/2 rounded-sm opacity-85" style={{ background: pc.text }} />
                                <span className="flex-1 rounded-sm border" style={{ background: pc.surface, borderColor: pc.border }} />
                                <span className="flex h-3 w-2/5 items-center justify-center rounded-sm text-[7px] leading-none font-bold" style={{ background: pc.accent, color: pc.accentText }}>
                                  Aa
                                </span>
                              </span>
                            </span>
                            <span className="flex items-center justify-between gap-1 border-t border-border px-2.5 py-2 text-[12px] font-medium">
                              {p.name}
                              {on && <Check className="size-3.5 text-primary" />}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                      <div className="min-w-0 flex-[1_1_14rem]">
                        <div className="text-[13px] font-medium">Base palette</div>
                        <div className="text-[12px] text-muted-foreground">Fills every color you leave on Default. Your accent and sizes stay.</div>
                      </div>
                      <Segmented<Mode>
                        label="Base palette"
                        value={d.mode ?? 'system'}
                        options={[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]}
                        onChange={(m) => setDraft(normalizeLook(withMode(d, m)))}
                      />
                    </div>
                  </div>
                )}
              </Section>

              {custom && (
                <Section
                  title="Colors"
                  desc="Every surface you see, set on its own. A color left on Default is the app’s own."
                  action={<Segmented<'basic' | 'advanced'> label="Color detail" value={advanced ? 'advanced' : 'basic'} options={[['basic', 'Basic'], ['advanced', 'Advanced']]} onChange={(v) => setAdvanced(v === 'advanced')} />}
                >
                  <Group title="Accent">
                    <div className="flex flex-wrap items-center gap-2 py-2">
                      {SWATCHES.map((hex) => (
                        <button
                          key={hex}
                          type="button"
                          aria-label={`Accent ${hex}`}
                          aria-pressed={c.accent === hex}
                          // A new accent gets whichever button text reads on it.
                          onClick={() => update({ accent: hex, accentText: undefined })}
                          className="size-8 rounded-full border-2 shadow-[inset_0_0_0_2px_var(--color-card)]"
                          style={{ background: hex, borderColor: c.accent === hex ? 'var(--color-foreground)' : 'transparent' }}
                        />
                      ))}
                    </div>
                    {colorRow('accent')}
                    {colorRow('accentText')}
                  </Group>
                  <Group title="Content">{CONTENT_COLORS.map((k) => colorRow(k))}</Group>
                  <Group
                    title="Sidebar"
                    action={
                      <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
                        Match content
                        <Switch checked={matched} onCheckedChange={(v) => update({ sidebarMatchContent: v || undefined })} />
                      </label>
                    }
                  >
                    {SIDEBAR_COLORS.map((k) => colorRow(k, matched))}
                  </Group>
                  {advanced && <Group title="Status">{STATUS_COLORS.map((k) => colorRow(k))}</Group>}
                  <Group title="Readability">
                    <p className="mb-2 text-[12px] text-muted-foreground">The pairs people read, checked against WCAG as you pick.</p>
                    {low && (
                      <div role="status" className="mb-2 rounded-lg bg-warning/15 px-3 py-2 text-[12px]">
                        {low.label} is {low.ratio.toFixed(1)}:1. Aim for {low.min}:1 or more so it stays readable.
                      </div>
                    )}
                    <ul className="grid gap-x-6 sm:grid-cols-2">
                      {checks.map((x) => (
                        <li key={x.label} className="flex items-center gap-3 border-t border-border py-2 text-[12px]">
                          <span className="flex h-5 w-7 shrink-0 items-center justify-center rounded border border-border text-[10px] font-bold" style={{ background: x.bg, color: x.fg }}>
                            Aa
                          </span>
                          <span className="min-w-0 flex-1">{x.label}</span>
                          <span className="font-mono text-muted-foreground">{x.ratio.toFixed(1)}:1</span>
                          <span className="flex w-20 items-center gap-1.5 font-semibold">
                            <span className={`size-2 rounded-full ${x.ratio >= x.min ? 'bg-success' : x.ratio >= 3 ? 'bg-warning' : 'bg-destructive'}`} />
                            {x.grade}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </Group>
                </Section>
              )}

              <Section
                title="UI scale"
                desc="The size of text and controls."
                action={
                  Object.keys(sizesOf(d)).length > 0 && (
                    <Button variant="outline" size="sm" onClick={() => update({ font: undefined, textSize: undefined, scale: undefined, density: undefined, radius: undefined, sidebarWidth: undefined, contentWidth: undefined }, false)}>
                      <RotateCcw /> Default sizes
                    </Button>
                  )
                }
              >
                <Choices<string>
                  label="UI scale"
                  value={String(scaleOf(draft, defaults))}
                  onChange={(v) => update({ scale: Number(v) === 100 ? undefined : Number(v), textSize: undefined }, false)}
                  min="7rem"
                  options={SCALES.map((s) => ({
                    id: String(s),
                    name: `${s}%`,
                    desc: { 80: 'The most on screen.', 90: 'A little smaller.', 100: 'The default size.', 110: 'A little larger.', 120: 'Easiest to read.' }[s],
                    preview: <span className="font-semibold" style={{ fontSize: `${Math.round(22 * (s / 100))}px` }}>Aa</span>,
                  }))}
                />
              </Section>

              <Section title="Density" desc="How much room lists, tables and forms leave between things.">
                <Choices<Density>
                  label="Density"
                  value={d.density ?? 'comfortable'}
                  onChange={(density) => update({ density: density === 'comfortable' ? undefined : density }, false)}
                  options={[
                    { id: 'comfortable', name: 'Comfortable', desc: 'Room to breathe.', preview: <Lines gap={7} /> },
                    { id: 'compact', name: 'Compact', desc: 'More rows on screen.', preview: <Lines gap={4} /> },
                    { id: 'condensed', name: 'Condensed', desc: 'As much as fits.', preview: <Lines gap={2} /> },
                  ]}
                />
              </Section>

              <Section title="Corners" desc="How round buttons, cards and fields are.">
                <Choices<string>
                  label="Corners"
                  value={String(d.radius ?? 'default')}
                  onChange={(v) => update({ radius: v === 'default' ? undefined : Number(v) }, false)}
                  min="8rem"
                  options={RADII.map(([r, name, desc]) => ({
                    id: String(r ?? 'default'),
                    name,
                    desc,
                    preview: <span className="h-10 w-16 border-2 border-foreground/35 bg-background" style={{ borderRadius: `${r ?? defaults.radius}px` }} />,
                  }))}
                />
              </Section>

              <Section title="Sidebar width" desc="How wide the navigation column is.">
                <Choices<string>
                  label="Sidebar width"
                  value={String(d.sidebarWidth ?? 'default')}
                  onChange={(v) => update({ sidebarWidth: v === 'default' ? undefined : Number(v) }, false)}
                  options={SIDEBAR_WIDTHS.map(([w, name, desc]) => ({
                    id: String(w ?? 'default'),
                    name,
                    desc,
                    preview: <Layout side={sideOf(w)} content="full" />,
                  }))}
                />
              </Section>

              <Section title="Page width" desc="How pages use a wide screen.">
                <Choices<ContentWidth>
                  label="Page width"
                  value={d.contentWidth ?? 'default'}
                  onChange={(contentWidth) => update({ contentWidth: contentWidth === 'default' ? undefined : contentWidth }, false)}
                  options={[
                    { id: 'narrow', name: 'Narrow', desc: 'Short lines, easy to read.', preview: <Layout side={sideOf(d.sidebarWidth)} content="narrow" /> },
                    { id: 'default', name: 'Centered', desc: 'Centered at a comfortable width.', preview: <Layout side={sideOf(d.sidebarWidth)} content="default" /> },
                    { id: 'full', name: 'Full width', desc: 'Use all the space there is.', preview: <Layout side={sideOf(d.sidebarWidth)} content="full" /> },
                  ]}
                />
              </Section>

              <Section title="Font" desc="The typeface of the whole interface.">
                <Choices<Font>
                  label="Font"
                  value={d.font ?? 'system'}
                  onChange={(font) => update({ font: font === 'system' ? undefined : font }, false)}
                  options={[
                    { id: 'system', name: 'System', desc: 'Your device’s own.', preview: <span className="text-[24px] font-semibold" style={{ fontFamily: FONT_STACKS.system }}>Aa</span> },
                    { id: 'inter', name: 'Inter', desc: 'Neutral, made for screens.', preview: <span className="text-[24px] font-semibold" style={{ fontFamily: FONT_STACKS.inter }}>Aa</span> },
                    { id: 'plex', name: 'IBM Plex', desc: 'A little more character.', preview: <span className="text-[24px] font-semibold" style={{ fontFamily: FONT_STACKS.plex }}>Aa</span> },
                  ]}
                />
              </Section>

              <Section
                title="Theme file"
                desc="Hand it to a teammate, or keep a copy before you experiment."
                action={
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => setDraft(null)}>
                      <RotateCcw /> Reset to defaults
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                      <Upload /> Import
                    </Button>
                    <Button variant="outline" size="sm" onClick={exportFile}>
                      <Download /> Export
                    </Button>
                    <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => void importFile(e.target.files?.[0]).finally(() => (e.target.value = ''))} />
                  </div>
                }
              >
                {advanced ? (
                  <pre className="max-h-60 overflow-auto rounded-lg border border-border bg-background p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
                    {JSON.stringify(normalizeLook(draft) ?? {}, null, 2)}
                  </pre>
                ) : (
                  <p className="text-[12px] text-faint">Switch Colors to Advanced (under Custom) to see the file.</p>
                )}
              </Section>
            </>
          )}
      </div>

      {/* The page's footer while the theme is being edited: the full width of
          the main column (both layouts' <main> is an @container with px-8 / px-4
          on phones and py-10 / py-7), its top border the only edge, flush with
          the bottom of the window — a sticky box stops at the scroller's padding,
          so it sits that padding lower. Its content lines up with the page's. */}
      <div className="sticky -bottom-10 z-20 mx-[calc((100%_-_100cqi)/2_-_2rem)] mt-8 -mb-10 border-t border-border bg-background/95 backdrop-blur max-[600px]:-bottom-7 max-[600px]:mx-[calc((100%_-_100cqi)/2_-_1rem)] max-[600px]:-mb-7">
        <div className="mx-auto flex w-full max-w-(--app-content-width) flex-wrap items-center justify-between gap-3 px-8 py-3 max-[600px]:px-4">
          <span className="flex min-w-0 flex-[1_1_16rem] items-center gap-2 text-[12px] text-muted-foreground">
            <span className={`size-2 shrink-0 rounded-full ${dirty ? 'bg-warning' : 'bg-success'}`} />
            {dirty ? 'Unsaved changes. You’re seeing them live; nothing is stored until you save.' : savedNote}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" disabled={!dirty || busy} onClick={discard}>
              Discard
            </Button>
            <Button disabled={!dirty || busy} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save theme'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
