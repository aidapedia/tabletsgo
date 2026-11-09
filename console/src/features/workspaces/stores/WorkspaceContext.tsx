import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { useAuth } from '@/features/auth'
import { listWorkspaces, createWorkspace as apiCreate, Workspace } from '@/features/workspaces/api'

type Ctx = {
  workspaces: Workspace[]
  current: Workspace | null
  currentId: string | null
  loading: boolean
  switchWorkspace: (id: string) => void
  createWorkspace: (name: string) => Promise<Workspace>
  refresh: () => Promise<void>
}

const WorkspaceContext = createContext<Ctx>(null as any)
const CURRENT_KEY = 'dbm.workspace'

export function WorkspaceProvider({ children }) {
  const { user } = useAuth()
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [currentId, setCurrentId] = useState<string | null>(() => localStorage.getItem(CURRENT_KEY))
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!user) {
      setWorkspaces([])
      setLoading(false)
      return
    }
    const list = await listWorkspaces()
    setWorkspaces(list)
    // Keep the stored selection if still valid, else fall back to the first.
    setCurrentId((prev) => (list.some((w) => w.id === prev) ? prev : list[0]?.id ?? null))
    setLoading(false)
  }, [user])

  useEffect(() => {
    setLoading(true)
    refresh()
  }, [refresh])

  useEffect(() => {
    if (currentId) localStorage.setItem(CURRENT_KEY, currentId)
  }, [currentId])

  const switchWorkspace = (id: string) => setCurrentId(id)

  const createWorkspace = async (name: string) => {
    const ws = await apiCreate(name)
    setWorkspaces((prev) => [...prev, ws])
    setCurrentId(ws.id)
    return ws
  }

  const current = workspaces.find((w) => w.id === currentId) || null

  return (
    <WorkspaceContext.Provider value={{ workspaces, current, currentId, loading, switchWorkspace, createWorkspace, refresh }}>
      {children}
    </WorkspaceContext.Provider>
  )
}

export const useWorkspaces = () => useContext(WorkspaceContext)
