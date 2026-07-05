import { useEffect, useState } from 'react'
import { useKeymap } from '../stores/KeymapContext'
import { CATEGORIES } from '../lib/actions'
import { eventToCombo, formatCombo } from '../lib/combo'
import Button from '@/shared/ui/buttons/Button'
import TextButton from '@/shared/ui/buttons/TextButton'
import ConfirmDialog from '@/shared/ui/feedback/ConfirmDialog'

// action id currently being (re)bound, or null
export default function KeymapSetting() {
  const { actions, bindings, setBinding, reassignBinding, resetBinding, resetAll, findConflictId, setIsRecording } =
    useKeymap()
  const [recordingId, setRecordingId] = useState<string | null>(null)
  const [conflict, setConflict] = useState<{ actionId: string; combo: string; conflictId: string } | null>(null)

  useEffect(() => {
    setIsRecording(!!recordingId || !!conflict)
  }, [recordingId, conflict, setIsRecording])

  // Captures the next combo for `recordingId`. Runs in the capture phase so it
  // sees the keydown before the live shortcut dispatcher (and stops it there).
  useEffect(() => {
    if (!recordingId) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setRecordingId(null)
        return
      }
      const combo = eventToCombo(e)
      if (!combo) return
      const conflictId = findConflictId(recordingId, combo)
      if (conflictId) setConflict({ actionId: recordingId, combo, conflictId })
      else setBinding(recordingId, combo)
      setRecordingId(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recordingId, findConflictId, setBinding])

  // Any click while recording — on another row, or elsewhere — cancels it.
  useEffect(() => {
    if (!recordingId) return
    const cancel = () => setRecordingId(null)
    window.addEventListener('mousedown', cancel)
    return () => window.removeEventListener('mousedown', cancel)
  }, [recordingId])

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between gap-4">
        <p className="text-[12px] leading-relaxed text-ink-dim">
          Click a shortcut to change it. Every shortcut must include ⌘/Ctrl. Press Esc to cancel while recording.
        </p>
        <TextButton className="shrink-0 !text-[11px]" onClick={resetAll}>
          Reset all to defaults
        </TextButton>
      </div>

      {CATEGORIES.map((category) => {
        const items = actions.filter((a) => a.category === category)
        if (!items.length) return null
        return (
          <div key={category}>
            <div className="mb-3 text-[11px] font-bold uppercase tracking-wide text-ink-faint">{category}</div>
            <div className="flex flex-col divide-y divide-edge overflow-hidden rounded-card border border-edge bg-card">
              {items.map((action) => {
                const combo = bindings[action.id]
                const isDefault = combo === action.defaultBinding
                const isRecordingThis = recordingId === action.id
                return (
                  <div key={action.id} className="flex items-center justify-between gap-4 px-4 py-3">
                    <span className="text-[13px] text-ink">{action.label}</span>
                    <div className="flex items-center gap-2">
                      {!isDefault && (
                        <TextButton
                          tone="faint"
                          className="!text-[11px]"
                          onClick={() => resetBinding(action.id)}
                          aria-label={`Reset ${action.label} to default`}
                        >
                          Reset
                        </TextButton>
                      )}
                      <Button
                        variant={isRecordingThis ? 'primary' : 'ghost'}
                        size="sm"
                        className="min-w-[112px] justify-center font-mono"
                        onClick={() => setRecordingId(action.id)}
                      >
                        {isRecordingThis ? 'Press a shortcut…' : formatCombo(combo)}
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      {conflict && (
        <ConfirmDialog
          title="Shortcut already in use"
          message={`${formatCombo(conflict.combo)} is already assigned to "${
            actions.find((a) => a.id === conflict.conflictId)?.label
          }". Reassign it to this action instead?`}
          confirmLabel="Reassign"
          cancelLabel="Keep current"
          onConfirm={() => {
            reassignBinding(conflict.actionId, conflict.combo)
            setConflict(null)
          }}
          onCancel={() => setConflict(null)}
        />
      )}
    </div>
  )
}
