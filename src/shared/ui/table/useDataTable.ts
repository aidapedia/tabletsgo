import { useMemo, useState } from 'react'
import type { Column, Sort } from './DataTable'

/**
 * Client-side sorting + pagination state for `DataTable`.
 *
 * Keeps the table presentational: this hook owns the state and hands back
 * exactly the props `DataTable` expects, so a caller spreads it in:
 *
 *   const table = useDataTable({ rows: filtered, columns, pageSize: 10, resetKey: filterKey })
 *   <DataTable columns={columns} rowKey={(r) => r.id} {...table} />
 *
 * `resetKey` is any value describing the current filters — when it changes the
 * table jumps back to page 1 (otherwise you'd land on an empty page 4).
 * For server-side paging, skip the hook and pass the props yourself.
 */
export type UseDataTableOptions<T> = {
  rows: T[]
  columns?: Column<T>[]
  pageSize?: number
  initialSort?: Sort | null
  resetKey?: unknown
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function compare(a: unknown, b: unknown) {
  if (a == null && b == null) return 0
  if (a == null) return 1 // nulls last, regardless of direction
  if (b == null) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  return collator.compare(String(a), String(b))
}

export default function useDataTable<T>({
  rows,
  columns = [],
  pageSize: initialPageSize = 10,
  initialSort = null,
  resetKey,
}: UseDataTableOptions<T>) {
  const [sort, setSort] = useState<Sort | null>(initialSort)
  const [pageSize, setPageSize] = useState(initialPageSize)
  const [page, setPage] = useState(1)
  const [lastReset, setLastReset] = useState(resetKey)

  // Filters changed ⇒ back to page 1. Done during render (not in an effect) so
  // the table never paints one frame of the stale page.
  if (resetKey !== lastReset) {
    setLastReset(resetKey)
    setPage(1)
  }

  const sorted = useMemo(() => {
    if (!sort) return rows
    const col = columns.find((c) => c.key === sort.key)
    const value = (row: T) => (col?.sortValue ? col.sortValue(row) : (row as any)[sort.key])
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => compare(value(a), value(b)) * dir)
  }, [rows, columns, sort])

  const total = sorted.length
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const current = Math.min(page, pageCount) // stays valid when the row set shrinks
  const pageRows = useMemo(
    () => sorted.slice((current - 1) * pageSize, current * pageSize),
    [sorted, current, pageSize],
  )

  return {
    rows: pageRows,
    sort,
    onSortChange: setSort,
    page: current,
    pageCount,
    total,
    pageSize,
    onPageChange: setPage,
    onPageSizeChange: (n: number) => {
      setPageSize(n)
      setPage(1)
    },
  }
}
