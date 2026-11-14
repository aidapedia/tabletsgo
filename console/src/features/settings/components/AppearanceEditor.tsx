import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, Download, RotateCcw, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Switch } from '@/shared/ui/switch'
import {
  CONTENT_COLORS,
  LIMITS,
  PRESETS,
  SIDEBAR_COLORS,
  STATUS_COLORS,
  SWATCHES,
  fromPreset,
  normalizeLook,
  paletteOf,
  readability,
  resolveMode,
  sizesOf,
  textOn,
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
 * The theme editor: presets, mode, every color, sizes and type, a theme file,
 * with a preview and a readability check beside it. Every change shows on the
 * whole app at once (`onPreview`); nothing is stored until Save.
 *
 * Kept identical in tabletsgo (Setting → Appearance, solo mode) and Hayat
 * (Account → Appearance), apart from the import paths.
 */

const LABELS: Record<ColorKey, [string, string]> = {
  accent: ['Accent', 'Buttons, links, focus rings, the active tab'],
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

function Card({ title, desc, action, children }: { title: string; desc?: string; action?: ReactNode; children: ReactNode }) {
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

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-3 first:border-t-0 first:pt-0">
      <div className="min-w-0 flex-[1_1_14rem]">
        <div className="text-[13px] font-medium">{label}</div>
        {hint && <div className="text-[12px] text-muted-foreground">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

function Group({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="mt-5">
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

function Slider({ id, label, value, isSet, min, max, step = 1, ends, onChange }: {
  id: string
  label: string
  value: number
  isSet: boolean
  min: number
  max: number
  step?: number
  ends: [string, string]
  onChange: (v: number) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-[13px] font-medium">
          {label}
          {!isSet && <span className="ml-2 text-[11px] font-normal text-faint">Default</span>}
        </label>
        <span className="font-mono text-[12px] text-muted-foreground">{value} px</span>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-primary" />
      <div className="flex justify-between text-[11px] text-faint">
        <span>{ends[0]}</span>
        <span>{ends[1]}</span>
      </div>
    </div>
  )
}

/** A small app drawn in the theme's colors, so a sidebar color can be judged beside its content. */
function MiniApp({ c, radius }: { c: Palette; radius: number }) {
  const r = `${Math.round(radius * 0.6)}px`
  const rows = [
    ['Aidapedia', '24 members', true],
    ['Northwind Labs', '8 members', false],
    ['Lumen Health', '41 members', false],
    ['Sagara Logistics', '12 members', false],
  ] as const
  return (
    <div aria-hidden="true" className="flex h-[260px] overflow-hidden border text-[11px]" style={{ background: c.background, color: c.text, borderColor: c.border, borderRadius: `${radius}px` }}>
      <div className="flex w-[34%] shrink-0 flex-col gap-1 p-2.5" style={{ background: c.sidebarBackground, color: c.sidebarText, borderRight: `1px solid ${c.sidebarBorder}` }}>
        <div className="mb-2 flex items-center gap-1.5 font-bold">
          <span className="flex size-5 items-center justify-center text-[10px]" style={{ background: c.accent, color: textOn(c.accent), borderRadius: r }}>A</span>
          Workspace
        </div>
        {['Overview', 'Connections', 'Members', 'Settings'].map((item, i) => (
          <div key={item} className="flex h-6 items-center px-2" style={{ borderRadius: r, background: i === 1 ? c.sidebarActive : 'transparent', fontWeight: i === 1 ? 600 : 400, opacity: i === 1 ? 1 : 0.72 }}>
            {item}
          </div>
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] font-bold">Connections</span>
          <span className="px-2 py-1 font-semibold" style={{ background: c.accent, color: textOn(c.accent), borderRadius: r }}>New</span>
        </div>
        <div className="overflow-hidden border" style={{ background: c.surface, borderColor: c.border, borderRadius: r }}>
          {rows.map(([name, meta, live]) => (
            <div key={name} className="flex items-center gap-2 px-2.5 py-2" style={{ borderTop: `1px solid ${c.border}` }}>
              <span className="min-w-0 flex-1 truncate font-semibold">{name}</span>
              <span style={{ color: c.muted }}>{meta}</span>
              <span className="size-1.5 rounded-full" style={{ background: live ? c.success : c.warning }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export type AppearanceEditorProps = {
  saved: Look | null
  defaults: AppDefaults
  systemDark: boolean
  /** Show a theme on the whole app; `undefined` goes back to the saved one. */
  onPreview: (look: Look | null | undefined) => void
  onSave: (look: Look | null) => Promise<void>
  /** The card that says where the theme lives. */
  intro?: ReactNode
  /** The line beside Save once everything is saved. */
  savedNote: string
}

export default function AppearanceEditor({ saved, defaults, systemDark, onPreview, onSave, intro, savedNote }: AppearanceEditorProps) {
  const [draft, setDraft] = useState<Look | null>(saved)
  const [advanced, setAdvanced] = useState(false)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // The account's theme arrived (or changed) while nothing was being edited.
  const savedKey = JSON.stringify(saved)
  const lastSaved = useRef(savedKey)
  useEffect(() => {
    if (lastSaved.current === savedKey) return
    setDraft((d) => (same(d, JSON.parse(lastSaved.current)) ? saved : d))
    lastSaved.current = savedKey
  }, [savedKey, saved])

  useEffect(() => onPreview(draft), [draft, onPreview])
  useEffect(() => () => onPreview(undefined), [onPreview])

  const d: Look = draft ?? {}
  const resolved = resolveMode(draft, systemDark)
  const c = paletteOf(draft, defaults, resolved)
  const checks = useMemo(() => readability(c), [c])
  const low = checks.find((x) => x.ratio < x.min)
  const dirty = !same(draft, saved)

  const update = (patch: Partial<Look>, custom = true) =>
    setDraft((cur) => {
      const next: Look = { ...(cur ?? {}), ...patch }
      if (custom) next.preset = 'custom'
      for (const k of Object.keys(next) as (keyof Look)[]) if (next[k] === undefined) delete next[k]
      return normalizeLook(next)
    })

  // A neutral color picked while following the system pins the mode showing,
  // so the color lands on the palette it was chosen against.
  const setColor = (k: ColorKey, hex: string) =>
    update({ [k]: hex, ...(k !== 'accent' && (d.mode ?? 'system') === 'system' ? { mode: resolved } : {}) } as Partial<Look>)
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
      toast.success('Theme loaded. Save it to keep it.')
    } catch {
      toast.error('That file isn’t a theme.')
    }
  }

  const save = async () => {
    setBusy(true)
    try {
      await onSave(normalizeLook(draft))
      toast.success('Theme saved.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Couldn’t save the theme.')
    } finally {
      setBusy(false)
    }
  }

  const matched = !!d.sidebarMatchContent

  return (
    <div className="relative">
      <div className="flex flex-wrap items-start gap-5 pb-24">
        <div className="flex min-w-0 flex-[3_1_30rem] flex-col gap-5">
          {intro}

          <Card
            title="Theme"
            desc="Start from a preset, then change anything below."
            action={d.preset === 'custom' && <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold tracking-wide text-primary uppercase">Custom</span>}
          >
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
                        <span className="h-2 w-2/5 rounded-sm" style={{ background: pc.accent }} />
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
            <div className="mt-4 border-t border-border pt-4">
              <Row label="Mode" hint="Each app’s own light or dark surfaces. Your accent and sizes stay.">
                <Segmented<Mode>
                  label="Mode"
                  value={d.mode ?? 'system'}
                  options={[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]}
                  onChange={(m) => setDraft(normalizeLook(withMode(d, m)))}
                />
              </Row>
            </div>
          </Card>

          <Card
            title="Colors"
            desc="Every surface you see, set on its own. A color you leave on Default is each app’s own."
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
                    onClick={() => setColor('accent', hex)}
                    className="size-8 rounded-full border-2 shadow-[inset_0_0_0_2px_var(--color-card)]"
                    style={{ background: hex, borderColor: c.accent === hex ? 'var(--color-foreground)' : 'transparent' }}
                  />
                ))}
              </div>
              {colorRow('accent')}
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
          </Card>

          <Card
            title="Size & type"
            desc="Text, spacing, corners and the sidebar’s width."
            action={
              Object.keys(sizesOf(d)).length > 0 && (
                <Button variant="outline" size="sm" onClick={() => update({ font: undefined, textSize: undefined, density: undefined, radius: undefined, sidebarWidth: undefined, contentWidth: undefined }, false)}>
                  <RotateCcw /> Default sizes
                </Button>
              )
            }
          >
            <Row label="Interface font">
              <Segmented<Font> label="Interface font" value={d.font ?? 'system'} options={[['system', 'System'], ['inter', 'Inter'], ['plex', 'IBM Plex']]} onChange={(font) => update({ font }, false)} />
            </Row>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-x-6 gap-y-4 border-t border-border py-4">
              <Slider id="ap-text" label="Text size" value={d.textSize ?? defaults.textSize} isSet={d.textSize !== undefined} min={LIMITS.textSize[0]} max={LIMITS.textSize[1]} ends={['Small', 'Large']} onChange={(textSize) => update({ textSize }, false)} />
              <Slider id="ap-radius" label="Corner radius" value={d.radius ?? defaults.radius} isSet={d.radius !== undefined} min={LIMITS.radius[0]} max={LIMITS.radius[1]} ends={['Square', 'Round']} onChange={(radius) => update({ radius }, false)} />
              <Slider id="ap-sidebar" label="Sidebar width" value={d.sidebarWidth ?? defaults.sidebarWidth} isSet={d.sidebarWidth !== undefined} min={LIMITS.sidebarWidth[0]} max={LIMITS.sidebarWidth[1]} step={4} ends={['Narrow', 'Wide']} onChange={(sidebarWidth) => update({ sidebarWidth }, false)} />
              <div className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium">Density</span>
                <Segmented<Density> label="Density" value={d.density ?? 'comfortable'} options={[['comfortable', 'Comfortable'], ['compact', 'Compact'], ['condensed', 'Condensed']]} onChange={(density) => update({ density }, false)} />
              </div>
            </div>
            <Row label="Content width" hint="How wide pages grow on a large screen.">
              <Segmented<ContentWidth> label="Content width" value={d.contentWidth ?? 'default'} options={[['narrow', 'Narrow'], ['default', 'Default'], ['full', 'Full']]} onChange={(contentWidth) => update({ contentWidth }, false)} />
            </Row>
          </Card>

          <Card
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
              <p className="text-[12px] text-faint">Switch Colors to Advanced to see the file.</p>
            )}
          </Card>
        </div>

        <aside aria-label="Preview" className="flex min-w-0 flex-[2_1_20rem] flex-col gap-5">
          <Card title="Preview" desc="The sidebar beside the content, in this theme.">
            <MiniApp c={c} radius={d.radius ?? defaults.radius} />
          </Card>
          <Card title="Readability" desc="Checked against WCAG as you pick.">
            {low && (
              <div role="status" className="mb-3 rounded-lg bg-warning/15 px-3 py-2 text-[12px]">
                {low.label} is {low.ratio.toFixed(1)}:1. Aim for {low.min}:1 or more so it stays readable.
              </div>
            )}
            <ul>
              {checks.map((x) => (
                <li key={x.label} className="flex items-center gap-3 border-t border-border py-2 text-[12px] first:border-t-0">
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
          </Card>
        </aside>
      </div>

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-3 rounded-t-xl border border-b-0 border-border bg-card px-4 py-3 shadow-[0_-8px_24px_rgba(0,0,0,0.12)]">
        <span className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <span className={`size-2 rounded-full ${dirty ? 'bg-warning' : 'bg-success'}`} />
          {dirty ? 'Unsaved changes. You’re seeing them live; nothing is stored until you save.' : savedNote}
        </span>
        <div className="flex gap-2">
          <Button variant="outline" disabled={!dirty || busy} onClick={() => setDraft(saved)}>
            Discard
          </Button>
          <Button disabled={!dirty || busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save theme'}
          </Button>
        </div>
      </div>
    </div>
  )
}
