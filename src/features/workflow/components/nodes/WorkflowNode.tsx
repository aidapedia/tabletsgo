import { Handle, Position } from 'reactflow'
import { NODE_SPECS, sourceHandles } from '@/features/workflow/lib/nodeSpec'
import type { NodeType } from '@/features/workflow/lib/nodeSpec'

// One card renders every workflow node type — the catalog (nodeSpec) drives the
// icon, label, config summary and which handles appear. Switch/Loop get one
// labelled source handle per branch; every other type has a single "out".
export default function WorkflowNode({ type, data, selected }: { type: NodeType; data: any; selected: boolean }) {
  const spec = NODE_SPECS[type]
  if (!spec) return null
  const Icon = spec.icon
  const outs = sourceHandles(type, data)
  const status = data.__status as 'ok' | 'error' | undefined

  const border = selected
    ? 'border-[var(--color-green)]'
    : status === 'error'
    ? 'border-red'
    : status === 'ok'
    ? 'border-green-dim'
    : 'border-edge-strong'

  return (
    <div
      className={`w-[220px] cursor-pointer rounded-soft border-2 bg-panel transition-colors hover:border-green-bright ${border}`}
    >
      {spec.hasInput && (
        <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-2 !border-edge-strong !bg-elevated" />
      )}

      <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded bg-elevated ${spec.accent}`}>
          <Icon width={14} height={14} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-bold text-ink">{data.title || spec.label}</div>
          <div className="text-[9px] font-semibold uppercase tracking-wide text-ink-faint">{spec.category}</div>
        </div>
        {status && (
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${status === 'error' ? 'bg-red' : 'bg-green'}`}
            title={status === 'error' ? 'Last run errored' : 'Last run OK'}
          />
        )}
      </div>

      <div className="px-3 py-2">
        <div className="truncate font-mono text-[10px] text-ink-dim" title={spec.summary(data)}>
          {spec.summary(data)}
        </div>
      </div>

      {/* Source handles — a single "out" on the right edge, or a labelled row per
          branch for switch/loop. */}
      {outs.length === 1 ? (
        <Handle
          type="source"
          id={outs[0].id}
          position={Position.Right}
          className="!h-2 !w-2 !border-2 !border-edge-strong !bg-elevated"
        />
      ) : (
        <div className="flex flex-col gap-1 border-t border-edge px-3 py-2">
          {outs.map((h) => (
            <div key={h.id} className="relative flex items-center justify-end pr-1 text-[10px] text-ink-dim">
              <span className="truncate">{h.label}</span>
              <Handle
                type="source"
                id={h.id}
                position={Position.Right}
                className="!relative !right-[-14px] !top-0 !h-2 !w-2 !translate-y-0 !border-2 !border-edge-strong !bg-elevated"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
