// Tiny linear-scale helper for the hand-rolled SVG charts: expand a data
// extent to "nice" rounded bounds and produce ~`count` tick values.

export type NiceScale = { lo: number; hi: number; ticks: number[] }

export function niceScale(min: number, max: number, count = 4): NiceScale {
  // Charts with a baseline (bar/area) always include zero.
  let lo = Math.min(0, min)
  let hi = Math.max(0, max)
  if (lo === hi) hi = lo + 1
  const span = hi - lo
  const step = niceStep(span / Math.max(1, count))
  lo = Math.floor(lo / step) * step
  hi = Math.ceil(hi / step) * step
  const ticks: number[] = []
  // Float-drift guard on the loop bound.
  for (let v = lo; v <= hi + step / 1e6; v += step) ticks.push(round(v))
  return { lo, hi: round(hi), ticks }
}

function niceStep(rough: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(rough)))
  const frac = rough / pow
  const nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10
  return nice * pow
}

const round = (v: number) => Number(v.toPrecision(12))

export const fmtTick = (v: number): string => {
  const abs = Math.abs(v)
  if (abs >= 1e9) return `${round(v / 1e9)}B`
  if (abs >= 1e6) return `${round(v / 1e6)}M`
  if (abs >= 1e3) return `${round(v / 1e3)}k`
  return String(round(v))
}
