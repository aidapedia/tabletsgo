import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactFlow, {
  addEdge,
  Background,
  MiniMap,
  useEdgesState,
  useNodesState,
} from 'reactflow'
import type { Connection, Node } from 'reactflow'
import 'reactflow/dist/style.css'
import Button from '@/shared/ui/buttons/Button'
import IconButton from '@/shared/ui/buttons/IconButton'
import TextButton from '@/shared/ui/buttons/TextButton'
import Popover from '@/shared/ui/overlay/Popover'
import { useToast } from '@/shared/ui/feedback/Toast'
import { PlayIcon, PlusIcon } from '@/shared/ui/icons'
import { getSchema } from '@/shared/api/database'
import type { SqlSchema } from '@/shared/ui/SqlEditor'
import { getWorkflow, updateWorkflow, runWorkflow } from '@/features/workflow/lib/api'
import type { RunResult } from '@/features/workflow/lib/api'
import { NODE_SPECS, sourceHandles } from '@/features/workflow/lib/nodeSpec'
import type { NodeType } from '@/features/workflow/lib/nodeSpec'
import WorkflowNode from '@/features/workflow/components/nodes/WorkflowNode'
import NodePalette from '@/features/workflow/components/NodePalette'
import NodeConfigPanel from '@/features/workflow/components/NodeConfigPanel'
import RunLogPanel from '@/features/workflow/components/RunLogPanel'
import { formatCombo, useKeymap, useShortcut } from '@/features/keymap'

let nodeSeq = 0
const newNodeId = () => `n${Date.now().toString(36)}${(nodeSeq++).toString(36)}`

// Render each node type through the one shared card component.
const nodeTypes = Object.fromEntries(
  Object.keys(NODE_SPECS).map((type) => [
    type,
    (props: any) => <WorkflowNode type={type as NodeType} data={props.data} selected={props.selected} />,
  ])
)

export default function WorkflowEditor({ conn, workflowId }: any) {
  const toast = useToast()
  const { bindings } = useKeymap()
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<RunResult | null>(null)
  const [logOpen, setLogOpen] = useState(false)
  // Right-click "add node" menu: screen coords for placement + flow coords for the node.
  const [menu, setMenu] = useState<{ x: number; y: number; flow: { x: number; y: number } } | null>(null)
  // Table→columns map for the query node's SQL autocomplete (same source as the query tab).
  const [schema, setSchema] = useState<SqlSchema>({})
  const rf = useRef<any>(null)
  const loadedFor = useRef<string | null>(null)
  const saveTimer = useRef<any>(null)
  const dirty = useRef(false)

  // Load the stored graph once per workflow id.
  useEffect(() => {
    let alive = true
    setLoading(true)
    loadedFor.current = null
    getWorkflow(conn.id, workflowId)
      .then((wf) => {
        if (!alive) return
        setNodes(wf.graph?.nodes || [])
        setEdges(wf.graph?.edges || [])
        loadedFor.current = workflowId
        setLoading(false)
      })
      .catch((e) => {
        if (!alive) return
        toast.error(`Couldn't load workflow: ${e.message}`)
        setLoading(false)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn.id, workflowId])

  // Load the connection schema once for SQL autocomplete in the query node.
  useEffect(() => {
    let alive = true
    getSchema(conn).then((s) => alive && setSchema(s || {}))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn.id])

  // Debounced autosave whenever the graph changes (after the initial load).
  useEffect(() => {
    if (loading || loadedFor.current !== workflowId) return
    if (!dirty.current) {
      dirty.current = true
      return
    }
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      // Strip transient run status before persisting.
      const clean = nodes.map((n) => ({ ...n, data: stripStatus(n.data) }))
      updateWorkflow(conn.id, workflowId, { graph: { nodes: clean, edges } }).catch((e) =>
        toast.error(`Autosave failed: ${e.message}`)
      )
    }, 700)
    return () => clearTimeout(saveTimer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges])

  const onConnect = useCallback((c: Connection) => setEdges((eds) => addEdge({ ...c, animated: true }, eds)), [setEdges])

  // A workflow starts with exactly one trigger. `category === 'Trigger'` is what
  // makes a node a trigger (currently the Schedule node).
  const hasTrigger = useMemo(
    () => nodes.some((n) => NODE_SPECS[n.type as NodeType]?.category === 'Trigger'),
    [nodes]
  )
  const allowNode = useCallback(
    (type: NodeType) => {
      const isTrigger = NODE_SPECS[type]?.category === 'Trigger'
      // First node must be the trigger; after that, no second trigger is allowed.
      if (nodes.length === 0) return isTrigger
      return isTrigger ? !hasTrigger : true
    },
    [nodes.length, hasTrigger]
  )

  // Add a node — at an explicit flow position (right-click menu) or, failing
  // that, near the centre of the current viewport (toolbar palette).
  const addNode = (type: NodeType, pos?: { x: number; y: number }) => {
    if (!allowNode(type)) return
    const spec = NODE_SPECS[type]
    const position =
      pos ??
      (rf.current
        ? rf.current.project({ x: window.innerWidth / 2 - 260, y: 220 })
        : { x: 120 + nodes.length * 30, y: 120 + nodes.length * 30 })
    const id = newNodeId()
    setNodes((nds) => [...nds, { id, type, position, data: spec.defaultData() } as Node])
    setSelectedId(id)
  }

  const patchNodeData = (id: string, patch: Record<string, any>) =>
    setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)))

  const deleteNode = (id: string) => {
    setNodes((nds) => nds.filter((n) => n.id !== id))
    setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id))
    setSelectedId((cur) => (cur === id ? null : cur))
  }

  // Swap a node's type in place: reset its config (keep the label) and prune any
  // edges whose endpoints no longer exist (changed source handles / lost input).
  const changeNodeType = (id: string, type: NodeType) => {
    const spec = NODE_SPECS[type]
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id
          ? { ...n, type, data: { ...spec.defaultData(), ...(n.data?.title ? { title: n.data.title } : {}) } }
          : n
      )
    )
    setEdges((eds) =>
      eds.filter((e) => {
        if (e.source === id && !sourceHandles(type, spec.defaultData()).some((o) => o.id === (e.sourceHandle || 'out')))
          return false
        if (e.target === id && !spec.hasInput) return false
        return true
      })
    )
  }

  // Which types a given node may become. A node can only switch within its own
  // kind: a trigger swaps to another trigger (schedule↔manual), and a non-trigger
  // never becomes a trigger — so the workflow keeps exactly one trigger.
  const canChangeTo = useCallback(
    (nodeId: string, type: NodeType) => {
      const node = nodes.find((n) => n.id === nodeId)
      if (!node) return true
      const nodeIsTrigger = NODE_SPECS[node.type as NodeType]?.category === 'Trigger'
      const typeIsTrigger = NODE_SPECS[type]?.category === 'Trigger'
      return nodeIsTrigger === typeIsTrigger
    },
    [nodes]
  )

  // Clear both our selection and React Flow's own `selected` flag, so the green
  // node highlight doesn't linger after the config panel closes.
  const deselect = () => {
    setSelectedId(null)
    setNodes((nds) => nds.map((n) => (n.selected ? { ...n, selected: false } : n)))
  }

  const selectedNode = useMemo(() => nodes.find((n) => n.id === selectedId) || null, [nodes, selectedId])
  const labelFor = useCallback(
    (nodeId: string) => {
      const n = nodes.find((x) => x.id === nodeId)
      return n?.data?.title || (n ? NODE_SPECS[n.type as NodeType]?.label : nodeId) || nodeId
    },
    [nodes]
  )

  // Right-click on empty canvas → open the node palette at the cursor.
  const openMenu = (e: any) => {
    e.preventDefault()
    const bounds = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const local = { x: e.clientX - bounds.left, y: e.clientY - bounds.top }
    setMenu({ x: local.x, y: local.y, flow: rf.current ? rf.current.project(local) : local })
  }

  const run = async () => {
    if (running) return
    setRunning(true)
    setLogOpen(true)
    setResult(null)
    try {
      const clean = nodes.map((n) => ({ ...n, data: stripStatus(n.data) }))
      const res = await runWorkflow(conn.id, workflowId, { nodes: clean, edges })
      setResult(res)
      // Tint each node by its last status from the run log.
      const statusByNode: Record<string, 'ok' | 'error'> = {}
      for (const entry of res.log || []) statusByNode[entry.nodeId] = entry.status
      setNodes((nds) => nds.map((n) => ({ ...n, data: { ...n.data, __status: statusByNode[n.id] } })))
      if (!res.ok) toast.error(res.error || 'Workflow failed')
    } catch (e: any) {
      toast.error(`Run failed: ${e.message}`)
      setResult({ ok: false, log: [], error: e.message })
    } finally {
      setRunning(false)
    }
  }

  useShortcut('workflow.run', run)

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
        <Button variant="primary" size="sm" icon={PlayIcon} onClick={run} disabled={running || loading}>
          {running ? 'Running…' : 'Run Workflow'}
          <kbd className="rounded bg-black/20 px-1.5 py-px text-[10px] font-semibold">
            {formatCombo(bindings['workflow.run'])}
          </kbd>
        </Button>
        <span className="ml-1 text-[11px] text-ink-faint">
          {conn.name} · {nodes.length} node{nodes.length === 1 ? '' : 's'}
        </span>
        {result && !logOpen && (
          <TextButton
            className="ml-auto !text-[11px] underline-offset-2 hover:underline"
            onClick={() => setLogOpen(true)}
          >
            Show run log
          </TextButton>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1">
          {loading ? (
            <div className="flex h-full items-center justify-center text-xs text-ink-faint">Loading workflow…</div>
          ) : (
            <>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onInit={(inst) => (rf.current = inst)}
                selectNodesOnDrag={false}
                onNodeClick={(_, node) => setSelectedId(node.id)}
                onPaneClick={deselect}
                onPaneContextMenu={openMenu}
                fitView
                proOptions={{ hideAttribution: true }}
              >
                <Background color="var(--color-edge-strong)" gap={18} size={1.6} />
                <MiniMap
                  pannable
                  zoomable
                  style={{ width: 120, height: 84 }}
                  maskColor="rgba(0,0,0,0.55)"
                  nodeColor="#2a352a"
                  nodeStrokeColor="#6fcf6a"
                />
              </ReactFlow>

              {nodes.length === 0 && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="pointer-events-auto flex flex-col items-center gap-3">
                    <Popover
                      width={280}
                      trigger={({ open, toggle }) => (
                        <Button variant="primary" size="sm" icon={PlusIcon} active={open} onClick={toggle}>
                          Add trigger
                        </Button>
                      )}
                    >
                      {({ close }) => <NodePalette allow={allowNode} onAdd={(t) => { addNode(t); close() }} />}
                    </Popover>
                    <div className="text-center text-xs text-ink-faint">Every workflow starts with a trigger.</div>
                  </div>
                </div>
              )}

              {/* Zoom / fit controls */}
              <div className="absolute bottom-3 left-3 z-10 flex items-center gap-0.5 rounded-soft border border-edge bg-elevated p-1 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.7)]">
                <IconButton onClick={() => rf.current?.zoomOut()} aria-label="Zoom out">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M5 12h14" />
                  </svg>
                </IconButton>
                <IconButton onClick={() => rf.current?.zoomIn()} aria-label="Zoom in">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </IconButton>
                <IconButton onClick={() => rf.current?.fitView({ duration: 300, padding: 0.2 })} aria-label="Fit view">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M3 16v3a2 2 0 0 0 2 2h3" />
                  </svg>
                </IconButton>
              </div>

              {/* Right-click "add node" menu, anchored at the cursor. */}
              {menu && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setMenu(null)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setMenu(null)
                    }}
                  />
                  <div
                    className="absolute z-50 w-[280px] rounded-soft border border-edge-strong bg-elevated shadow-[0_16px_40px_-12px_rgba(0,0,0,0.8)]"
                    style={{ left: menu.x, top: menu.y }}
                  >
                    <NodePalette allow={allowNode} onAdd={(t) => { addNode(t, menu.flow); setMenu(null) }} />
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {logOpen && (
          <RunLogPanel result={result} running={running} labelFor={labelFor} onClose={() => setLogOpen(false)} />
        )}
      </div>

      {selectedNode && (
        <NodeConfigPanel
          key={selectedNode.id}
          node={selectedNode}
          onChange={patchNodeData}
          onChangeType={changeNodeType}
          allowType={(t: NodeType) => canChangeTo(selectedNode.id, t)}
          schema={schema}
          dialect={conn.type}
          onDelete={deleteNode}
          onClose={deselect}
        />
      )}
    </div>
  )
}

// Remove the transient run tint so it never gets persisted.
function stripStatus(data: any) {
  if (!data || data.__status === undefined) return data
  const { __status, ...rest } = data
  return rest
}
