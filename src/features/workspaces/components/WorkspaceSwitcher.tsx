import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Popover from '@/shared/ui/overlay/Popover'
import Button from '@/shared/ui/buttons/Button'
import MenuItem from '@/shared/ui/navigation/MenuItem'
import { CheckIcon, ChevronDown, PlusIcon, SettingsIcon } from '@/shared/ui/icons'
import { Input } from '@/shared/ui/form/Input'
import { useWorkspaces } from '@/features/workspaces'

// Current-workspace picker + create + link to workspace settings.
export default function WorkspaceSwitcher() {
  const navigate = useNavigate()
  const { workspaces, current, switchWorkspace, createWorkspace } = useWorkspaces()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')

  const submitCreate = async (close) => {
    const n = name.trim()
    if (!n) return
    await createWorkspace(n)
    setName('')
    setCreating(false)
    close()
  }

  return (
    <Popover
      width={248}
      trigger={({ open, toggle }) => (
        <button
          onClick={toggle}
          className={`flex w-full items-center gap-2.5 rounded-soft border border-edge bg-elevated px-2.5 py-2 text-left transition-colors hover:border-edge-strong ${
            open ? 'border-edge-strong' : ''
          }`}
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-green text-[12px] font-bold text-white">
            {current?.name?.[0]?.toUpperCase() || 'W'}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-semibold text-ink">{current?.name || 'Workspace'}</span>
            <span className="block text-[10px] text-ink-faint">{current?.role === 'owner' ? 'Owner' : 'Member'}</span>
          </span>
          <ChevronDown width={14} height={14} className="shrink-0 text-ink-faint" />
        </button>
      )}
    >
      {({ close }) => (
        <div className="p-1.5">
          <div className="px-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Workspaces</div>
          <div className="max-h-[240px] overflow-y-auto">
            {workspaces.map((w) => (
              <MenuItem key={w.id} onClick={() => { switchWorkspace(w.id); close() }}>
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-elevated text-[10px] font-bold text-ink-dim">
                  {w.name[0]?.toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 truncate">{w.name}</span>
                {w.id === current?.id && <CheckIcon width={14} height={14} className="shrink-0 text-green" />}
              </MenuItem>
            ))}
          </div>

          <div className="my-1 h-px bg-edge" />

          {creating ? (
            <div className="flex items-center gap-1.5 px-1 py-0.5">
              <Input
                autoFocus
                className="!py-1.5"
                placeholder="Workspace name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitCreate(close)
                  if (e.key === 'Escape') { setCreating(false); setName('') }
                }}
              />
              <Button variant="primary" size="sm" className="shrink-0" onClick={() => submitCreate(close)}>
                Add
              </Button>
            </div>
          ) : (
            <MenuItem onClick={() => setCreating(true)}>
              <PlusIcon width={14} height={14} /> New workspace
            </MenuItem>
          )}
          <MenuItem onClick={() => { navigate('/workspace'); close() }}>
            <SettingsIcon width={14} height={14} /> Workspace settings
          </MenuItem>
        </div>
      )}
    </Popover>
  )
}
