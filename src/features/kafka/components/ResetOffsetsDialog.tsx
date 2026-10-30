import { useEffect, useMemo, useState } from 'react'
import Modal from '@/shared/ui/overlay/Modal'
import Button from '@/shared/ui/buttons/Button'
import Select from '@/shared/ui/form/Select'
import { controlClass, Input } from '@/shared/ui/form/Input'
import { FormField } from '@/shared/ui/form/Form'
import { useToast } from '@/shared/ui/feedback/Toast'
import { resetOffsets, type ResetRow, type ResetStrategy } from '../lib/api'
import { compact, num } from '../lib/format'

const STRATEGIES: { id: ResetStrategy; label: string; desc: string }[] = [
  { id: 'earliest', label: 'Earliest', desc: 'Re-read everything still retained' },
  { id: 'latest', label: 'Latest', desc: 'Skip the backlog and start from new messages' },
  { id: 'timestamp', label: 'To timestamp', desc: 'First offset at or after a point in time' },
  { id: 'offset', label: 'To offset', desc: 'One exact offset for every partition' },
  { id: 'shift', label: 'Shift by', desc: 'Move each partition forward (+) or back (−) by N' },
]

/**
 * Move a group's committed offsets on one topic. The before → after table is a
 * live dry run, recomputed as the strategy changes; applying needs the group to
 * be empty (Kafka refuses otherwise) and the group id typed back.
 */
export default function ResetOffsetsDialog({
  conn,
  group,
  topics,
  members,
  onClose,
  onApplied,
}: {
  conn: any
  group: string
  topics: string[]
  members: string[]
  onClose: () => void
  onApplied: () => void
}) {
  const toast = useToast()
  const [topic, setTopic] = useState(topics[0] || '')
  const [strategy, setStrategy] = useState<ResetStrategy>('latest')
  const [value, setValue] = useState('')
  const [rows, setRows] = useState<ResetRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState('')
  const [applying, setApplying] = useState(false)

  const needsValue = strategy === 'timestamp' || strategy === 'offset' || strategy === 'shift'
  const valueReady = !needsValue || value.trim() !== ''
  const spec = useMemo(
    () => ({ topic, strategy, value: strategy === 'timestamp' && value ? new Date(value).toISOString() : value.trim() || undefined }),
    [topic, strategy, value]
  )

  // Dry run on every change, debounced so typing an offset doesn't fire a read per key.
  useEffect(() => {
    if (!topic || !valueReady) {
      setRows(null)
      return
    }
    let alive = true
    const t = setTimeout(() => {
      resetOffsets(conn, group, spec)
        .then((r) => {
          if (!alive) return
          setRows(r.offsets)
          setError(null)
        })
        .catch((e) => alive && (setError(e.message), setRows(null)))
    }, 250)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [conn, group, spec, topic, valueReady])

  const skipped = (rows || []).reduce((n, r) => n + Math.max(r.delta || 0, 0), 0)
  const reread = (rows || []).reduce((n, r) => n + Math.max(-(r.delta || 0), 0), 0)
  const active = members.length > 0

  const apply = async () => {
    setApplying(true)
    try {
      await resetOffsets(conn, group, spec, true)
      toast.success(`Reset ${group} on ${topic}.`)
      onApplied()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setApplying(false)
    }
  }

  return (
    <Modal title={<>Reset offsets · <span className="font-mono">{group}</span></>} onClose={onClose} width={840}>
      <p className="mb-4 text-[12px] text-ink-dim">Moves the group's committed position. Its consumers pick up from here when they restart.</p>

      {active && (
        <div className="mb-4 rounded-[9px] border border-amber/30 bg-amber/10 px-3.5 py-2.5 text-[12px] text-amber">
          This group has {members.length} active member{members.length === 1 ? '' : 's'} ({members.join(', ')}). You can preview here, but Kafka only
          applies a reset to an empty group — stop the consumers first.
        </div>
      )}

      <div className="flex flex-wrap gap-5">
        <div className="min-w-0 flex-[1_1_240px]">
          {topics.length > 1 && (
            <FormField label="Topic">
              <Select className={controlClass} value={topic} onChange={setTopic} options={topics.map((t) => ({ value: t, label: t }))} />
            </FormField>
          )}
          <p className="mb-2 text-[11px] font-semibold text-ink-dim">Strategy</p>
          <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Strategy">
            {STRATEGIES.map((s) => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={strategy === s.id}
                onClick={() => {
                  setStrategy(s.id)
                  setValue('')
                }}
                className={`flex items-start gap-2.5 rounded-soft border px-3 py-2 text-left transition-colors ${
                  strategy === s.id ? 'border-green bg-green/10' : 'border-edge bg-elevated hover:border-edge-strong'
                }`}
              >
                <span className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full ${strategy === s.id ? 'border-4 border-green' : 'border-[1.5px] border-edge-strong'}`} />
                <span>
                  <span className="block text-[12px] font-semibold">{s.label}</span>
                  <span className="mt-0.5 block text-[11px] text-ink-dim">{s.desc}</span>
                </span>
              </button>
            ))}
          </div>
          {needsValue && (
            <FormField label={strategy === 'timestamp' ? 'Time' : strategy === 'offset' ? 'Offset' : 'Shift by'} className="mt-3">
              {strategy === 'timestamp' ? (
                <Input type="datetime-local" step="1" value={value} onChange={(e) => setValue(e.target.value)} />
              ) : (
                <Input
                  className="font-mono"
                  inputMode="numeric"
                  placeholder={strategy === 'shift' ? '-1000 or +50000' : '0'}
                  value={value}
                  onChange={(e) => setValue(e.target.value.replace(strategy === 'shift' ? /[^\d+-]/g : /\D/g, ''))}
                />
              )}
            </FormField>
          )}
        </div>

        <div className="min-w-0 flex-[2_1_380px]">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] font-semibold text-ink-dim">Dry run · {topic}</p>
            {rows && <span className="text-[11px] text-ink-faint">{rows.length} partitions</span>}
          </div>
          <div className="max-h-[300px] overflow-auto rounded-soft border border-edge">
            <table className="w-full border-collapse text-[12px]">
              <thead className="sticky top-0 bg-panel">
                <tr className="text-[11px] text-ink-faint">
                  <th className="h-7 border-b border-edge px-3 text-right font-semibold">Part.</th>
                  <th className="h-7 border-b border-edge px-3 text-right font-semibold">Now</th>
                  <th className="h-7 border-b border-edge px-3 text-right font-semibold">After</th>
                  <th className="h-7 border-b border-edge px-3 text-right font-semibold">Change</th>
                </tr>
              </thead>
              <tbody>
                {(rows || []).map((r) => (
                  <tr key={r.partition}>
                    <td className="h-7 border-b border-edge/60 px-3 text-right font-mono">{r.partition}</td>
                    <td className="border-b border-edge/60 px-3 text-right font-mono text-ink-dim">{r.current == null ? '–' : num(r.current)}</td>
                    <td className="border-b border-edge/60 px-3 text-right font-mono font-semibold">{num(r.target)}</td>
                    <td className={`border-b border-edge/60 px-3 text-right font-mono ${!r.delta ? 'text-ink-faint' : r.delta > 0 ? 'text-amber' : 'text-[#7cc4ff]'}`}>
                      {r.delta == null ? 'new' : r.delta === 0 ? '0' : r.delta > 0 ? `skip ${compact(r.delta)}` : `re-read ${compact(-r.delta)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows && !error && <div className="p-6 text-center text-xs text-ink-faint">{valueReady ? 'Computing…' : 'Enter a value to preview.'}</div>}
          </div>
          {rows && (
            <p className="mt-2.5 text-[12px] text-ink-dim">
              {skipped > 0 && <span className="text-amber">Skips {num(skipped)} message(s). </span>}
              {reread > 0 && <span className="text-[#7cc4ff]">Re-reads {num(reread)} message(s) — downstream may see duplicates. </span>}
              {!skipped && !reread && 'No change from the current position.'}
            </p>
          )}
          {error && <div className="mt-2.5 rounded-[9px] border border-red/25 bg-red/10 px-3 py-2 text-[11px] text-[#ff9b9b]">{error}</div>}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-edge pt-4">
        <label className="flex items-center gap-2 text-[11px] text-ink-dim">
          Type <span className="font-mono text-ink">{group}</span> to apply
          <Input className="!w-[180px] font-mono" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={group} disabled={active} />
        </label>
        <div className="flex gap-2">
          <Button variant="subtle" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={apply} disabled={active || !rows || confirm !== group || applying}>
            {applying ? 'Applying…' : `Apply to ${rows?.length ?? 0} partition${rows?.length === 1 ? '' : 's'}`}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
