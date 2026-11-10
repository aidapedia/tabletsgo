import { useId, useMemo, useState } from 'react'
import type { XYSeries } from '../../lib/queryData'
import type { ChartPalette } from '../../lib/palette'
import { niceScale, fmtTick } from '../../lib/scale'
import { useSize } from '../../lib/useSize'
import { ChartTip, Legend, fmtNum, useMountAnimation } from './chrome'

const PAD = { top: 10, right: 12, bottom: 20, left: 8 }
const Y_LABEL_W = 34

// Area / line / grouped-bar chart in plain SVG: recessive horizontal grid,
// thin marks, and a crosshair hover tooltip listing every series at the
// hovered x (per-band highlight for bars).
export default function XYChart({
  kind,
  series,
  palette,
}: {
  kind: 'area' | 'line' | 'bar'
  series: XYSeries
  palette: ChartPalette
}) {
  const { ref, width, height } = useSize<HTMLDivElement>()
  const [hover, setHover] = useState<{ index: number; px: number; py: number } | null>(null)
  const { data, xKey, seriesKeys } = series
  const n = data.length
  const uid = useId()
  // Bars grow up from the baseline; lines/areas sweep in left-to-right. Re-runs
  // whenever `data` is a new array (a fresh query result), not on hover re-renders.
  const ready = useMountAnimation(data)

  const scale = useMemo(() => {
    let min = 0
    let max = 0
    for (const d of data) {
      for (const k of seriesKeys) {
        const v = d[k]
        if (typeof v === 'number') {
          if (v < min) min = v
          if (v > max) max = v
        }
      }
    }
    return niceScale(min, max, 4)
  }, [data, seriesKeys])

  const legend = seriesKeys.length >= 2
  const legendH = legend ? 20 : 0
  const plotW = Math.max(0, width - PAD.left - Y_LABEL_W - PAD.right)
  const plotH = Math.max(0, height - PAD.top - PAD.bottom - legendH)
  const left = PAD.left + Y_LABEL_W
  const y = (v: number) => PAD.top + plotH * (1 - (v - scale.lo) / (scale.hi - scale.lo))
  // Point-scale for line/area, band-scale for bars.
  const band = n ? plotW / n : 0
  const px = (i: number) => (kind === 'bar' ? left + i * band + band / 2 : left + (n > 1 ? (i * plotW) / (n - 1) : plotW / 2))

  if (!width || !height || !n) return <div ref={ref} className="h-full w-full" />

  // ~5 x labels, always including first and last.
  const labelStep = Math.max(1, Math.ceil(n / 5))
  const xLabels = data.map((d, i) => ({ i, text: String(d[xKey]) })).filter(({ i }) => i % labelStep === 0 || i === n - 1)

  const onMove = (e: React.MouseEvent) => {
    const rect = (e.currentTarget as SVGElement).closest('div')!.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    let index: number
    if (kind === 'bar') index = Math.min(n - 1, Math.max(0, Math.floor((mx - left) / (band || 1))))
    else index = Math.min(n - 1, Math.max(0, Math.round(((mx - left) / (plotW || 1)) * (n - 1))))
    setHover({ index, px: mx, py: my })
  }

  const groupW = band * 0.72
  const barW = seriesKeys.length ? Math.max(2, (groupW - 2 * (seriesKeys.length - 1)) / seriesKeys.length) : 0
  const y0 = y(Math.max(0, scale.lo)) // baseline (zero when the range spans it)

  return (
    <div ref={ref} className="relative h-full w-full">
      <svg width={width} height={height - legendH} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {/* Grid + y labels */}
        {scale.ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={left + plotW} y1={y(t)} y2={y(t)} stroke={palette.grid} strokeWidth={1} />
            <text x={left - 6} y={y(t) + 3} textAnchor="end" fontSize={9} fill={palette.inkMuted}>
              {fmtTick(t)}
            </text>
          </g>
        ))}
        {/* Baseline */}
        <line x1={left} x2={left + plotW} y1={y0} y2={y0} stroke={palette.axis} strokeWidth={1} />

        {/* Hover highlight */}
        {hover &&
          (kind === 'bar' ? (
            <rect x={left + hover.index * band} y={PAD.top} width={band} height={plotH} fill={palette.ink} opacity={0.05} />
          ) : (
            <line x1={px(hover.index)} x2={px(hover.index)} y1={PAD.top} y2={PAD.top + plotH} stroke={palette.inkMuted} strokeWidth={1} strokeDasharray="3 3" />
          ))}

        {/* Marks */}
        {seriesKeys.map((key, si) => {
          const color = palette.series[si]
          if (kind === 'bar') {
            return (
              <g key={key}>
                {data.map((d, i) => {
                  const v = d[key]
                  if (typeof v !== 'number') return null
                  const bx = left + i * band + (band - groupW) / 2 + si * (barW + 2)
                  const top = Math.min(y(v), y0)
                  const h = Math.abs(y(v) - y0)
                  // 4px rounded data-end anchored to the baseline.
                  const r = Math.min(4, barW / 2, h)
                  const up = v >= 0
                  const path = up
                    ? `M${bx},${top + h} V${top + r} Q${bx},${top} ${bx + r},${top} H${bx + barW - r} Q${bx + barW},${top} ${bx + barW},${top + r} V${top + h} Z`
                    : `M${bx},${top} V${top + h - r} Q${bx},${top + h} ${bx + r},${top + h} H${bx + barW - r} Q${bx + barW},${top + h} ${bx + barW},${top + h - r} V${top} Z`
                  return (
                    <path
                      key={i}
                      d={path}
                      fill={color}
                      style={{
                        transform: ready ? 'scaleY(1)' : 'scaleY(0)',
                        transformOrigin: `${bx + barW / 2}px ${y0}px`,
                        transition: `transform 480ms cubic-bezier(0.22,1,0.36,1) ${si * 50}ms`,
                      }}
                    />
                  )
                })}
              </g>
            )
          }
          const pts = data
            .map((d, i) => (typeof d[key] === 'number' ? `${px(i)},${y(d[key] as number)}` : null))
            .filter(Boolean)
          if (!pts.length) return null
          const line = `M${pts.join(' L')}`
          const clipId = `${uid}-xy-clip-${si}`
          return (
            <g key={key}>
              <clipPath id={clipId}>
                <rect
                  x={left}
                  y={0}
                  width={ready ? plotW : 0}
                  height={height}
                  style={{ transition: `width 650ms cubic-bezier(0.16,1,0.3,1) ${si * 90}ms` }}
                />
              </clipPath>
              <g clipPath={`url(#${clipId})`}>
                {kind === 'area' && (
                  <path d={`${line} L${px(n - 1)},${y0} L${px(0)},${y0} Z`} fill={color} opacity={0.14} />
                )}
                <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {hover && typeof data[hover.index][key] === 'number' && (
                  <circle cx={px(hover.index)} cy={y(data[hover.index][key] as number)} r={3.5} fill={color} stroke={palette.tooltipBg} strokeWidth={2} />
                )}
              </g>
            </g>
          )
        })}

        {/* X labels */}
        {xLabels.map(({ i, text }) => (
          <text key={i} x={px(i)} y={PAD.top + plotH + 13} textAnchor="middle" fontSize={9} fill={palette.inkMuted}>
            {text.length > 12 ? `${text.slice(0, 11)}…` : text}
          </text>
        ))}
      </svg>

      {legend && <Legend items={seriesKeys.map((k, i) => ({ color: palette.series[i], label: k }))} />}

      {hover && (
        <ChartTip
          x={hover.px}
          y={hover.py}
          width={width}
          title={String(data[hover.index][xKey])}
          rows={seriesKeys.map((k, i) => ({
            color: palette.series[i],
            name: k,
            value: fmtNum(data[hover.index][k]),
          }))}
        />
      )}
    </div>
  )
}
