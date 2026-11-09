import Popover from '@/shared/ui/overlay/Popover'
import { CloseIcon } from '@/shared/ui/icons'
import { THRESHOLD_TONES } from '../types'
import { swatchLook } from '../lib/thresholds'

// Preset swatches offered by the color picker (a fixed, curated set — not the
// chart palette itself, so users can pick outside the validated series colors).
const PRESET_COLORS = [
  '#8e8e93', '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#30b0c7',
  '#55b6f2', '#007aff', '#5856d6', '#af52de', '#bf5af2', '#ff2d55', '#ff375f',
]

const TONE_LABEL: Record<string, string> = { neutral: 'Neutral', green: 'Green', amber: 'Amber', red: 'Red' }

// Swatch button that opens a small preset-color grid, closer to a native
// system color picker than the browser's <input type="color"> dialog. With
// `tones`, the theme tones (which follow light/dark) are offered first.
export default function ColorSwatch({
  color,
  onChange,
  tones = false,
}: {
  color: string
  onChange: (c: string) => void
  tones?: boolean
}) {
  const current = swatchLook(color)
  return (
    <Popover
      portal
      width={300}
      trigger={({ toggle }) => (
        <button
          type="button"
          aria-label="Pick color"
          onClick={toggle}
          className={`h-5 w-5 shrink-0 rounded-full border border-input ${current.className}`}
          style={current.style}
        />
      )}
    >
      {({ close }) => {
        const pick = (c: string) => {
          onChange(c)
          close()
        }
        return (
          <div className="p-2.5">
            {tones && (
              <>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {THRESHOLD_TONES.map((t) => {
                    const look = swatchLook(t)
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => pick(t)}
                        className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground ${
                          color === t ? 'border-input bg-muted' : 'border-border'
                        }`}
                      >
                        <span className={`h-3 w-3 rounded-full ${look.className}`} />
                        {TONE_LABEL[t]}
                      </button>
                    )
                  })}
                </div>
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-faint">Custom</div>
              </>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                aria-label="Close"
                onClick={close}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-faint hover:text-foreground"
              >
                <CloseIcon width={12} height={12} />
              </button>
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  onClick={() => pick(c)}
                  className={`h-7 w-7 rounded-full border border-black/10 ${color === c ? 'ring-2 ring-primary' : ''}`}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>
        )
      }}
    </Popover>
  )
}
