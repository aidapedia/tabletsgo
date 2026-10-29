import { useMemo, useState } from 'react'
import Button from '@/shared/ui/buttons/Button'
import IconButton from '@/shared/ui/buttons/IconButton'
import TextButton from '@/shared/ui/buttons/TextButton'
import Tooltip from '@/shared/ui/overlay/Tooltip'
import SearchInput from '@/shared/ui/form/SearchInput'
import { Input } from '@/shared/ui/form/Input'
import Toggle from '@/shared/ui/form/Toggle'
import { useToast } from '@/shared/ui/feedback/Toast'
import { EditIcon } from '@/shared/ui/icons'
import { alterTopic, type TopicDetail } from '../lib/api'

/**
 * A topic's configuration. Overrides (values set on this topic) come first and
 * can be edited or reset to the cluster default; defaults are listed for
 * reference. A change is merged into the existing overrides server-side —
 * Kafka's AlterConfigs would otherwise reset everything else.
 */
export default function TopicConfigPanel({
  conn,
  topic,
  detail,
  onChanged,
}: {
  conn: any
  topic: string
  detail: TopicDetail | null
  onChanged: () => void
}) {
  const toast = useToast()
  const [filter, setFilter] = useState('')
  const [showDefaults, setShowDefaults] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const configs = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return (detail?.configs || [])
      .filter((c) => (showDefaults || !c.isDefault || needle) && (!needle || c.name.includes(needle)))
      .sort((a, b) => Number(a.isDefault) - Number(b.isDefault) || a.name.localeCompare(b.name))
  }, [detail, filter, showDefaults])

  if (!detail) return <div className="p-[30px] text-center text-xs text-ink-faint">Reading {topic}…</div>

  const save = async (name: string, value: string | null) => {
    setSaving(true)
    try {
      await alterTopic(conn, topic, { configs: { [name]: value } })
      toast.success(value === null ? `${name} reset to the cluster default.` : `${name} updated.`)
      setEditing(null)
      onChanged()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  const overrides = detail.configs.filter((c) => !c.isDefault).length

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-[18px] py-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <SearchInput className="w-[280px]" placeholder="Filter configs" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <label className="flex items-center gap-2 text-[11px] text-ink-dim">
          <Toggle checked={showDefaults} onChange={setShowDefaults} ariaLabel="Show defaults" />
          Show defaults
        </label>
        <span className="ml-auto text-[11px] text-ink-faint">
          {overrides} override{overrides === 1 ? '' : 's'} · {detail.configs.length} configs
        </span>
      </div>

      <div className="overflow-hidden rounded-card border border-edge bg-panel">
        {configs.length === 0 && (
          <div className="p-6 text-center text-xs text-ink-faint">
            {filter ? 'No configs match.' : 'Nothing is overridden on this topic — turn on "Show defaults" to see what it inherits.'}
          </div>
        )}
        {configs.map((c) => (
          <div key={c.name} className="flex min-h-[38px] items-center gap-3 border-b border-edge/60 px-3.5 py-1.5 last:border-b-0">
            <span className={`w-[42%] shrink-0 truncate font-mono text-[12px] ${c.isDefault ? 'text-ink-dim' : 'text-ink'}`} title={c.name}>
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
                <Button type="submit" variant="primary" size="sm" disabled={saving}>
                  Save
                </Button>
                <Button variant="subtle" size="sm" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
              </form>
            ) : (
              <>
                <span className="min-w-0 flex-1 truncate font-mono text-[12px]" title={c.value ?? ''}>
                  {c.sensitive ? '••••••' : c.value ?? <span className="italic text-ink-faint">null</span>}
                </span>
                {!c.isDefault && (
                  <span className="shrink-0 rounded-[5px] bg-green/15 px-1.5 py-px text-[9px] font-bold uppercase text-green-bright">override</span>
                )}
                {!c.readOnly && !c.sensitive && (
                  <div className="flex shrink-0 items-center gap-2">
                    {!c.isDefault && (
                      <TextButton tone="faint" className="!text-[11px]" onClick={() => save(c.name, null)} disabled={saving}>
                        Reset
                      </TextButton>
                    )}
                    <Tooltip label="Edit" placement="left">
                      <IconButton
                        size="sm"
                        aria-label={`Edit ${c.name}`}
                        onClick={() => {
                          setEditing(c.name)
                          setDraft(c.value ?? '')
                        }}
                      >
                        <EditIcon width={13} height={13} />
                      </IconButton>
                    </Tooltip>
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
