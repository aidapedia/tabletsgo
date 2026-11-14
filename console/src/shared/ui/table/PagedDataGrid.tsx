import DataGrid from './DataGrid'
import Pagination from './Pagination'
import usePagination from './usePagination'

/** Rows-per-page choices for a console grid — the same list as the table view's toolbar. */
export const GRID_PAGE_SIZES = [25, 50, 100, 200]

/**
 * `DataGrid` with a pager under it, for a grid that gets its whole row set at
 * once (a query result, a cluster's ACLs). A grid whose caller already pages —
 * the table view, the history views — uses `DataGrid` directly.
 *
 * Takes every `DataGrid` prop. Row indices handed back (`onCellDoubleClick`,
 * `onCellContextMenu`, `renderRowActions`, `onToggleRow`) are positions in the whole `rows`, not on
 * the page; `onToggleAll` is given the page's rows, so a select-all box selects
 * what it sits over. `resetKey` goes back to page 1 when it changes — pass the
 * result, so a new run starts at the top.
 *
 * Like `DataGrid`, it fills a flex column: put it where a `DataGrid` would go.
 */
export default function PagedDataGrid({ rows, pageSize = 50, resetKey, onCellDoubleClick, onCellContextMenu, renderRowActions, onToggleRow, onToggleAll, ...rest }: any) {
  const { pageRows, offset, pager } = usePagination(rows, { pageSize, pageSizeOptions: GRID_PAGE_SIZES, resetKey })

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <DataGrid
        {...rest}
        rows={pageRows}
        rowOffset={offset}
        onCellDoubleClick={onCellDoubleClick && ((cell: any) => onCellDoubleClick({ ...cell, rowIndex: offset + cell.rowIndex }))}
        onCellContextMenu={onCellContextMenu && ((e: any, cell: any) => onCellContextMenu(e, { ...cell, rowIndex: offset + cell.rowIndex }))}
        renderRowActions={renderRowActions && ((row: any, i: number) => renderRowActions(row, offset + i))}
        onToggleRow={onToggleRow && ((row: any, i: number) => onToggleRow(row, offset + i))}
        onToggleAll={onToggleAll && (() => onToggleAll(pageRows))}
      />
      {rows.length > 0 && <Pagination className="shrink-0 border-t border-border px-3 py-1.5 text-[11px]" {...pager} />}
    </div>
  )
}
