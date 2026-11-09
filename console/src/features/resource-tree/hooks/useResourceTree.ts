import { useCallback, useEffect, useState } from 'react'
import { fetchCatalog, fetchNode, fetchResourceTree } from '../api'
import type { NodeDetail, ResourceNode, TreeCatalog } from '../types'

/**
 * The tree, the catalog, and whichever node is selected.
 *
 * The catalog is fetched once (it only changes when an admin edits the roles);
 * the tree reloads on `refresh`, and the selected node's detail follows the
 * selection. A reload keeps the selection, so granting access doesn't bounce you
 * back to nothing selected.
 */
export function useResourceTree() {
  const [nodes, setNodes] = useState<ResourceNode[]>([])
  const [catalog, setCatalog] = useState<TreeCatalog>({ nodeTypes: [], roles: [] })
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<NodeDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  // Bumped to force a reload; `useEffect` deps do the rest.
  const [tick, setTick] = useState(0)

  const refresh = useCallback(() => setTick((n) => n + 1), [])

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetchResourceTree()
      .then((data) => alive && setNodes(data))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [tick])

  useEffect(() => {
    let alive = true
    fetchCatalog().then((c) => alive && setCatalog(c))
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }
    let alive = true
    setDetailLoading(true)
    fetchNode(selectedId)
      .then((d) => alive && setDetail(d))
      .catch(() => alive && setDetail(null))
      .finally(() => alive && setDetailLoading(false))
    return () => {
      alive = false
    }
  }, [selectedId, tick])

  return {
    nodes,
    catalog,
    loading,
    selectedId,
    setSelectedId,
    detail,
    detailLoading,
    refresh,
  }
}
