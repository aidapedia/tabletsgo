import { useNavigate, useParams } from 'react-router-dom'
import { useEffect } from 'react'
import { NodeDetail, ResourceTree, nodeHref, useResourceTree } from '@/features/resource-tree'
import type { ResourceNode } from '@/features/resource-tree'
import Button from '@/shared/ui/buttons/Button'
import IconButton from '@/shared/ui/buttons/IconButton'
import EmptyState from '@/shared/ui/feedback/EmptyState'
import LoadingState from '@/shared/ui/feedback/LoadingState'
import { FolderIcon, RefreshIcon, ShieldIcon } from '@/shared/ui/icons'
import { PageHeader } from './ui'

/**
 * The Resource Tree page: the hierarchy on the left, the selected node's access
 * on the right.
 *
 * The selected node is in the URL (`/resource-tree/:nodeId`) rather than in
 * state, so a refresh keeps you on it and a link lands on it — the same rule the
 * rest of the app follows for anything a user can be looking at.
 */
export default function ResourceTreePage() {
  const navigate = useNavigate()
  const { nodeId } = useParams()
  const { nodes, catalog, loading, selectedId, setSelectedId, detail, detailLoading, refresh } = useResourceTree()

  // The URL is the source of truth for the selection; the hook follows it.
  useEffect(() => {
    setSelectedId(nodeId || null)
  }, [nodeId, setSelectedId])

  const select = (id: string | null) => navigate(id ? `/resource-tree/${id}` : '/resource-tree')

  const open = (node: ResourceNode) => {
    const href = nodeHref(node)
    // A resource you can't open still has access worth looking at, so fall back
    // to selecting it rather than doing nothing.
    href ? navigate(href) : select(node.id)
  }

  const groups = nodes.filter((n) => n.kind === 'group' && n.type !== 'application').length
  const resources = nodes.filter((n) => n.kind === 'resource').length

  return (
    <div className="w-full">
      <PageHeader
        title="Resource Tree"
        desc="Every workspace, group and resource you can reach — and who has been granted what, at each level."
        action={
          <IconButton onClick={refresh} aria-label="Refresh">
            <RefreshIcon />
          </IconButton>
        }
      />

      {loading ? (
        <div className="mt-7 rounded-card border border-edge bg-card py-16">
          <LoadingState className="text-center" />
        </div>
      ) : nodes.length === 0 ? (
        <div className="mt-7 flex flex-col items-center gap-4 rounded-card border border-dashed border-edge-strong bg-card py-20 text-center">
          <FolderIcon width={36} height={36} className="opacity-25" />
          <div>
            <p className="text-sm font-medium text-ink-dim">Nothing here yet</p>
            <p className="mt-1 max-w-[380px] text-xs leading-relaxed text-ink-faint">
              You'll see a workspace here once you're a member of one, or once someone grants you access to a resource inside it.
            </p>
          </div>
          <Button variant="subtle" size="sm" onClick={refresh}>
            Refresh
          </Button>
        </div>
      ) : (
        <div className="mt-7 grid grid-cols-[300px_1fr] gap-4 max-[860px]:grid-cols-1">
          {/* Tree */}
          <div className="rounded-card border border-edge bg-card p-4">
            <div className="mb-3 flex items-center gap-2 px-1.5 text-[11px] font-semibold text-ink-dim">
              <FolderIcon width={13} height={13} />
              <span>Resources</span>
              <span className="ml-auto text-[10px] font-normal text-ink-faint">
                {groups} group{groups !== 1 ? 's' : ''}, {resources} resource{resources !== 1 ? 's' : ''}
              </span>
            </div>
            <ResourceTree
              nodes={nodes}
              nodeTypes={catalog.nodeTypes}
              selectedId={selectedId}
              onSelect={(node) => select(node.id)}
              onOpen={(node) => select(node.id)}
              onChanged={refresh}
              emptyLabel="Nothing you can reach yet."
            />
          </div>

          {/* Detail */}
          <div className="rounded-card border border-edge bg-card">
            {selectedId ? (
              <NodeDetail
                detail={detail}
                loading={detailLoading}
                roles={catalog.roles}
                nodes={nodes}
                nodeTypes={catalog.nodeTypes}
                onClose={() => select(null)}
                onOpen={open}
                onSelect={select}
                onChanged={refresh}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
                <ShieldIcon width={32} height={32} className="opacity-25" />
                <div>
                  <p className="text-sm font-medium text-ink-dim">Select a node</p>
                  <p className="mt-1 max-w-[320px] text-xs leading-relaxed text-ink-faint">
                    Pick anything in the tree to see who owns it, who has been granted a role on it, and what that role reaches.
                  </p>
                </div>
                <EmptyState className="pt-2 text-[11px]">
                  Access granted on a node applies to everything inside it.
                </EmptyState>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
