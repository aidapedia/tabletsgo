import { useMemo, useState } from 'react'
import RefreshButton from '@/shared/ui/RefreshButton'
import SearchInput from '@/shared/ui/form/SearchInput'
import { toast } from 'sonner'
import { EditIcon } from '@/shared/ui/icons'
import type { TopicConfig } from '../lib/api'
import { Button } from '@/shared/ui/button'
import { Switch } from '@/shared/ui/switch'
import { Input } from '@/shared/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip'

/**
 * A Kafka resource's configuration — a topic's or a broker's. Overrides (values
 * set on this resource) come first and can be edited or reset to what it would
 * otherwise inherit; the rest are listed for reference behind "Show defaults".
 * `onSave` does the write; a null value removes the override.
 */
export default function ConfigList({
  configs: all,
  isOverride,
  subject,
  emptyText,
  onSave,
  onRefresh,
}: {
  configs: TopicConfig[]
  /** Which entries are this resource's own overrides. */
  isOverride: (c: TopicConfig) => boolean
  /** What a reset falls back to, for the toast: "the cluster default". */
  subject: string
  emptyText: string
  onSave: (name: string, value: string | null) => Promise<unknown>
  onRefresh: () => unknown
}) {
  const [filter, setFilter] = useState('')
  const [showDefaults, setShowDefaults] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const configs = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return all
      .filter((c) => (showDefaults || isOverride(c) || needle) && (!needle || c.name.includes(needle)))
      .sort((a, b) => Number(isOverride(b)) - Number(isOverride(a)) || a.name.localeCompare(b.name))
  }, [all, filter, showDefaults, isOverride])

  const save = async (name: string, value: string | null) => {
    setSaving(true)
    try {
      await onSave(name, value)
      toast.success(value === null ? `${name} reset to ${subject}.` : `${name} updated.`)
      setEditing(null)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  const overrides = all.filter(isOverride).length

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <SearchInput className="w-[280px]" placeholder="Filter configs" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Switch checked={showDefaults} onCheckedChange={(checked) => setShowDefaults(checked === true)} aria-label="Show defaults" />
          Show defaults
        </label>
        <span className="ml-auto text-[11px] text-faint">
          {overrides} override{overrides === 1 ? '' : 's'} · {all.length} configs
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <RefreshButton size="icon-xs" iconSize={13} aria-label="Refresh configuration" onRefresh={onRefresh} />
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom">Refresh</TooltipContent>
        </Tooltip>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-sidebar">
        {configs.length === 0 && <div className="p-6 text-center text-xs text-faint">{filter ? 'No configs match.' : emptyText}</div>}
        {configs.map((c) => {
          const own = isOverride(c)
          return (
            <div key={c.name} className="flex min-h-[38px] items-center gap-3 border-b border-border/60 px-3.5 py-1.5 last:border-b-0">
              <span className={`w-[42%] shrink-0 truncate font-mono text-[12px] ${own ? 'text-foreground' : 'text-muted-foreground'}`} title={c.name}>
                {c.name}
              </span>
              {editing === c.name ? (
                <form
                  className="flex flex-1 items-center gap-1.5"
                  onSubmit={(e) => {
                    e.preventDefault()
                    save(c.name, draft)
                  }}
                >
                  <Input autoFocus className="!py-1 font-mono" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setEditing(null)} />
                  <Button type="submit" variant="default" size="sm" disabled={saving}>
                    Save
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                </form>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px]" title={c.value ?? ''}>
                    {c.sensitive ? '••••••' : c.value ?? <span className="italic text-faint">null</span>}
                  </span>
                  {own && <span className="shrink-0 rounded-[5px] bg-primary/15 px-1.5 py-px text-[9px] font-bold uppercase text-primary-bright">override</span>}
                  {!c.readOnly && !c.sensitive && (
                    <div className="flex shrink-0 items-center gap-2">
                      {own && (
                        <Button variant="link" size="inline" type="button" className="text-faint hover:text-foreground !text-[11px]" onClick={() => save(c.name, null)} disabled={saving}>
                          Reset
                        </Button>
                      )}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon-xs"
                            aria-label={`Edit ${c.name}`}
                            onClick={() => {
                              setEditing(c.name)
                              setDraft(c.value ?? '')
                            }}
                          >
                            <EditIcon width={13} height={13} />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="left">Edit</TooltipContent>
                      </Tooltip>
                    </div>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}
