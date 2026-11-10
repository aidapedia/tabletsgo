import { useCallback, useEffect, useMemo, useState } from 'react'
import RefreshButton from '@/shared/ui/RefreshButton'
import ListRow from '@/shared/ui/ListRow'
import RowLabel from '@/shared/ui/RowLabel'
import SearchInput from '@/shared/ui/form/SearchInput'
import { toast } from 'sonner'
import { NoteIcon, PlusIcon, SearchIcon } from '@/shared/ui/icons'
import { COMPATIBILITY_LEVELS, listSchemas, setSchemaCompatibility, type SchemaSubject } from '../lib/api'
import { Button } from '@/shared/ui/button'
import OptionSelect from '@/shared/ui/form/OptionSelect'
import { FormField } from '@/shared/ui/form/FormField'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip'

/**
 * The console's sidebar for the connection's Schema Registry (its own rail
 * entry): every subject with its format and latest version, and the
 * registry-wide compatibility rule. A subject opens in a tab; + opens a tab
 * for a new one.
 */
export default function SchemaRegistrySidebar({
  conn,
  activeSubject,
  onOpenSubject,
}: {
  conn: any
  activeSubject?: string | null
  /** null opens a new subject. */
  onOpenSubject: (subject: string | null) => void
}) {
  const [subjects, setSubjects] = useState<SchemaSubject[] | null>(null)
  const [level, setLevel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)

  const load = useCallback(
    () =>
      listSchemas(conn)
        .then((r) => {
          setSubjects(r.subjects)
          setLevel(r.compatibility)
          setError(null)
        })
        .catch((e) => setError(e.message)),
    [conn]
  )
  useEffect(() => {
    load()
  }, [load])

  const needle = filter.trim().toLowerCase()
  const shown = useMemo(() => (subjects || []).filter((s) => !needle || s.subject.toLowerCase().includes(needle)), [subjects, needle])

  const changeLevel = async (next: string) => {
    try {
      await setSchemaCompatibility(conn, null, next)
      setLevel(next)
      toast.success(`The registry's compatibility rule is now ${next}.`)
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  return (
    <>
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <span className="text-xs font-semibold">Schema Registry</span>
        <div className="flex gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <RefreshButton onRefresh={load} aria-label="Refresh subjects" />
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom">Refresh</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm"
                aria-pressed={searchOpen}
                onClick={() => {
                  if (searchOpen) setFilter('')
                  setSearchOpen((o) => !o)
                }}
                aria-label="Search subjects"
              >
                <SearchIcon width={15} height={15} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Search subjects</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={() => onOpenSubject(null)} aria-label="New subject">
                <PlusIcon width={15} height={15} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">New subject</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {searchOpen && (
        <SearchInput
          autoFocus
          className="mx-3.5 mb-2"
          placeholder="Filter subjects"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setFilter('')
              setSearchOpen(false)
            }
          }}
          inputClassName="!rounded-[9px] !text-xs"
        />
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
        {error && <div className="m-2 rounded-[9px] border border-destructive/25 bg-destructive/10 px-3 py-2.5 text-[11px] text-[#ff9b9b]">{error}</div>}
        {!error && subjects === null && <div className="p-6 text-center text-xs text-faint">Reading the registry…</div>}
        {!error && subjects && !shown.length && (
          <div className="p-6 text-center text-xs text-faint">{needle ? `No subjects match "${filter.trim()}".` : 'No schemas registered yet.'}</div>
        )}
        {shown.map((s) => (
          <ListRow
            key={s.subject}
            active={activeSubject === s.subject}
            onClick={() => onOpenSubject(s.subject)}
            title={s.subject}
            icon={<NoteIcon width={14} height={14} className={`shrink-0 ${activeSubject === s.subject ? 'text-primary' : 'text-faint'}`} />}
          >
            <RowLabel className={activeSubject === s.subject ? 'font-medium' : ''}>{s.subject}</RowLabel>
            <span className="shrink-0 font-mono text-[10px] text-faint">{s.type ? `${s.type.slice(0, 5).toLowerCase()} v${s.version}` : '—'}</span>
          </ListRow>
        ))}
      </div>

      <div className="border-t border-border px-3.5 py-2.5">
        <FormField label="Registry compatibility" className="!mb-0" help="The rule every subject without its own follows: what a new version must stay compatible with.">
          <OptionSelect value={level} onChange={changeLevel} options={COMPATIBILITY_LEVELS.map((l) => ({ value: l, label: l }))} />
        </FormField>
      </div>
    </>
  )
}
