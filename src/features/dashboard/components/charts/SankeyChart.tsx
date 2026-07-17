import { useMemo, useState } from 'react'
import type { SankeyData } from '../../lib/queryData'
import type { ChartPalette } from '../../lib/palette'
import { useSize } from '../../lib/useSize'
import { ChartTip, fmtNum, useMountAnimation } from './chrome'

const NODE_W = 10
const NODE_GAP = 14
const PAD = { top: 8, right: 8, bottom: 8, left: 8 }
const LABEL_W = 80

type LaidNode = { name: string; depth: number; x: number; y: number; h: number; value: number; color: string }
type LaidLink = { source: number; target: number; value: number; sy: number; ty: number; h: number; path: string }

// Sankey diagram in plain SVG. Node depth = longest path from a source;
// heights share one global value scale so widths are comparable across
// columns. Links render as tapered bezier ribbons in the source node's color.
function layout(data: SankeyData, width: number, height: number, palette: ChartPalette) {
  const n = data.nodes.length
  const depth = new Array(n).fill(0)
  // Longest-path relaxation; the pass cap guards against cyclic data.
  for (let pass = 0; pass < n; pass++) {
    let changed = false
    for (const l of data.links) {
      if (depth[l.target] < depth[l.source] + 1) {
        depth[l.target] = depth[l.source] + 1
        changed = true
      }
    }
    if (!changed) break
  }
  const maxDepth = Math.max(...depth, 0)

  const inSum = new Array(n).fill(0)
  const outSum = new Array(n).fill(0)
  for (const l of data.links) {
    outSum[l.source] += l.value
    inSum[l.target] += l.value
  }
  const value = (i: number) => Math.max(inSum[i], outSum[i])

  const columns: number[][] = Array.from({ length: maxDepth + 1 }, () => [])
  data.nodes.forEach((_, i) => columns[depth[i]].push(i))

  const plotH = height - PAD.top - PAD.bottom
  const plotW = width - PAD.left - PAD.right - LABEL_W
  // One global px-per-value scale, limited by the tightest column.
  let k = Infinity
  for (const col of columns) {
    const total = col.reduce((s, i) => s + value(i), 0)
    const avail = plotH - (col.length - 1) * NODE_GAP
    if (total > 0) k = Math.min(k, avail / total)
  }
  if (!Number.isFinite(k) || k <= 0) k = 1

  const nodes: LaidNode[] = new Array(n)
  columns.forEach((col, d) => {
    col.sort((a, b) => value(b) - value(a))
    const colH = col.reduce((s, i) => s + value(i) * k, 0) + (col.length - 1) * NODE_GAP
    let y = PAD.top + Math.max(0, (plotH - colH) / 2)
    const x = PAD.left + (maxDepth > 0 ? (d * plotW) / maxDepth : 0)
    for (const i of col) {
      const h = Math.max(2, value(i) * k)
      nodes[i] = { name: data.nodes[i].name, depth: d, x, y, h, value: value(i), color: palette.series[d % palette.series.length] }
      y += h + NODE_GAP
    }
  })

  // Stack link offsets on both ends, ordered by the far end's y to reduce crossings.
  const sOff = new Array(n).fill(0)
  const tOff = new Array(n).fill(0)
  const links: LaidLink[] = [...data.links]
    .sort((a, b) => nodes[a.target].y - nodes[b.target].y || nodes[a.source].y - nodes[b.source].y)
    .map((l) => {
      const h = Math.max(1, l.value * k)
      const s = nodes[l.source]
      const t = nodes[l.target]
      const sy = s.y + sOff[l.source] + h / 2
      const ty = t.y + tOff[l.target] + h / 2
      sOff[l.source] += h
      tOff[l.target] += h
      const x0 = s.x + NODE_W
      const x1 = t.x
      const mx = (x0 + x1) / 2
      return { ...l, sy, ty, h, path: `M${x0},${sy} C${mx},${sy} ${mx},${ty} ${x1},${ty}` }
    })

  return { nodes, links }
}

export default function SankeyChart({ data, palette }: { data: SankeyData; palette: ChartPalette }) {
  const { ref, width, height } = useSize<HTMLDivElement>()
  const [hover, setHover] = useState<{ px: number; py: number; title?: string; rows: any[] } | null>(null)
  // Nodes/links fade in column by column (staggered by depth).
  const ready = useMountAnimation(data)

  const laid = useMemo(
    () => (width && height ? layout(data, width, height, palette) : null),
    [data, width, height, palette]
  )
  if (!laid) return <div ref={ref} className="h-full w-full" />

  const tip = (e: React.MouseEvent, title: string | undefined, rows: any[]) => {
    const rect = (e.currentTarget as SVGElement).closest('div')!.getBoundingClientRect()
    setHover({ px: e.clientX - rect.left, py: e.clientY - rect.top, title, rows })
  }

  return (
    <div ref={ref} className="relative h-full w-full">
      <svg width={width} height={height} onMouseLeave={() => setHover(null)}>
        {laid.links.map((l, i) => (
          <path
            key={i}
            d={l.path}
            fill="none"
            stroke={laid.nodes[l.source].color}
            strokeWidth={l.h}
            style={{
              opacity: ready ? 0.25 : 0,
              transition: `opacity 420ms ease ${laid.nodes[l.source].depth * 90}ms`,
            }}
            onMouseMove={(e) =>
              tip(e, `${laid.nodes[l.source].name} → ${laid.nodes[l.target].name}`, [
                { color: laid.nodes[l.source].color, name: 'flow', value: fmtNum(l.value) },
              ])
            }
            onMouseLeave={() => setHover(null)}
          />
        ))}
        {laid.nodes.map((nd, i) => (
          <g
            key={i}
            style={{
              opacity: ready ? 1 : 0,
              transform: ready ? 'translateX(0px)' : 'translateX(-6px)',
              transition: `opacity 380ms ease ${nd.depth * 90}ms, transform 380ms cubic-bezier(0.22,1,0.36,1) ${nd.depth * 90}ms`,
            }}
          >
            <rect
              x={nd.x}
              y={nd.y}
              width={NODE_W}
              height={nd.h}
              rx={2}
              fill={nd.color}
              onMouseMove={(e) => tip(e, nd.name, [{ color: nd.color, name: 'total', value: fmtNum(nd.value) }])}
              onMouseLeave={() => setHover(null)}
            />
            <text
              x={nd.x + NODE_W + 5}
              y={nd.y + nd.h / 2 + 3}
              fontSize={9.5}
              fill="var(--color-ink-dim)"
            >
              {nd.name.length > 16 ? `${nd.name.slice(0, 15)}…` : nd.name}
            </text>
          </g>
        ))}
      </svg>
      {hover && <ChartTip x={hover.px} y={hover.py} width={width} title={hover.title} rows={hover.rows} />}
    </div>
  )
}
