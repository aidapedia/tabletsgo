import { useEffect, useState } from 'react'
import DataGrid from '@/shared/ui/table/DataGrid'
import RefreshButton from '@/shared/ui/RefreshButton'
import { toast } from 'sonner'
import { ClockIcon, CodeIcon, TrashIcon } from '@/shared/ui/icons'
import { deleteKeys, readKey, setKeyTtl, type RedisKeyValue } from '../lib/api'
import { formatTtl, TYPE_COLOR, TYPE_LABEL } from '../lib/tree'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'

const PAGE_SIZE = 200

// Byte sizes read better than raw counts for string keys.
const formatBytes = (n: number) => {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/**
 * A single Redis key opened as a main-area tab: its metadata (type, TTL,
 * encoding, size) above the value rendered in the shared DataGrid — one row per
 * list element / set member / hash field / zset entry / stream entry, paged for
 * collections large enough to need it.
 *
 * Read-only by design: writes go through the console, where the exact command
 * is visible before it runs.
 */
export default function RedisKeyView({
  conn,
  redisKey,
  onRunCommand,
  onDeleted,
}: {
  conn: any
  redisKey: string
  onRunCommand: (command: string) => void
  onDeleted?: (key: string) => void
}) {
  const [data, setData] = useState<RedisKeyValue | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [offset, setOffset] = useState(0)
  const [ttlDraft, setTtlDraft] = useState('')
  const [editingTtl, setEditingTtl] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const load = async (from = offset) => {
    setLoading(true)
    setError(null)
    try {
      const next = await readKey(conn, redisKey, { offset: from, limit: PAGE_SIZE })
      setData(next)
      setOffset(next.offset)
    } catch (e) {
      setData(null)
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setOffset(0)
    load(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn.id, conn?.ns?.database, redisKey])

  const applyTtl = async () => {
    const seconds = Number(ttlDraft)
    if (ttlDraft.trim() && (!Number.isFinite(seconds) || seconds < 0)) {
      toast.error('Enter a TTL in seconds, or leave it empty to remove the expiry.')
      return
    }
    try {
      await setKeyTtl(conn, redisKey, ttlDraft.trim() ? seconds * 1000 : null)
      setEditingTtl(false)
      toast.success(ttlDraft.trim() ? `TTL set to ${seconds}s.` : 'Expiry removed — the key is now persistent.')
      load()
    } catch (e) {
      toast.error(`Couldn't set TTL: ${e.message}`)
    }
  }

  const remove = async () => {
    setConfirmDelete(false)
    try {
      await deleteKeys(conn, [redisKey])
      toast.success(`Deleted "${redisKey}".`)
      onDeleted?.(redisKey)
    } catch (e) {
      toast.error(`Delete failed: ${e.message}`)
    }
  }

  const sizeLabel =
    data?.length == null
      ? null
      : data.type === 'string'
        ? formatBytes(data.length)
        : `${data.length.toLocaleString()} entr${data.length === 1 ? 'y' : 'ies'}`

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-[18px] py-2.5">
        <span
          className={`rounded-[5px] border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
            TYPE_COLOR[data?.type || ''] || 'border-border bg-muted text-faint'
          }`}
        >
          {TYPE_LABEL[data?.type || ''] || data?.type || '…'}
        </span>
        <span className="min-w-0 truncate font-mono text-xs text-foreground" title={redisKey}>
          {redisKey}
        </span>
        {sizeLabel && <span className="text-[11px] text-faint">· {sizeLabel}</span>}
        {data?.encoding && <span className="text-[11px] text-faint">· {data.encoding}</span>}

        <div className="ml-auto flex items-center gap-2">
          {editingTtl ? (
            <div className="flex items-center gap-1.5">
              <Input
                autoFocus
                className="!w-[120px] !py-1 !text-[11px]"
                placeholder="seconds (empty = never)"
                value={ttlDraft}
                onChange={(e) => setTtlDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') applyTtl()
                  if (e.key === 'Escape') setEditingTtl(false)
                }}
              />
              <Button variant="default" size="sm" onClick={applyTtl}>
                Set
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setEditingTtl(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setTtlDraft(data?.ttlMs != null ? String(Math.round(data.ttlMs / 1000)) : '')
                    setEditingTtl(true)
                  }}
                >
                  <ClockIcon width={14} height={14} /> TTL {formatTtl(data?.ttlMs ?? null)}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Set expiry</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-lg" onClick={() => onRunCommand(`TYPE ${redisKey}`)} aria-label="Open in console">
                <CodeIcon width={15} height={15} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Open in console</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <RefreshButton size="icon-lg" iconSize={15} onRefresh={() => load()} busy={loading} aria-label="Reload key" />
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom">Reload</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-lg" onClick={() => setConfirmDelete(true)} aria-label="Delete key">
                <TrashIcon width={15} height={15} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Delete key</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {error && (
        <div className="mx-[18px] my-4 rounded-[9px] border border-destructive/25 bg-destructive/10 px-3.5 py-3 font-mono text-[11px] text-[#ff9b9b]">
          {error}
        </div>
      )}
      {!error && loading && <div className="p-[30px] text-center text-xs text-faint">Loading key…</div>}
      {!error && !loading && data && (
        <>
          <DataGrid columns={data.columns} rows={data.rows} />
          {(data.offset > 0 || data.hasMore) && (
            <div className="flex items-center justify-between border-t border-border px-[18px] py-2 text-[11px] text-muted-foreground">
              <span>
                {data.offset + 1}–{data.offset + data.rows.length}
                {data.length != null && ` of ${data.length.toLocaleString()}`}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={data.offset === 0}
                  onClick={() => load(Math.max(data.offset - PAGE_SIZE, 0))}
                >
                  Previous
                </Button>
                <Button variant="outline" size="sm" disabled={!data.hasMore} onClick={() => load(data.offset + PAGE_SIZE)}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete key?"
          description={`This permanently removes "${redisKey}" from Redis. This cannot be undone.`}
          confirmLabel="Delete"
          destructive
          onCancel={() => setConfirmDelete(false)}
          onConfirm={remove}
        />
      )}
    </div>
  )
}
