import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { useAuth } from '@/features/auth'
import { listWorkspaces, Workspace } from '@/features/workspaces/api'

type Ctx = {
  workspaces: Workspace[]
  current: Workspace | null
  currentId: string | null
  loading: boolean
  switchWorkspace: (id: string) => void
  refresh: () => Promise<void>
}

const WorkspaceContext = createContext<Ctx>(null as any)
const CURRENT_KEY = 'dbm.workspace'

export function WorkspaceProvider({ children }) {
  const { user } = useAuth()
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [currentId, setCurrentId] = useState<string | null>(() => localStorage.getItem(CURRENT_KEY))
  const [fetching, setFetching] = useState(true)
  // Whose list `workspaces` is. Until it is the signed-in person's, the list is
  // still loading — without this, the render between signing in and the fetch
  // starting reads as "in no workspace" and flashes that page.
  const [loadedFor, setLoadedFor] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!user) {
      setWorkspaces([])
      setLoadedFor(null)
      setFetching(false)
      return
    }
    const list = await listWorkspaces()
    setWorkspaces(list)
    // Keep the stored selection if still valid, else fall back to the first.
    setCurrentId((prev) => (list.some((w) => w.id === prev) ? prev : list[0]?.id ?? null))
    setLoadedFor(user.id)
    setFetching(false)
  }, [user])
  const loading = fetching || (!!user && loadedFor !== user.id)

  useEffect(() => {
    setFetching(true)
    refresh()
  }, [refresh])

  useEffect(() => {
    if (currentId) localStorage.setItem(CURRENT_KEY, currentId)
  }, [currentId])

  const switchWorkspace = (id: string) => setCurrentId(id)

  const current = workspaces.find((w) => w.id === currentId) || null

  return (
    <WorkspaceContext.Provider value={{ workspaces, current, currentId, loading, switchWorkspace, refresh }}>
      {children}
    </WorkspaceContext.Provider>
  )
}

export const useWorkspaces = () => useContext(WorkspaceContext)
