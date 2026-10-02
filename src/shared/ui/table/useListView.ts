import { useEffect, useState } from 'react'

export type ListView = 'list' | 'grid'

/**
 * Which way a list is drawn — a table or a grid of cards — remembered per list.
 *
 *   const [view, setView] = useListView('connections')
 *   const table = useDataTable({ rows, columns, view })
 *   <ViewToggle value={view} onChange={setView} />
 *   <DataTable columns={columns} rowKey={(r) => r.id} {...table} />
 *
 * A viewing preference, not app data: it lives in this browser only, and a
 * browser refusing storage just falls back to the table.
 */
export default function useListView(list: string) {
  const key = `tabletsgo:view:${list}`
  const [view, setView] = useState<ListView>(() => {
    try {
      return localStorage.getItem(key) === 'grid' ? 'grid' : 'list'
    } catch {
      return 'list'
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(key, view)
    } catch {
      /* not worth surfacing */
    }
  }, [key, view])

  return [view, setView] as const
}
