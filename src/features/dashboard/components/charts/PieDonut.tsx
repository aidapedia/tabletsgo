import { useState } from 'react'
import type { PieDatum } from '../../lib/queryData'
import type { ChartPalette } from '../../lib/palette'
import { useSize } from '../../lib/useSize'
import { ChartTip, fmtNum, useMountAnimation } from './chrome'

// Donut chart in plain SVG with a legend (name + percent) beside it and a
// per-slice hover tooltip. Slices are separated by a 2px surface-colored gap.
export default function PieDonut({ data, palette }: { data: PieDatum[]; palette: ChartPalette }) {
  const { ref, width, height } = useSize<HTMLDivElement>()
  const [hover, setHover] = useState<{ index: number; px: number; py: number } | null>(null)
  // Slices scale/fade in from the donut's center, staggered by index.
  const ready = useMountAnimation(data)

  if (!width || !height || !data.length) return <div ref={ref} className="h-full w-full" />

  const total = data.reduce((s, d) => s + d.value, 0)
  const legendW = Math.min(150, width * 0.45)
  const size = Math.min(width - legendW, height)
  const cx = size / 2
  const cy = height / 2
  const R = (size / 2) * 0.92
  const r = R * 0.58

  let angle = -Math.PI / 2
  const slices = data.map((d, i) => {
    const sweep = total ? (d.value / total) * Math.PI * 2 : 0
    const s = { d, i, start: angle, end: angle + sweep }
    angle += sweep
    return s
  })

  const arc = (start: number, end: number) => {
    // Cap at a hair under a full turn so a single slice still renders.
    if (end - start >= Math.PI * 2 - 1e-4) end = start + Math.PI * 2 - 1e-4
    const large = end - start > Math.PI ? 1 : 0
    const x0 = cx + R * Math.cos(start)
    const y0 = cy + R * Math.sin(start)
    const x1 = cx + R * Math.cos(end)
    const y1 = cy + R * Math.sin(end)
    const xi = cx + r * Math.cos(end)
    const yi = cy + r * Math.sin(end)
    const xj = cx + r * Math.cos(start)
    const yj = cy + r * Math.sin(start)
    return `M${x0},${y0} A${R},${R} 0 ${large} 1 ${x1},${y1} L${xi},${yi} A${r},${r} 0 ${large} 0 ${xj},${yj} Z`
  }

  const color = (d: PieDatum, i: number) => (d.name === 'Other' ? palette.inkMuted : palette.series[i])

  const onMove = (index: number) => (e: React.MouseEvent) => {
    const rect = (e.currentTarget as SVGElement).closest('div')!.getBoundingClientRect()
    setHover({ index, px: e.clientX - rect.left, py: e.clientY - rect.top })
  }

  return (
    <div ref={ref} className="relative flex h-full w-full items-center">
      <svg width={size} height={height} className="shrink-0">
        {slices.map((s) => (
          <path
            key={s.i}
            d={arc(s.start, s.end)}
            fill={color(s.d, s.i)}
            stroke="var(--color-card)"
            strokeWidth={2}
            style={{
              opacity: ready ? (hover && hover.index !== s.i ? 0.45 : 1) : 0,
              transform: ready ? 'scale(1)' : 'scale(0.85)',
              transformOrigin: `${cx}px ${cy}px`,
              transition: `transform 420ms cubic-bezier(0.22,1,0.36,1) ${s.i * 45}ms, opacity 320ms ease ${s.i * 45}ms`,
            }}
            onMouseMove={onMove(s.i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </svg>

      <div className="min-w-0 flex-1 space-y-1 overflow-y-auto pr-1">
        {data.map((d, i) => (
          <div
            key={`${d.name}-${i}`}
            className="flex items-center gap-1.5 text-[10px] text-ink-dim"
            style={{
              opacity: ready ? 1 : 0,
              transform: ready ? 'translateX(0)' : 'translateX(-4px)',
              transition: `opacity 320ms ease ${i * 45}ms, transform 320ms cubic-bezier(0.22,1,0.36,1) ${i * 45}ms`,
            }}
          >
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color(d, i) }} />
            <span className="min-w-0 flex-1 truncate">{d.name}</span>
            <span className="shrink-0 tabular-nums">{total ? Math.round((d.value / total) * 100) : 0}%</span>
          </div>
        ))}
      </div>

      {hover && (
        <ChartTip
          x={hover.px}
          y={hover.py}
          width={width}
          rows={[{ color: color(data[hover.index], hover.index), name: data[hover.index].name, value: fmtNum(data[hover.index].value) }]}
        />
      )}
    </div>
  )
}
