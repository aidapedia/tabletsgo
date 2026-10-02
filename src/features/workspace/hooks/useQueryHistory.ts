import { useState } from 'react'
import { fetchHistory, recordHistory, clearHistory, deleteHistory } from '../lib/queryHistory'

/**
 * The connection's execution log, persisted on the backend.
 *
 * Every run is recorded, but the list is only re-fetched when a history tab is
 * actually on screen — `isOpen` answers that, so a run in the background costs
 * one write and no read.
 */
export default function useQueryHistory(
  connectionId: string,
  { user, isOpen }: { user: any; isOpen: () => boolean }
) {
  const [history, setHistory] = useState<any[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const loadHistory = async () => {
    setHistoryLoading(true)
    try {
      setHistory(await fetchHistory(connectionId))
    } finally {
      setHistoryLoading(false)
    }
  }

  const recordRun = async (entry: any) => {
    await recordHistory(connectionId, {
      table: entry.table,
      query: entry.sql,
      status: entry.status,
      latency: entry.latency,
      error: entry.error,
      executorId: user?.id,
      executorName: user?.name || user?.username,
    })
    if (isOpen()) loadHistory()
  }

  const clearHistoryAll = async () => {
    setHistory([])
    await clearHistory(connectionId)
  }

  const deleteHistoryEntries = async (ids: string[]) => {
    if (!ids?.length) return
    const drop = new Set(ids)
    setHistory((prev) => prev.filter((h) => !drop.has(h.id)))
    await deleteHistory(connectionId, ids)
  }

  return { history, historyLoading, loadHistory, recordRun, clearHistoryAll, deleteHistoryEntries }
}
