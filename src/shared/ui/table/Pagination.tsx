import IconButton from '@/shared/ui/buttons/IconButton'
import Select from '@/shared/ui/form/Select'
import { ChevronLeft, ChevronRight } from '@/shared/ui/icons'

/**
 * Pagination footer: "1–10 of 42", rows-per-page picker and page controls.
 * Used by `DataTable` but standalone-usable under any list.
 *
 * Purely controlled — it renders the numbers it's given and reports clicks.
 */
export type PaginationProps = {
  page: number
  pageCount: number
  total: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange?: (size: number) => void
  pageSizeOptions?: number[]
  className?: string
}

// Page numbers around the current one, with '…' gaps: 1 … 4 [5] 6 … 20.
function pageItems(page: number, pageCount: number): (number | 'gap')[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1)
  const around = [page - 1, page, page + 1].filter((p) => p > 1 && p < pageCount)
  const items: (number | 'gap')[] = [1]
  if (around[0] > 2) items.push('gap')
  items.push(...around)
  if (around[around.length - 1] < pageCount - 1) items.push('gap')
  items.push(pageCount)
  return items
}

export default function Pagination({
  page,
  pageCount,
  total,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
  className = '',
}: PaginationProps) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)
  const go = (p: number) => onPageChange(Math.min(pageCount, Math.max(1, p)))

  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-[12px] text-ink-dim ${className}`}>
      <div className="flex items-center gap-2">
        <span>
          {from}–{to} of {total}
        </span>
        {onPageSizeChange && (
          <>
            <span className="text-ink-faint">·</span>
            <Select
              className="w-auto rounded-soft border border-edge bg-bg px-2 py-1 text-[11px]"
              value={pageSize}
              onChange={(v) => onPageSizeChange(Number(v))}
              options={pageSizeOptions.map((n) => ({ value: n, label: `${n} / page` }))}
            />
          </>
        )}
      </div>

      <div className="flex items-center gap-1">
        <IconButton
          size="sm"
          className="disabled:pointer-events-none disabled:opacity-30"
          disabled={page <= 1}
          onClick={() => go(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft width={14} height={14} />
        </IconButton>
        {pageItems(page, pageCount).map((item, i) =>
          item === 'gap' ? (
            <span key={`gap-${i}`} className="px-1 text-ink-faint">
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              onClick={() => go(item)}
              aria-current={item === page ? 'page' : undefined}
              className={`h-6 min-w-6 rounded px-1.5 text-[11px] font-semibold transition-colors ${
                item === page ? 'bg-elevated text-ink' : 'text-ink-dim hover:bg-elevated hover:text-ink'
              }`}
            >
              {item}
            </button>
          ),
        )}
        <IconButton
          size="sm"
          className="disabled:pointer-events-none disabled:opacity-30"
          disabled={page >= pageCount}
          onClick={() => go(page + 1)}
          aria-label="Next page"
        >
          <ChevronRight width={14} height={14} />
        </IconButton>
      </div>
    </div>
  )
}
