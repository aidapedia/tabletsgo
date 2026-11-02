// How cell values read in `table` columns and `metric` tiles. Pure and
// engine-agnostic: a value is whatever /query returned, so numbers may arrive
// as strings (PostgreSQL bigint/numeric) and lists as arrays or "1,2,3".

import type { NumberFormat } from '../types'

export const toNumber = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']

/** A number written the chosen way; anything that isn't a number comes back as text. */
export function formatNumber(v: unknown, format: NumberFormat = 'number', decimals?: number): string {
  const n = toNumber(v)
  if (n === null) return v === null || v === undefined ? '—' : String(v)
  if (format === 'compact') {
    return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: decimals ?? 1 }).format(n)
  }
  if (format === 'bytes') {
    let i = 0
    let x = Math.abs(n)
    while (x >= 1024 && i < BYTE_UNITS.length - 1) {
      x /= 1024
      i++
    }
    return `${(Math.sign(n) * x).toFixed(i === 0 ? 0 : decimals ?? 1)} ${BYTE_UNITS[i]}`
  }
  if (decimals !== undefined) return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

/** A cell holding a list — an array, or comma-separated text — as its items. */
export function toList(v: unknown): string[] {
  if (v === null || v === undefined || v === '') return []
  if (Array.isArray(v)) return v.map(String)
  return String(v)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Is a cell "set" for counting — not empty, not false, not zero. */
export function isTruthy(v: unknown): boolean {
  if (v === null || v === undefined || v === '' || v === false) return false
  if (typeof v === 'string' && /^(false|f|no|0)$/i.test(v.trim())) return false
  return toNumber(v) !== 0
}
