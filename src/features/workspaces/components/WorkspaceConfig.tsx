import { useEffect, useRef, useState } from 'react'
import { useToast } from '@/shared/ui/feedback/Toast'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import NumberStepper from '@/shared/ui/form/NumberStepper'
import SettingRow from '@/shared/ui/form/SettingRow'
import { useWorkspaces, updateWorkspace, getWorkspace } from '@/features/workspaces'

// How long to wait after the last edit before persisting — the stepper fires on
// every click/keystroke, so one request per change would hammer the server.
const SAVE_DEBOUNCE_MS = 600

// Workspace-wide defaults every connection inherits — the workspace counterpart
// of Settings > Data: same row-card layout, and changes apply as you make them
// (no Save button).
export default function WorkspaceConfig() {
  const toast = useToast()
  const { current } = useWorkspaces()
  // Session policy lives on the workspace *detail* response, not the list.
  const [loading, setLoading] = useState(true)
  const [maxSessions, setMaxSessions] = useState(0)
  const [instanceDefault, setInstanceDefault] = useState(0)
  // Last value the server accepted — what an edit is compared against and what
  // a failed save rolls back to.
  const savedRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!current) return
    let alive = true
    setLoading(true)
    getWorkspace(current.id)
      .then((w) => {
        if (!alive) return
        const max = w.sessions?.maxPerConnection || 0
        setMaxSessions(max)
        savedRef.current = max
        setInstanceDefault(w.sessions?.instanceDefault || 0)
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [current?.id])

  // Drop a pending save when the tab unmounts — it would write a value the user
  // can no longer see.
  useEffect(() => () => timerRef.current && clearTimeout(timerRef.current), [])

  if (!current || loading) return <LoadingState className="" />

  const isOwner = current.role === 'owner'

  const changeMaxSessions = (next: number) => {
    if (!isOwner) return
    setMaxSessions(next)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      if (next === savedRef.current) return
      const previous = savedRef.current
      savedRef.current = next
      try {
        await updateWorkspace(current.id, { sessions: { maxPerConnection: next } })
      } catch (err) {
        savedRef.current = previous
        setMaxSessions(previous)
        toast.error(err.message)
      }
    }, SAVE_DEBOUNCE_MS)
  }

  return (
    <div className="space-y-3">
      <SettingRow
        title="Max sessions per connection"
        desc={
          <>
            How many connections to a database this workspace keeps open at once — one per database being browsed. 0 means{' '}
            {instanceDefault ? `the server default (${instanceDefault})` : 'unlimited'}. This applies to every connection in
            the workspace.
          </>
        }
      >
        <NumberStepper
          value={maxSessions}
          min={0}
          max={999}
          ariaLabel="Max sessions per connection"
          className="w-36 shrink-0"
          onChange={(n) => changeMaxSessions(n || 0)}
        />
      </SettingRow>

      {!isOwner && <p className="text-[11px] text-ink-faint">Only workspace admins can change these settings.</p>}
    </div>
  )
}
