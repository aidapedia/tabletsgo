import type { ReactNode } from 'react'
import EmptyState from '@/shared/ui/feedback/EmptyState'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import { ChevronDown } from '@/shared/ui/icons'
import Pagination from './Pagination'

/**
 * The shared table view: a bordered card with a sticky-styled header row,
 * optional column sorting and an optional pagination footer.
 *
 * Presentational on purpose — it renders exactly the rows it's handed and
 * reports sort/page intent. Pair it with `useDataTable` for client-side
 * sorting + paging, or wire the same props to a server-paged endpoint.
 *
 *   const table = useDataTable({ rows: filtered, columns, pageSize: 10 })
 *   <DataTable columns={columns} rowKey={(r) => r.id} onRowClick={open} {...table} />
 *
 * A column renders `render(row)` when given, otherwise `row[key]`. Sorting uses
 * `sortValue(row)` when given, otherwise the same raw field.
 */
export type Sort = { key: string; dir: 'asc' | 'desc' }

export type Column<T> = {
  key: string
  header: ReactNode
  render?: (row: T) => ReactNode
  sortable?: boolean
  sortValue?: (row: T) => string | number | boolean | null | undefined
  align?: 'left' | 'center' | 'right'
  width?: string | number
  /**
   * Applied to both the header and body cells of this column — e.g. 'font-mono'
   * or a static responsive class like 'max-[900px]:hidden' to drop the column on
   * narrow screens (keep it a literal string so Tailwind can see it).
   */
  className?: string
}

export type DataTableProps<T> = {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  onRowClick?: (row: T) => void
  rowClassName?: (row: T) => string
  sort?: Sort | null
  onSortChange?: (sort: Sort | null) => void
  loading?: boolean
  empty?: ReactNode
  /** Pagination footer — rendered when `onPageChange` is given. */
  page?: number
  pageCount?: number
  total?: number
  pageSize?: number
  pageSizeOptions?: number[]
  onPageChange?: (page: number) => void
  onPageSizeChange?: (size: number) => void
  className?: string
}

const ALIGN = { left: 'text-left', center: 'text-center', right: 'text-right' }

// asc → desc → unsorted, so a column can always be switched back off.
function nextSort(sort: Sort | null | undefined, key: string): Sort | null {
  if (sort?.key !== key) return { key, dir: 'asc' }
  if (sort.dir === 'asc') return { key, dir: 'desc' }
  return null
}

export default function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  rowClassName,
  sort = null,
  onSortChange,
  loading = false,
  empty = 'No records found.',
  page,
  pageCount,
  total,
  pageSize,
  pageSizeOptions,
  onPageChange,
  onPageSizeChange,
  className = '',
}: DataTableProps<T>) {
  // Nothing to page through on an empty/loading table — the footer would just
  // read "0–0 of 0".
  const showPager = !!onPageChange && page != null && pageCount != null && (total ?? rows.length) > 0

  return (
    // The card itself must not clip (the footer's rows-per-page menu drops out
    // of it); the scrolling table area does the corner clipping instead.
    <div className={`rounded-card border border-edge bg-card ${className}`}>
      <div className={`overflow-x-auto ${showPager ? 'rounded-t-card' : 'rounded-card'}`}>
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-edge bg-elevated/40">
              {columns.map((col) => {
                const sorted = sort?.key === col.key
                const align = ALIGN[col.align || 'left']
                return (
                  <th
                    key={col.key}
                    scope="col"
                    style={col.width ? { width: col.width } : undefined}
                    className={`px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-dim ${align} ${col.className || ''}`}
                  >
                    {col.sortable && onSortChange ? (
                      <button
                        type="button"
                        onClick={() => onSortChange(nextSort(sort, col.key))}
                        className={`group inline-flex items-center gap-1 transition-colors hover:text-ink ${
                          sorted ? 'text-ink' : ''
                        }`}
                      >
                        {col.header}
                        <ChevronDown
                          width={12}
                          height={12}
                          className={`transition-transform ${
                            sorted ? (sort!.dir === 'asc' ? 'rotate-180' : '') : 'opacity-0 group-hover:opacity-40'
                          }`}
                        />
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`border-b border-edge/60 last:border-b-0 transition-colors ${
                  onRowClick ? 'cursor-pointer hover:bg-card-hover' : ''
                } ${rowClassName?.(row) || ''}`}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-4 py-3 align-middle ${ALIGN[col.align || 'left']} ${col.className || ''}`}
                  >
                    {col.render ? col.render(row) : ((row as any)[col.key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {loading && <LoadingState className="py-10 text-center" />}
      {!loading && rows.length === 0 && <EmptyState className="py-12">{empty}</EmptyState>}

      {showPager && (
        <Pagination
          className="border-t border-edge"
          page={page!}
          pageCount={pageCount!}
          total={total ?? rows.length}
          pageSize={pageSize ?? rows.length}
          pageSizeOptions={pageSizeOptions}
          onPageChange={onPageChange!}
          onPageSizeChange={onPageSizeChange}
        />
      )}
    </div>
  )
}
