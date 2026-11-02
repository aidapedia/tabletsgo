import { useCallback, useEffect, useState, type ReactNode } from 'react'
import IconButton from '@/shared/ui/buttons/IconButton'
import RefreshButton from '@/shared/ui/buttons/RefreshButton'
import TextButton from '@/shared/ui/buttons/TextButton'
import ListRow from '@/shared/ui/ListRow'
import RowLabel from '@/shared/ui/RowLabel'
import Tooltip from '@/shared/ui/overlay/Tooltip'
import ConfirmDialog from '@/shared/ui/feedback/ConfirmDialog'
import { useToast } from '@/shared/ui/feedback/Toast'
import { ChevronRight, PlusIcon } from '@/shared/ui/icons'
import { runStreamSql, streamSqlCatalog, type SqlCatalog } from '../lib/api'

/**
 * The console's sidebar for the connection's ksqlDB (its own rail entry): its
 * streams, tables and persistent queries. A stream or table opens a KSQL tab
 * with a query over it; Describe and Explain run in one. + opens an empty tab.
 */
export default function KsqlSidebar({ conn, onOpenKsql }: { conn: any; onOpenKsql: (sql?: string, run?: boolean) => void }) {
  const toast = useToast()
  const [catalog, setCatalog] = useState<SqlCatalog | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [terminating, setTerminating] = useState<string | null>(null)

  const load = useCallback(
    () =>
      streamSqlCatalog(conn)
        .then((c) => {
          setCatalog(c)
          setError(null)
        })
        .catch((e) => setError(e.message)),
    [conn]
  )
  useEffect(() => {
    load()
  }, [load])

  const terminate = async () => {
    const id = terminating
    setTerminating(null)
    if (!id) return
    try {
      await runStreamSql(conn, `TERMINATE ${id};`)
      toast.success(`Terminated ${id}.`)
      load()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  return (
    <>
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <span className="text-xs font-semibold">ksqlDB</span>
        <div className="flex gap-1">
          <Tooltip label="Refresh" placement="bottom">
            <RefreshButton onRefresh={load} aria-label="Refresh streams, tables and queries" />
          </Tooltip>
          <Tooltip label="New KSQL tab" placement="bottom">
            <IconButton onClick={() => onOpenKsql()} aria-label="New KSQL tab">
              <PlusIcon width={15} height={15} />
            </IconButton>
          </Tooltip>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2">
        {error && <div className="m-2 rounded-[9px] border border-red/25 bg-red/10 px-3 py-2.5 text-[11px] text-[#ff9b9b]">{error}</div>}
        {!error && !catalog && <div className="p-6 text-center text-xs text-ink-faint">Reading ksqlDB…</div>}
        {catalog && (
          <>
            <Section title="Streams" count={catalog.streams.length}>
              {catalog.streams.map((s) => (
                <SourceRow
                  key={s.name}
                  name={s.name}
                  sub={`${s.topic} · ${s.valueFormat.toLowerCase()}`}
                  dim={s.system}
                  onQuery={() => onOpenKsql(`SELECT * FROM ${s.name} EMIT CHANGES;`)}
                  onDescribe={() => onOpenKsql(`DESCRIBE ${s.name};`, true)}
                />
              ))}
            </Section>
            <Section title="Tables" count={catalog.tables.length}>
              {catalog.tables.map((t) => (
                <SourceRow
                  key={t.name}
                  name={t.name}
                  sub={`${t.topic} · ${t.valueFormat.toLowerCase()}${t.windowed ? ' · windowed' : ''}`}
                  onQuery={() => onOpenKsql(`SELECT * FROM ${t.name};`, true)}
                  onDescribe={() => onOpenKsql(`DESCRIBE ${t.name};`, true)}
                />
              ))}
            </Section>
            <Section title="Queries" count={catalog.queries.length}>
              {catalog.queries.map((q) => (
                <div key={q.id} className="group rounded-soft px-2.5 py-1.5 hover:bg-elevated" title={q.statement}>
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${q.state === 'RUNNING' ? 'bg-green' : 'bg-amber'}`} />
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{q.id}</span>
                    <TextButton tone="faint" className="!text-[10px] opacity-0 group-hover:opacity-100" onClick={() => onOpenKsql(`EXPLAIN ${q.id};`, true)}>
                      Explain
                    </TextButton>
                    <TextButton tone="faint" className="!text-[10px] !text-red opacity-0 group-hover:opacity-100" onClick={() => setTerminating(q.id)}>
                      Terminate
                    </TextButton>
                  </div>
                  <div className="truncate pl-4 text-[10px] text-ink-faint">→ {q.sinks.join(', ') || '—'}</div>
                </div>
              ))}
            </Section>
          </>
        )}
      </div>

      {terminating && (
        <ConfirmDialog
          danger
          title={`Terminate ${terminating}?`}
          message="The persistent query stops and stops writing to its sink. The stream or table it fed stays, but nothing updates it."
          confirmLabel="Terminate"
          onConfirm={terminate}
          onCancel={() => setTerminating(null)}
        />
      )}
    </>
  )
}

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="mb-1">
      <ListRow
        onClick={() => setOpen((o) => !o)}
        icon={<ChevronRight width={12} height={12} className={`shrink-0 text-ink-faint transition-transform ${open ? 'rotate-90' : ''}`} />}
      >
        <RowLabel className="font-medium">{title}</RowLabel>
        <span className="shrink-0 text-[10px] text-ink-faint">{count}</span>
      </ListRow>
      {open && (count === 0 ? <div className="py-1 pl-8 text-[11px] text-ink-faint">None.</div> : <div className="pl-4">{children}</div>)}
    </div>
  )
}

function SourceRow({ name, sub, dim, onQuery, onDescribe }: { name: string; sub: string; dim?: boolean; onQuery: () => void; onDescribe: () => void }) {
  return (
    <ListRow onClick={onQuery} title={`${name} — open a query over it`} className={`group !py-1.5 ${dim ? 'opacity-60' : ''}`}>
      <span className="min-w-0 flex-1">
        <RowLabel className="block font-mono !text-[11px]">{name}</RowLabel>
        <span className="block truncate text-[10px] text-ink-faint">{sub}</span>
      </span>
      <TextButton
        tone="faint"
        className="!text-[10px] opacity-0 group-hover:opacity-100"
        onClick={(e: any) => {
          e.stopPropagation()
          onDescribe()
        }}
      >
        Describe
      </TextButton>
    </ListRow>
  )
}
