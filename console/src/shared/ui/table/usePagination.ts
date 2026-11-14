import { useMemo, useState } from 'react'
import type { PaginationProps } from './Pagination'

/**
 * Client-side paging for any list — the hand-rolled tables and grids that
 * aren't a `DataTable` (that one pages through `useDataTable`).
 *
 *   const { pageRows, offset, pager } = usePagination(rows, { pageSize: 25, resetKey: topic })
 *   …render pageRows… <Pagination {...pager} />
 *
 * `resetKey` is any value that means "a different list" — when it changes the
 * pager goes back to page 1. Leave it out for a list that only refreshes (a
 * panel polled every 10 s keeps its page). The page is clamped when the list
 * shrinks, so it never lands past the end.
 *
 * `offset` is the index of `pageRows[0]` in `rows`, for anything that needs a
 * row's position in the whole list rather than on the page.
 */
export type UsePaginationOptions = {
  pageSize?: number
  pageSizeOptions?: number[]
  resetKey?: unknown
}

export default function usePagination<T>(rows: T[], { pageSize: initialPageSize = 25, pageSizeOptions, resetKey }: UsePaginationOptions = {}) {
  const [pageSize, setPageSize] = useState(initialPageSize)
  const [page, setPage] = useState(1)
  const [lastReset, setLastReset] = useState(resetKey)

  // A different list ⇒ page 1. Done during render (not in an effect) so the
  // stale page never paints.
  if (resetKey !== lastReset) {
    setLastReset(resetKey)
    setPage(1)
  }

  const total = rows.length
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const current = Math.min(page, pageCount)
  const offset = (current - 1) * pageSize
  const pageRows = useMemo(() => rows.slice(offset, offset + pageSize), [rows, offset, pageSize])

  const pager: PaginationProps = {
    page: current,
    pageCount,
    total,
    pageSize,
    pageSizeOptions,
    onPageChange: setPage,
    onPageSizeChange: (n: number) => {
      setPageSize(n)
      setPage(1)
    },
  }

  return { pageRows, offset, pager }
}
